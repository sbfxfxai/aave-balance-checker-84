import { VercelRequest, VercelResponse } from '@vercel/node';
import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from '../utils/redis';
import { getAddress } from 'ethers';

// Helper to access Node.js crypto module (available at runtime in Vercel)
function getCrypto() {
  // Use Function constructor to access require in a way TypeScript accepts
  const requireFunc = new Function('return require')();
  return requireFunc('crypto') as { randomUUID: () => string };
}

// Square configuration
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN || '';
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || '';
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'production';
const SQUARE_API_BASE_URL = SQUARE_ENVIRONMENT === 'sandbox' 
  ? 'https://connect.squareupsandbox.com'
  : 'https://connect.squareup.com';
const SQUARE_API_VERSION = process.env.SQUARE_API_VERSION || '2024-10-16';

// ERGC Purchase Constants
const ERGC_PURCHASE_PRICE_USD = 10.00; // $10 for 100 ERGC
const ERGC_PURCHASE_AMOUNT = 100; // 100 ERGC tokens
const DUPLICATE_PURCHASE_WINDOW = 300; // 5 minutes in seconds

interface ErgcPurchaseRequest {
  source_id?: string;
  sourceId?: string;
  token?: string;
  wallet_address: string;
  user_email?: string;
  idempotency_key?: string;
}

// Rate limiter for purchase attempts
let _ratelimit: any = null;

async function getRatelimit() {
  if (!_ratelimit) {
    const redis = await getRedis();
    _ratelimit = new Ratelimit({
      redis: redis as any,
      limiter: Ratelimit.slidingWindow(10, '1 h'), // 10 purchases per hour per IP
      analytics: true,
    });
  }
  return _ratelimit;
}

// Hash wallet address for logging
function hashAddress(address: string): string {
  return `${address.substring(0, 6)}...${address.substring(38)}`;
}

// Validate email format
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Validate Ethereum address
function isValidEthereumAddress(address: string): boolean {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return false;
  }
  
  try {
    getAddress(address); // Validates checksum
    return true;
  } catch {
    return false;
  }
}

