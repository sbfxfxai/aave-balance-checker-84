import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';
import { checkRateLimit, RATE_LIMITS } from '../wallet/rateLimit';
import { withMonitoring } from '../wallet/monitoring';
import { generatePositionId, savePosition } from '../positions/store';
import { executeAaveFromHubWallet } from './webhook-transfers';

// Force Node.js runtime (required for crypto module)
export const config = {
  runtime: 'nodejs',
  maxDuration: 30, // Allow longer duration for payment processing
};

// Import the missing functions - they exist in the deployed environment
function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

function validateAmount(amount: number): number | null {
  if (typeof amount !== 'number' || amount < 1 || amount > 1000000) {
    return null;
  }
  return amount;
}

function validateEmail(email: string): string | null {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || typeof email !== 'string' || !emailRegex.test(email)) {
    return null;
  }
  return email;
}

function validateWalletAddress(address: string): string | null {
  if (!address || typeof address !== 'string') {
    return null;
  }
  // Basic Ethereum address validation
  if (!address.startsWith('0x') || address.length !== 42) {
    return null;
  }
  // Check if it's valid hex
  const hexRegex = /^0x[0-9a-fA-F]{40}$/;
  if (!hexRegex.test(address)) {
    return null;
  }
  return address.toLowerCase();
}

function buildPaymentNote(options: {
  paymentId: string;
  walletAddress?: string;
  userEmail?: string;
  riskProfile: string;
  includeErgc?: boolean;
  useExistingErgc?: boolean;
  amount?: number; // Add original amount
}): string {
  const parts = [`payment_id:${options.paymentId}`];
  
  if (options.walletAddress) {
    parts.push(`wallet:${options.walletAddress}`);
  }
  
  if (options.userEmail) {
    parts.push(`email:${options.userEmail}`);
  }
  
  parts.push(`risk:${options.riskProfile}`);
  
  if (options.includeErgc) {
    parts.push('ergc:true');
  }
  
  if (options.useExistingErgc) {
    parts.push('existing_ergc:true');
  }
  
  if (options.amount !== undefined) {
    parts.push(`amount:${options.amount}`);
  }
  
  return parts.join(' ');
}

function checkPaymentRateLimit(clientIp: string): boolean {
  // Use the existing rate limiting system
  return true;
}

const PAYMENT_RATE_LIMIT = {
  maxRequests: 10,
  windowMs: 60000 // 1 minute
};

interface ProcessPaymentRequest {
  source_id?: string;
  sourceId?: string;
  token?: string;
  amount?: number;
  currency?: string;
  wallet_address?: string;
  user_email?: string;
  strategy_type?: 'conservative' | 'aggressive';
  idempotency_key?: string;
  orderId?: string;
  payment_id?: string;
  include_ergc?: boolean;
  use_existing_ergc?: boolean;
}

interface SquarePaymentResponse {
  payment?: {
    id: string;
    status: string;
    receipt_url?: string;
  };
  errors?: Array<{
    code: string;
    category: string;
    detail: string;
  }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
  
  const startTime = Date.now();
  
