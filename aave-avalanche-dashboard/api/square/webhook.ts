import { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';
import { savePosition, updatePosition, getPositionsByEmail } from './store';
import { executeMorphoFromHubWallet } from './webhook-morpho';

// Configuration
const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || '';
const MIN_PAYMENT_AMOUNT_USD = 10; // Minimum $10 payment

// Redis client for distributed rate limiting and idempotency
function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL || process.env.REDIS_URL;
  const token = process.env.KV_REST_API_TOKEN;
  
  if (!url || !token) {
    throw new Error('Redis configuration missing for webhook processing');
  }
  
  return new Redis({ url, token });
}

// Distributed rate limiting using Redis
async function checkWebhookRateLimit(ip: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `webhook_rate_limit:${ip}`;
    const window = 60; // 1 minute
    const maxRequests = 100;
    
    const current = await redis.incr(key);
    
    if (current === 1) {
      await redis.expire(key, window);
    }
    
    return current <= maxRequests;
  } catch (error) {
    console.error('[Webhook] Rate limiting error:', error);
    return true; // Allow on Redis errors
  }
}

// Idempotency tracking using Redis
async function isWebhookProcessed(webhookId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const key = `processed_webhook:${webhookId}`;
    const exists = await redis.exists(key);
    
    if (!exists) {
      // Mark as processed for 24 hours
      await redis.setex(key, 86400, '1');
    }
    
    return exists === 1;
  } catch (error) {
    console.error('[Webhook] Idempotency check error:', error);
    return false; // Allow processing on Redis errors
  }
}

function setCorsHeaders(res: VercelResponse): void {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Square-Signature');
  res.setHeader('Access-Control-Max-Age', '3600');
}

function validateSquareSignature(payload: string, signature: string): boolean {
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
    console.warn('[Webhook] SQUARE_WEBHOOK_SIGNATURE_KEY not configured - skipping signature validation');
    return true; // Allow in development
  }
  
  try {
    const expectedSignature = crypto
      .createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
      .update(payload, 'utf8')
      .digest('base64');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(expectedSignature, 'base64')
    );
  } catch (error) {
    console.error('[Webhook] Signature validation error:', error);
    return false;
  }
}

function parsePaymentNote(note: string): {
  paymentId?: string;
  walletAddress?: string;
  userEmail?: string;
  riskProfile?: string;
  includeErgc?: number;
  useExistingErgc?: number;
} {
  const parsed: any = {};
  
  if (!note) return parsed;
  
  // Parse key:value pairs from note
  const parts = note.split(' ');
  for (const part of parts) {
    const [key, value] = part.split(':');
    if (key && value) {
      switch (key) {
        case 'payment_id':
          parsed.paymentId = value;
          break;
        case 'wallet':
          parsed.walletAddress = value;
          break;
        case 'email':
          parsed.userEmail = value;
          break;
        case 'risk':
          parsed.riskProfile = value;
          break;
        case 'ergc':
          parsed.includeErgc = parseInt(value);
          break;
        case 'debit_ergc':
          parsed.useExistingErgc = parseInt(value);
          break;
      }
    }
  }
  
  return parsed;
}