/**
 * API Route: Purchase ERGC tokens ($10 for 100 ERGC)
 * 
 * This route handles direct ERGC purchases via Square payment.
 * When payment clears, the webhook will automatically transfer 100 ERGC
 * from the hub wallet to the user's wallet.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[ErgcPurchase] Processing ERGC purchase request');
    
    // Rate limiting
    const ratelimit = await getRatelimit();
    const identifier = (req.headers['x-forwarded-for'] as string) || 
                       (req.headers['x-real-ip'] as string) || 
                       'anonymous';
    
    const { success, remaining } = await ratelimit.limit(identifier);
    
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    
    if (!success) {
      return res.status(429).json({
        success: false,
        error: 'Too many purchase attempts. Please try again later.',
      });
    }
    
    const body = req.body as ErgcPurchaseRequest;
    
    // Extract and validate required fields
    const sourceId = body.source_id || body.sourceId || body.token;
    const walletAddress = body.wallet_address;
    const userEmail = body.user_email;
    const idempotencyKey = body.idempotency_key;

    // Validate required fields
    if (!sourceId) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required field: source_id (or sourceId/token)' 
      });
    }
    
    if (!walletAddress) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required field: wallet_address' 
      });
    }

    // Validate wallet address format
    if (!isValidEthereumAddress(walletAddress)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid wallet address format' 
      });
    }
    
    const normalizedWalletAddress = getAddress(walletAddress);

    // Validate email if provided
    if (userEmail) {
      const trimmedEmail = userEmail.trim().toLowerCase();
      if (!isValidEmail(trimmedEmail)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email address format',
        });
      }
      if (trimmedEmail.length > 254) {
        return res.status(400).json({
          success: false,
          error: 'Email address too long',
        });
      }
    }

    // Check for recent duplicate purchases
    const redis = await getRedis();
    const recentPurchaseKey = `ergc_purchase_recent:${normalizedWalletAddress}`;
    const recentPurchase = await redis.get(recentPurchaseKey);

    if (recentPurchase) {
      const lastPurchaseData = JSON.parse(recentPurchase as string);
      return res.status(429).json({
        success: false,
        error: 'You recently made an ERGC purchase. Please wait before purchasing again.',
        last_purchase: lastPurchaseData.timestamp,
        payment_id: lastPurchaseData.payment_id,
        retry_after: DUPLICATE_PURCHASE_WINDOW,
      });
    }

    // Validate Square credentials
    if (!SQUARE_ACCESS_TOKEN) {
      console.error('[ErgcPurchase] SQUARE_ACCESS_TOKEN not configured');
      return res.status(500).json({ 
        success: false,
        error: 'Payment processing not configured' 
      });
    }
    
    if (!SQUARE_LOCATION_ID) {
      console.error('[ErgcPurchase] SQUARE_LOCATION_ID not configured');
      return res.status(500).json({ 
        success: false,
        error: 'Payment processing not configured' 
      });
    }

    // Generate secure idempotency key if not provided
    const crypto = getCrypto();
    const finalIdempotencyKey = idempotencyKey || crypto.randomUUID();

    // Convert amount to cents ($10.00 = 1000 cents)
    const amountCents = Math.round(ERGC_PURCHASE_PRICE_USD * 100);

    // Build payment note for webhook
    // The webhook will detect "ergc:100" and automatically transfer 100 ERGC
    const noteParts: string[] = [
      `ergc:${ERGC_PURCHASE_AMOUNT}`, // Signal to webhook: send 100 ERGC
      `wallet:${normalizedWalletAddress}`, // User's wallet address
      `purchase_type:ergc_only` // Indicate this is ERGC-only purchase (no strategy execution)
    ];
    
    if (userEmail) {
      noteParts.push(`email:${userEmail.trim().toLowerCase()}`);
    }

    console.log('[ErgcPurchase] Payment details:', {
      amount: `$${ERGC_PURCHASE_PRICE_USD} (${amountCents} cents)`,
      ergcAmount: ERGC_PURCHASE_AMOUNT,
      walletAddress: hashAddress(normalizedWalletAddress),
      note: noteParts.join(' ')
    });

    // Prepare Square API payload
    const squarePayload: any = {
      source_id: sourceId,
      idempotency_key: finalIdempotencyKey,
      amount_money: {
        amount: amountCents,
        currency: 'USD',
      },
      location_id: SQUARE_LOCATION_ID,
      autocomplete: true,
      note: noteParts.join(' ')
    };

    console.log('[ErgcPurchase] Calling Square API:', {
      environment: SQUARE_ENVIRONMENT,
      amount: `$${ERGC_PURCHASE_PRICE_USD}`,
      locationId: SQUARE_LOCATION_ID,
    });

    // Call Square Payments API with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

    try {
      const squareResponse = await fetch(`${SQUARE_API_BASE_URL}/v2/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Square-Version': SQUARE_API_VERSION,
        },
        body: JSON.stringify(squarePayload),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      const responseData = await squareResponse.json();

      if (!squareResponse.ok) {
        const errors = responseData.errors || [];
        const errorMessage = errors[0]?.detail || `Payment processing error`;
        const errorCode = errors[0]?.code || 'UNKNOWN';
        
        console.error('[ErgcPurchase] Square API error:', {
          status: squareResponse.status,
          code: errorCode,
          message: errorMessage,
        });

        return res.status(squareResponse.status).json({
          success: false,
          error: errorMessage,
          code: `SQUARE_${errorCode}`,
        });
      }

      // Extract payment data
      const payment = responseData.payment || {};
      const squarePaymentId = payment.id;
      const paymentStatus = payment.status;

      // Store recent purchase to prevent duplicates
      await redis.set(
        recentPurchaseKey,
        JSON.stringify({
          payment_id: squarePaymentId,
          timestamp: Date.now(),
          wallet_address: normalizedWalletAddress,
          amount: ERGC_PURCHASE_AMOUNT,
        }),
        { ex: DUPLICATE_PURCHASE_WINDOW }
      );

      console.log('[ErgcPurchase] Payment processed successfully:', {
        squarePaymentId,
        status: paymentStatus,
        walletAddress: hashAddress(normalizedWalletAddress),
        ergcAmount: ERGC_PURCHASE_AMOUNT,
      });

      return res.status(200).json({
        success: true,
        payment_id: squarePaymentId,
        status: paymentStatus,
        transaction_id: squarePaymentId,
        message: 'ERGC purchase payment processed successfully. 100 ERGC will be sent to your wallet when payment clears.',
        amount: ERGC_PURCHASE_PRICE_USD,
        ergc_amount: ERGC_PURCHASE_AMOUNT,
        wallet_address: normalizedWalletAddress,
      });

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return res.status(504).json({
          success: false,
          error: 'Payment processing timeout. Please try again.',
        });
      }
      
      throw fetchError;
    }

  } catch (error: any) {
    console.error('[ErgcPurchase] Error:', error);
    
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' 
        ? error.message 
        : 'An error occurred processing your payment. Please contact support.',
    });
  }
}
