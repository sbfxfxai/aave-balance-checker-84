import type { VercelRequest, VercelResponse } from '@vercel/node';
import { storeWalletKey } from './keystore';
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

  await withMonitoring(req, res, 'store-key', async (): Promise<void> => {
    const { walletAddress, encryptedPrivateKey, userEmail, riskProfile, amount, paymentId } = req.body;

    // Rate limiting: per wallet address
    const rateLimitResult = await checkRateLimit(req, {
      ...RATE_LIMITS.STORE_KEY,
      identifier: walletAddress,
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

    // Validate required fields
    if (!walletAddress || !encryptedPrivateKey || !userEmail || !riskProfile || !amount || !paymentId) {
      res.status(400).json({
        error: 'Missing required fields',
        required: ['walletAddress', 'encryptedPrivateKey', 'userEmail', 'riskProfile', 'amount', 'paymentId'],
      });
      return;
    }

    // Validate wallet address format
    if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
      res.status(400).json({ error: 'Invalid wallet address format' });
      return;
    }

    // Store encrypted key only (non-custodial)
    await storeWalletKey(
      walletAddress,
      encryptedPrivateKey,
      userEmail,
      riskProfile,
      parseFloat(amount),
      paymentId
    );

    console.log(`[StoreKey] Stored encrypted key for ${walletAddress}, email: ${userEmail}, paymentId: ${paymentId}`);

    res.status(200).json({
      success: true,
      message: 'Encrypted wallet stored securely (non-custodial)',
      walletAddress,
      paymentId,
    });
  });
}
