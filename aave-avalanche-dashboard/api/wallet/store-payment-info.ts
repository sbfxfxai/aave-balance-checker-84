import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';
import { checkRateLimit, RATE_LIMITS } from './rateLimit';
import { withMonitoring } from './monitoring';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  await withMonitoring(req, res, 'store-payment-info', async (): Promise<void> => {
    const { paymentId, walletAddress, userEmail, riskProfile, amount } = req.body;

    // Rate limiting: per payment ID
    const rateLimitResult = await checkRateLimit(req, {
      ...RATE_LIMITS.STORE_PAYMENT_INFO,
      identifier: paymentId,
    });

    if (!rateLimitResult.allowed) {
      res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Please try again after ${new Date(rateLimitResult.resetAt).toISOString()}`,
        resetAt: rateLimitResult.resetAt,
      });
      return;
    }

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());

    // Validate required fields (userEmail is optional for connected wallets)
    if (!paymentId || !walletAddress || !riskProfile || !amount) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['paymentId', 'walletAddress', 'riskProfile', 'amount'],
        optional: ['userEmail'],
      });
      return;
    }

    // Validate wallet address format
    if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
      res.status(400).json({ error: 'Invalid wallet address format' });
      return;
    }

    // Validate email format (only if provided)
    if (userEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(userEmail)) {
        res.status(400).json({ error: 'Invalid email format' });
        return;
      }
    }

    const redis = await getRedis();
    const normalizedEmail = userEmail ? userEmail.toLowerCase().trim() : '';
    const normalizedWallet = walletAddress.toLowerCase();

    // Store payment info indexed by paymentId (for webhook lookup)
    const paymentInfo = {
      paymentId,
      walletAddress: normalizedWallet,
      userEmail: normalizedEmail || undefined, // Only include if provided
      riskProfile,
      amount: parseFloat(amount),
      createdAt: new Date().toISOString(),
    };

    // Store with 24 hour TTL (matches payment processing window)
    // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
    await redis.set(`payment_info:${paymentId}`, JSON.stringify(paymentInfo), {
      ex: 24 * 60 * 60, // 24 hours
    });
    
    // Also store a reverse mapping: frontend payment ID -> payment info key
    // This allows webhook to find payment_info even if only frontend payment ID is known
    // @ts-ignore
    await redis.set(`payment_info_lookup:${paymentId}`, paymentId, {
      ex: 24 * 60 * 60, // 24 hours
    });
    
    // CRITICAL: Store wallet -> payment_id mapping for webhook lookup
    // When Square order arrives without note, webhook can find payment_info by wallet address
    // @ts-ignore
    await redis.set(`wallet_payment:${normalizedWallet}`, paymentId, {
      ex: 24 * 60 * 60, // 24 hours
    });
    
    // Reverse lookup: payment_id -> wallet (for debugging/support)
    // @ts-ignore
    await redis.set(`payment_wallet:${paymentId}`, normalizedWallet, {
      ex: 24 * 60 * 60, // 24 hours
    });

    // Also update email->wallet mapping if email provided
    if (userEmail) {
      const emailWalletKey = `email_wallet:${normalizedEmail}`;
      // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
      const existingWallet = await redis.get(emailWalletKey);
      if (!existingWallet) {
        // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
        await redis.set(emailWalletKey, normalizedWallet, { ex: 365 * 24 * 60 * 60 }); // 1 year
      }
    }

    console.log(`[StorePaymentInfo] Stored payment info for ${paymentId}, wallet: ${normalizedWallet}`);

    res.status(200).json({
      success: true,
      message: 'Payment info stored',
      paymentId,
    });
  });
}