async function processPaymentCompleted(
  paymentData: any,
  parsedNote: any,
  paymentId: string
): Promise<{ success: boolean; error?: string; positionId?: string }> {
  try {
    const { walletAddress, userEmail, riskProfile, includeErgc, useExistingErgc } = parsedNote;
    
    if (!walletAddress || !userEmail) {
      console.warn('[Webhook] Missing wallet address or email in payment note');
      return { success: false, error: 'Missing wallet address or email' };
    }
    
    // Extract and validate payment amount
    const amountMoney = paymentData.amount_money || {};
    const amount = Number(amountMoney.amount) / 100; // Convert from cents
    const currency = amountMoney.currency || 'USD';
    
    // Validate minimum amount and currency
    if (amount < MIN_PAYMENT_AMOUNT_USD) {
      console.warn('[Webhook] Payment amount below minimum:', { amount, currency });
      return { success: false, error: `Payment amount must be at least $${MIN_PAYMENT_AMOUNT_USD}` };
    }
    
    if (currency !== 'USD') {
      console.warn('[Webhook] Non-USD payment:', { amount, currency });
      return { success: false, error: 'Only USD payments are supported' };
    }
    
    // Check if position already exists (only by paymentId for true idempotency)
    const existingPositions = await getPositionsByEmail(userEmail);
    const existingPosition = existingPositions.find(p => p.paymentId === paymentId);
    
    if (existingPosition) {
      console.log('[Webhook] Position already exists:', existingPosition.id);
      return { success: true, positionId: existingPosition.id };
    }
    
    // Determine strategy type
    const strategyType = riskProfile === 'aggressive' ? 'aggressive' : 'conservative';
    
    // Create position record
    const positionId = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    
    await savePosition({
      id: positionId,
      paymentId,
      userEmail,
      walletAddress,
      strategyType,
      usdcAmount: amount,
      status: 'pending',
      createdAt: new Date().toISOString(),
      includeErgc,
      useExistingErgc,
    });
    
    console.log('[Webhook] Position created:', positionId);
    
    // Queue strategy execution for async processing
    if (process.env.ENABLE_MORPHO_STRATEGY === 'true') {
      console.log('[Webhook] Queuing Morpho strategy execution...');
      
      try {
        // Store strategy execution request in Redis for background processing
        const redis = getRedis();
        const strategyRequest = {
          positionId,
          walletAddress,
          amount,
          paymentId,
          strategyType,
          createdAt: new Date().toISOString()
        };
        
        await redis.lpush('morpho_strategy_queue', JSON.stringify(strategyRequest));
        console.log('[Webhook] Strategy execution queued:', positionId);
        
        // Update position to indicate strategy is queued
        await updatePosition(positionId, {
          status: 'queued',
          lastUpdatedAt: new Date().toISOString()
        });
        
      } catch (queueError) {
        console.error('[Webhook] Failed to queue strategy execution:', queueError);
        // Position remains in pending status for manual retry
      }
    }
    
    return { success: true, positionId };
    
  } catch (error) {
    console.error('[Webhook] Error processing payment:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Square Webhook Handler - Production Ready
 * 
 * Handles Square payment webhooks with signature validation, rate limiting,
 * and automatic position creation/strategy execution.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  
  // CORS headers
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed',
      allowed: ['POST', 'OPTIONS']
    });
  }
  
  try {
    const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown') as string;
    
    // Rate limiting (now distributed)
    if (!(await checkWebhookRateLimit(clientIp))) {
      console.warn('[Webhook] Rate limit exceeded', { ip: clientIp });
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: `Maximum 100 webhooks per minute` 
      });
    }
    
    // Get signature from headers
    const signature = req.headers['x-square-signature'] as string;
    if (!signature) {
      console.warn('[Webhook] Missing Square signature');
      return res.status(401).json({ 
        success: false,
        error: 'Missing signature' 
      });
    }
    
    // Get and validate payload
    const payload = JSON.stringify(req.body);
    if (!payload || payload === '{}') {
      return res.status(400).json({ 
        success: false,
        error: 'Empty payload' 
      });
    }
    
    // Validate Square signature
    if (!validateSquareSignature(payload, signature)) {
      console.warn('[Webhook] Invalid Square signature', { ip: clientIp });
      return res.status(401).json({ 
        success: false,
        error: 'Invalid signature' 
      });
    }
    
    // Parse webhook data
    const webhookData = req.body;
    const eventType = webhookData.type;
    const eventData = webhookData.data?.object;
    const webhookId = webhookData.id;
    
    console.log('[Webhook] Processing event:', { 
      eventType, 
      eventId: webhookId,
      ip: clientIp 
    });
    
    // Idempotency check - prevent duplicate processing
    if (await isWebhookProcessed(webhookId)) {
      console.log('[Webhook] Webhook already processed:', webhookId);
      return res.status(200).json({ 
        success: true,
        message: 'Webhook already processed' 
      });
    }
    
    // Handle different event types
    switch (eventType) {
      case 'payment.created':
        console.log('[Webhook] Payment created:', eventData.id);
        return res.status(200).json({ 
          success: true,
          message: 'Payment created event received'
        });
        
      case 'payment.updated':
        console.log('[Webhook] Payment updated:', eventData.id);
        return res.status(200).json({ 
          success: true,
          message: 'Payment updated event received'
        });
        
      case 'payment.completed':
        console.log('[Webhook] Payment completed:', eventData.id);
        
        // Parse payment note for metadata
        const parsedNote = parsePaymentNote(eventData.note || '');
        
        // Process the completed payment
        const result = await processPaymentCompleted(
          eventData,
          parsedNote,
          eventData.id
        );
        
        if (result.success) {
          const responseTime = Date.now() - startTime;
          console.log('[Webhook] Payment processed successfully:', {
            paymentId: eventData.id,
            positionId: result.positionId,
            responseTime: `${responseTime}ms`
          });
          
          return res.status(200).json({
            success: true,
            message: 'Payment processed successfully',
            positionId: result.positionId,
            responseTime: `${responseTime}ms`
          });
        } else {
          console.error('[Webhook] Payment processing failed:', result.error);
          return res.status(500).json({
            success: false,
            error: 'Payment processing failed',
            message: result.error
          });
        }
        
      case 'payment.failed':
        console.log('[Webhook] Payment failed:', eventData.id);
        
        // Update position status if we can find it
        const parsedFailedNote = parsePaymentNote(eventData.note || '');
        if (parsedFailedNote.userEmail) {
          const positions = await getPositionsByEmail(parsedFailedNote.userEmail);
          const position = positions.find(p => p.paymentId === eventData.id);
          
          if (position) {
            await updatePosition(position.id, {
              status: 'failed',
              error: 'Payment failed',
              lastUpdatedAt: new Date().toISOString()
            });
          }
        }
        
        return res.status(200).json({ 
          success: true,
          message: 'Payment failure processed'
        });
        
      case 'refund.created':
      case 'refund.updated':
      case 'refund.completed':
        console.log('[Webhook] Refund event:', eventType, eventData.id);
        return res.status(200).json({ 
          success: true,
          message: 'Refund event received'
        });
        
      default:
        console.log('[Webhook] Unhandled event type:', eventType);
        return res.status(200).json({ 
          success: true,
          message: 'Event received but not processed'
        });
    }
    
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    console.error('[Webhook] Unexpected error:', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      responseTime: `${responseTime}ms`
    });
    
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'production' 
        ? 'Webhook processing failed' 
        : errorMessage,
      responseTime: `${responseTime}ms`
    });
  }
}

export const config = {
  maxDuration: 30, // Allow longer duration for webhook processing
};