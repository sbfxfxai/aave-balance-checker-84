import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { checkRateLimit, RATE_LIMITS } from './rateLimit';
import { withMonitoring } from './monitoring';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { getRedis } from '../utils/redis';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface PaymentData {
  txHash: string;
  processedAt: string;
  positionId: string;
}

interface StatusResponse {
  funded: boolean;
  payment_id: string;
  tx_hash?: string;
  processed_at?: string;
  position_id?: string;
  message?: string;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate payment ID format
 * Accepts UUID format (v4) or alphanumeric strings (8-64 chars)
 */
function validatePaymentId(paymentId: string): boolean {
  // UUID v4 format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  
  // Alphanumeric string (8-64 characters)
  const alphanumericRegex = /^[a-zA-Z0-9]{8,64}$/;
  
  return uuidRegex.test(paymentId) || alphanumericRegex.test(paymentId);
}

/**
 * Safely parse payment data with validation
 */
function parsePaymentData(paymentDataRaw: string): PaymentData {
  try {
    const data = JSON.parse(paymentDataRaw);
    
    // Validate required fields
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid payment data structure');
    }
    
    if (typeof data.txHash !== 'string' || !data.txHash.trim()) {
      throw new Error('Missing or invalid txHash');
    }
    
    if (typeof data.processedAt !== 'string' || !data.processedAt.trim()) {
      throw new Error('Missing or invalid processedAt');
    }
    
    if (typeof data.positionId !== 'string' || !data.positionId.trim()) {
      throw new Error('Missing or invalid positionId');
    }
    
    return {
      txHash: data.txHash.trim(),
      processedAt: data.processedAt.trim(),
      positionId: data.positionId.trim()
    };
    
  } catch (error) {
    logger.error('Failed to parse payment data', LogCategory.PAYMENT, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    throw new Error('Stored payment data is corrupted or invalid');
  }
}

/**
 * Get client IP for logging
 */
function getClientIP(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : String(forwarded))
    : req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  return typeof ip === 'string' ? ip : (Array.isArray(ip) ? ip[0] : 'unknown');
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS headers (restrictive for production)
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['https://www.tiltvault.com'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin || '')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await withMonitoring(req, res, 'status', async (): Promise<void> => {
    const startTime = Date.now();
    const paymentId = req.query.payment_id;
    const clientIP = getClientIP(req);
    
    // Validate payment_id parameter
    if (typeof paymentId !== 'string' || !paymentId.trim()) {
      logger.warn('Invalid payment_id parameter', LogCategory.PAYMENT, {
        paymentId: paymentId || 'missing',
        ip: clientIP,
        userAgent: req.headers['user-agent']
      });
      
      res.status(400).json({
        error: 'Valid payment_id query parameter is required',
        message: 'Payment ID must be a UUID or alphanumeric string (8-64 characters)'
      });
      return;
    }
    
    const normalizedPaymentId = paymentId.trim();
    
    // Validate payment ID format
    if (!validatePaymentId(normalizedPaymentId)) {
      logger.warn('Invalid payment_id format', LogCategory.PAYMENT, {
        paymentId: normalizedPaymentId,
        ip: clientIP,
        userAgent: req.headers['user-agent']
      });
      
      res.status(400).json({
        error: 'Invalid payment_id format',
        message: 'Payment ID must be a UUID or alphanumeric string (8-64 characters)'
      });
      return;
    }
    
    logger.debug('Payment status request', LogCategory.PAYMENT, {
      paymentId: normalizedPaymentId,
      ip: clientIP
    });

    // Rate limiting: per payment ID (allows frequent polling)
    const rateLimitResult = await checkRateLimit(req, {
      ...RATE_LIMITS.STATUS,
      identifier: normalizedPaymentId,
    });

    // Always set rate limit headers for consistency
    res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());

    if (!rateLimitResult.allowed) {
      logger.warn('Rate limit exceeded for payment status', LogCategory.PAYMENT, {
        paymentId: normalizedPaymentId,
        ip: clientIP,
        limit: rateLimitResult.limit,
        resetAt: rateLimitResult.resetAt
      });
      
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many status checks. Please try again after ${new Date(rateLimitResult.resetAt).toISOString()}`,
        resetAt: rateLimitResult.resetAt,
      });
      return;
    }

    try {
      // Check if payment was processed (funded)
      const redis = await getRedis();
      
      // Add timeout to prevent hanging requests
      const paymentDataRaw = await Promise.race([
        redis.get<string>(`payment:${normalizedPaymentId}`),
        new Promise<null>((_, reject) => 
          setTimeout(() => reject(new Error('Redis timeout')), 3500)
        ),
      ]) as string | null;

      if (!paymentDataRaw) {
        // Payment not processed yet
        logger.debug('Payment not yet processed', LogCategory.PAYMENT, {
          paymentId: normalizedPaymentId,
          ip: clientIP,
          duration: Date.now() - startTime
        });
        
        const response: StatusResponse = {
          funded: false,
          payment_id: normalizedPaymentId,
          message: 'Payment not yet processed'
        };
        
        res.status(200).json(response);
        return;
      }

      // Payment was processed - parse and validate data
      const data = parsePaymentData(paymentDataRaw);
      
      logger.info('Payment status retrieved', LogCategory.PAYMENT, {
        paymentId: normalizedPaymentId,
        txHash: data.txHash,
        positionId: data.positionId,
        processedAt: data.processedAt,
        ip: clientIP,
        duration: Date.now() - startTime
      });
      
      const response: StatusResponse = {
        funded: true,
        payment_id: normalizedPaymentId,
        tx_hash: data.txHash,
        processed_at: data.processedAt,
        position_id: data.positionId
      };
      
      res.status(200).json(response);
      return;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('Failed to retrieve payment status', LogCategory.PAYMENT, {
        paymentId: normalizedPaymentId,
        ip: clientIP,
        error: errorMessage,
        duration: Date.now() - startTime
      }, error instanceof Error ? error : new Error(errorMessage));
      
      errorTracker.trackError(error instanceof Error ? error : new Error(errorMessage), {
        category: 'payment',
        context: {
          paymentId: normalizedPaymentId,
          endpoint: 'status',
          ip: clientIP
        }
      });
      
      // Don't expose Redis errors to client
      const userMessage = errorMessage.includes('corrupted') || errorMessage.includes('invalid')
        ? 'Payment data is temporarily unavailable. Please try again later.'
        : 'Failed to retrieve payment status. Please try again later.';
      
      res.status(500).json({
        error: 'Internal server error',
        message: userMessage
      });
    }
  });
}