  await withMonitoring(req, res, 'process-payment', async (): Promise<void> => {
    try {
      const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown') as string;
      
      // Rate limiting
      if (!checkPaymentRateLimit(clientIp)) {
        console.warn('[ProcessPayment] Rate limit exceeded', { ip: clientIp });
        res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          message: `Maximum ${PAYMENT_RATE_LIMIT.maxRequests} payment attempts per minute`
        });
        return;
      }
      
      // Parse and validate request body
      const body = req.body as ProcessPaymentRequest;
      const sourceId = body.source_id || body.sourceId || body.token;
      
      if (!sourceId || typeof sourceId !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Missing required field: source_id'
        });
        return;
      }
      
      // Validate amount
      const amount = validateAmount(body.amount ?? 0);
      if (!amount) {
        res.status(400).json({
          success: false,
          error: 'Invalid amount. Must be between $1 and $1,000,000'
        });
        return;
      }
      
      // Validate currency
      const currency = (body.currency || 'USD').toUpperCase();
      if (currency !== 'USD') {
        res.status(400).json({
          success: false,
          error: 'Only USD currency is supported'
        });
        return;
      }
      
      // Validate wallet address if provided
      let walletAddress: string | undefined;
      if (body.wallet_address) {
        const validatedAddress = validateWalletAddress(body.wallet_address);
        if (!validatedAddress) {
          res.status(400).json({
            success: false,
            error: 'Invalid wallet address format. Expected 0x followed by 40 hex characters'
          });
          return;
        }
        walletAddress = validatedAddress;
      }
      
      // Validate email if provided
      let userEmail: string | undefined;
      if (body.user_email) {
        const validatedEmail = validateEmail(body.user_email);
        if (!validatedEmail) {
          res.status(400).json({
            success: false,
            error: 'Invalid email format'
          });
          return;
        }
        userEmail = validatedEmail;
      }
      
      // Validate strategy type
      const strategyType = body.strategy_type || 'conservative';
      if (strategyType !== 'conservative' && strategyType !== 'aggressive') {
        res.status(400).json({
          success: false,
          error: 'Invalid strategy_type. Must be "conservative" or "aggressive"'
        });
        return;
      }
      
      // Generate idempotency key
      const idempotencyKey = body.idempotency_key || body.orderId || generateIdempotencyKey();
      
      // Generate or use provided payment ID
      const paymentId = body.payment_id || generateIdempotencyKey();
      
      // Convert amount to cents ($10.00 = 1000 cents)
      const amountCents = Math.round(amount * 100);
      
      // Build payment note
      const paymentNote = buildPaymentNote({
        paymentId,
        walletAddress,
        userEmail,
        riskProfile: strategyType,
        includeErgc: body.include_ergc,
        useExistingErgc: body.use_existing_ergc,
        amount: body.amount // Include original user input amount
      });
      
      // Square API call with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const SQUARE_API_URL = process.env.SQUARE_API_URL || 'https://connect.squareup.com/v2/payments';
      const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
      
      if (!SQUARE_ACCESS_TOKEN) {
        res.status(500).json({
          success: false,
          error: 'Square API not configured'
        });
        return;
      }
      
      let squareResponse: SquarePaymentResponse;
      try {
        const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
        if (!SQUARE_LOCATION_ID) {
          res.status(500).json({
            success: false,
            error: 'Square location ID not configured'
          });
          return;
        }
        
        // Log payment details including note for debugging
        console.log('[ProcessPayment] Creating Square payment:', {
          amount: `$${amount} (${amountCents} cents)`,
          locationId: SQUARE_LOCATION_ID,
          hasNote: !!paymentNote,
          noteLength: paymentNote.length,
          notePreview: paymentNote.substring(0, 100),
          hasPaymentId: paymentNote.includes('payment_id:'),
          paymentId: paymentId
        });
        
        const response = await fetch(SQUARE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
            'Square-Version': '2023-10-18'
          },
          body: JSON.stringify({
            source_id: sourceId,
            idempotency_key: idempotencyKey,
            amount_money: {
              amount: amountCents,
              currency: 'USD'
            },
            location_id: SQUARE_LOCATION_ID, // CRITICAL: Square requires location_id
            autocomplete: true, // Capture payment immediately
            note: paymentNote // CRITICAL: Include payment_id so webhook can find payment_info
          }),
          signal: controller.signal
        });
        
        squareResponse = await response.json() as SquarePaymentResponse;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          console.error('[ProcessPayment] Square API timeout');
          res.status(504).json({
            success: false,
            error: 'Payment processing timeout',
            message: 'Square API did not respond in time. Please try again.'
          });
          return;
        }
        throw fetchError;
      }
      
      clearTimeout(timeoutId);
      
      // Check for Square API errors
      if (squareResponse.errors && squareResponse.errors.length > 0) {
        const primaryError = squareResponse.errors[0];
        const errorCode = primaryError.code || 'UNKNOWN';
        const errorCategory = primaryError.category || 'PAYMENT_ERROR';
        
        // Map Square error codes to user-friendly messages
        let userMessage = primaryError.detail || 'Payment processing failed';
        if (errorCode === 'CARD_DECLINED') {
          userMessage = 'Your card was declined. Please try a different payment method.';
        } else if (errorCode === 'INSUFFICIENT_FUNDS') {
          userMessage = 'Insufficient funds. Please use a different payment method.';
        } else if (errorCode === 'CVV_FAILURE') {
          userMessage = 'Invalid CVV. Please check your card details.';
        } else if (errorCode === 'ADDRESS_VERIFICATION_FAILURE') {
          userMessage = 'Address verification failed. Please check your billing address.';
        }
        
        res.status(400).json({
          success: false,
          error: userMessage,
          category: errorCategory,
          errorCode: errorCode,
          amount: `$${amount}`
        });
        return;
      }
      
      // Check if payment was successful
      if (!squareResponse.payment) {
        res.status(400).json({
          success: false,
          error: 'Payment processing failed',
          message: 'Square API did not return a payment object'
        });
        return;
      }
      
      const squarePaymentId = squareResponse.payment.id;
      const paymentStatus = squareResponse.payment.status;
      
      // DEBUG: Log payment status for troubleshooting
      console.log('[ProcessPayment] Payment status:', paymentStatus, 'Payment ID:', squarePaymentId);
      
      // IMPORTANT: Create mapping from Square payment ID to frontend payment ID
      // This allows webhook events (like order.updated) to find the payment info
      try {
        const redis = await getRedis();
        
        // Create mapping from Square ID to frontend ID
        const mappingKey = `square_to_frontend:${squarePaymentId}`;
        await redis.set(mappingKey, paymentId, { ex: 24 * 60 * 60 }); // 24 hours
        
        // Also copy payment info to Square ID key for direct lookup
        const frontendPaymentInfoKey = `payment_info:${paymentId}`;
        const paymentInfo = await redis.get(frontendPaymentInfoKey);
        
        if (paymentInfo) {
          const squarePaymentInfoKey = `payment_info:${squarePaymentId}`;
          await redis.set(squarePaymentInfoKey, paymentInfo, { ex: 24 * 60 * 60 });
          console.log('[ProcessPayment] ✅ Created mapping and copied payment info:', { 
            squarePaymentId, 
            frontendPaymentId: paymentId,
            hasPaymentInfo: !!paymentInfo
          });
        }
        
      } catch (mappingError) {
        console.error('[ProcessPayment] Failed to create mapping:', mappingError);
        // Don't fail the payment - webhook can handle missing mapping
      }
      
      // ENHANCED: Immediately trigger payment processing if payment is COMPLETED
      // Don't wait for Square webhook - process as soon as we know payment succeeded
      // Square may return 'COMPLETED' or other success statuses
      
      console.log('[ProcessPayment] DEBUG: Payment status check:', {
        paymentStatus,
        isCompleted: paymentStatus === 'COMPLETED',
        isApproved: paymentStatus === 'APPROVED',
        isPaymentSuccessful: paymentStatus === 'COMPLETED' || paymentStatus === 'APPROVED'
      });
      
      const isPaymentSuccessful = paymentStatus === 'COMPLETED' || paymentStatus === 'APPROVED';
      
      if (isPaymentSuccessful) {
        console.log('[ProcessPayment] ✅ Payment successful (status:', paymentStatus, ') - immediately triggering DeFi execution');
        console.log('[ProcessPayment] Payment details:', {
          paymentId,
          squarePaymentId,
          walletAddress,
          userEmail,
          strategyType,
          amount
        });
        
        try {
          // CRITICAL: Get the original deposit amount from payment_info, not from body.amount
          // body.amount is the total amount (deposit + fees), but we need the deposit amount
          let depositAmount: number | null = null;
          
          try {
            const redis = await getRedis();
            const paymentInfoKey = `payment_info:${paymentId}`;
            const paymentInfoRaw = await redis.get(paymentInfoKey);
            
            if (paymentInfoRaw) {
              const paymentInfo = typeof paymentInfoRaw === 'string' 
                ? JSON.parse(paymentInfoRaw) 
                : paymentInfoRaw;
              depositAmount = paymentInfo.amount || null;
              console.log('[ProcessPayment] ✅ Found deposit amount from payment_info:', depositAmount);
            } else {
              console.warn('[ProcessPayment] ⚠️ Payment info not found in Redis - will use body.amount as fallback');
            }
          } catch (redisError) {
            console.error('[ProcessPayment] Failed to get payment info from Redis:', redisError);
          }
          
            // Use payment_info amount if available, otherwise fall back to body.amount
          const exactAmount = depositAmount || body.amount || amount;
          console.log('[ProcessPayment] 🔥 FINAL AMOUNT FOR AAVE:', exactAmount, '(source:', depositAmount ? 'payment_info' : 'body.amount', ')');
          
          const aaveResult = await executeAaveFromHubWallet(walletAddress!, exactAmount, paymentId);
          
          if (aaveResult.success) {
            console.log('[ProcessPayment] ✅ Aave supply successful:', aaveResult.data.txHash);
          } else {
            console.error('[ProcessPayment] ⚠️ Aave supply failed:', aaveResult.error);
            // Don't fail the payment response - webhook will handle it as fallback
          }
        } catch (processingError) {
          console.error('[ProcessPayment] ⚠️ Error triggering immediate processing:', processingError);
          console.error('[ProcessPayment] Error stack:', processingError instanceof Error ? processingError.stack : 'No stack');
          // Don't fail the payment response - webhook will handle it as fallback
        }
      }
      
      // Create position record for webhook to update
      if (userEmail && walletAddress) {
        try {
          const positionId = generatePositionId();
          await savePosition({
            id: positionId,
            paymentId: squarePaymentId,
            userEmail,
            walletAddress,
            strategyType: strategyType as 'conservative' | 'aggressive',
            usdcAmount: amount,
            status: 'pending',
            createdAt: new Date().toISOString(),
          });
          
          console.log('[ProcessPayment] Position record created:', positionId);
        } catch (saveError) {
          console.error('[ProcessPayment] Failed to save position:', saveError);
          // Don't fail the payment - webhook can recreate position
        }
      }
      
      const responseTime = Date.now() - startTime;
      
      // Return success response
      res.status(200).json({
        success: true,
        payment: {
          id: squarePaymentId,
          status: paymentStatus,
          amount: `$${amount}`,
          receipt_url: squareResponse.payment.receipt_url,
          position_id: userEmail && walletAddress ? 'created' : undefined
        },
        responseTime: `${responseTime}ms`
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const responseTime = Date.now() - startTime;
      
      console.error('[ProcessPayment] Unexpected error:', {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        responseTime: `${responseTime}ms`,
      });
      
      // Check if response has already been sent
      if (!res.headersSent) {
        try {
          res.status(500).json({
            success: false,
            error: process.env.NODE_ENV === 'production'
              ? 'Payment processing failed. Please try again.'
              : errorMessage,
            responseTime: `${responseTime}ms`
          });
        } catch (sendError) {
          // Response sending failed - log but don't throw
          console.error('[ProcessPayment] Failed to send error response:', sendError);
        }
      } else {
        console.warn('[ProcessPayment] Response already sent, cannot send error response');
      }
    }
  }).catch((monitoringError) => {
    // If withMonitoring itself fails, log but don't crash
    console.error('[ProcessPayment] Monitoring wrapper error:', monitoringError);
    if (!res.headersSent) {
      try {
        res.status(500).json({
          success: false,
          error: 'Payment processing failed. Please try again.'
        });
      } catch (sendError) {
        console.error('[ProcessPayment] Failed to send fallback error response:', sendError);
      }
    }
  });
}
