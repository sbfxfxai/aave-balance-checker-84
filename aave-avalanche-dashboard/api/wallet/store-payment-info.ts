import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

/**
 * POST /api/wallet/store-payment-info
 * Stores payment information for wallet operations
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      walletAddress, 
      paymentId, 
      amount, 
      currency, 
      paymentMethod, 
      status = 'pending',
      metadata = {} 
    } = req.body;

    if (!walletAddress || !paymentId || !amount || !currency || !paymentMethod) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['walletAddress', 'paymentId', 'amount', 'currency', 'paymentMethod']
      });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    // Validate amount
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Validate currency
    const supportedCurrencies = ['USD', 'EUR', 'GBP', 'BTC', 'ETH', 'AVAX'];
    if (!supportedCurrencies.includes(currency.toUpperCase())) {
      return res.status(400).json({ 
        error: 'Unsupported currency',
        supported: supportedCurrencies
      });
    }

    // Validate payment method
    const supportedMethods = ['credit_card', 'debit_card', 'bank_transfer', 'crypto', 'square', 'cashapp'];
    if (!supportedMethods.includes(paymentMethod)) {
      return res.status(400).json({ 
        error: 'Unsupported payment method',
        supported: supportedMethods
      });
    }

    const redis = getRedis();
    const normalizedWallet = walletAddress.toLowerCase();

    // Check if payment already exists
    const existingPayment = await redis.get(`payment:${paymentId}`);
    if (existingPayment) {
      return res.status(409).json({ 
        error: 'Payment ID already exists',
        paymentId
      });
    }

    // Create payment info object
    const paymentInfo = {
      paymentId,
      walletAddress: normalizedWallet,
      amount,
      currency: currency.toUpperCase(),
      paymentMethod,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        ...metadata,
        ipAddress: req.headers['x-forwarded-for'] || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown'
      }
    };

    // Store payment info
    await redis.set(`payment:${paymentId}`, paymentInfo, { ex: 30 * 24 * 60 * 60 }); // 30 days

    // Add to wallet's payment history
    await redis.lpush(`wallet_payments:${normalizedWallet}`, paymentInfo);
    await redis.ltrim(`wallet_payments:${normalizedWallet}`, 0, 99); // Keep last 100 payments

    // Add to global payment index for tracking
    await redis.lpush('global_payments', paymentId);
    await redis.ltrim('global_payments', 0, 999); // Keep last 1000 payments

    console.log(`[Payment Info] Stored payment ${paymentId} for wallet ${normalizedWallet}`);

    return res.status(201).json({
      success: true,
      paymentId,
      walletAddress: normalizedWallet,
      amount,
      currency,
      paymentMethod,
      status,
      createdAt: paymentInfo.createdAt
    });

  } catch (error) {
    console.error('[Payment Info] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
