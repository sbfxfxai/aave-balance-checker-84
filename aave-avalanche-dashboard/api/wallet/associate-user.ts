import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

/**
 * POST /api/wallet/associate-user
 * Associates a wallet address with a user account
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
    const { walletAddress, userEmail, userId } = req.body;

    if (!walletAddress || !userEmail) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['walletAddress', 'userEmail']
      });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const redis = getRedis();
    const normalizedWallet = walletAddress.toLowerCase();
    const normalizedEmail = userEmail.toLowerCase().trim();

    // Check if wallet is already associated
    const existingAssociation = await redis.get(`wallet_user:${normalizedWallet}`);
    if (existingAssociation) {
      return res.status(409).json({ 
        error: 'Wallet is already associated with another user',
        existingUser: existingAssociation
      });
    }

    // Create bidirectional associations
    const pipeline = redis.pipeline();
    
    // Wallet -> User mapping
    pipeline.set(`wallet_user:${normalizedWallet}`, normalizedEmail, { ex: 365 * 24 * 60 * 60 }); // 1 year
    
    // User -> Wallet mapping (support multiple wallets per user)
    pipeline.sadd(`user_wallets:${normalizedEmail}`, normalizedWallet);
    pipeline.expire(`user_wallets:${normalizedEmail}`, 365 * 24 * 60 * 60); // 1 year
    
    // Store association metadata
    const associationData = {
      walletAddress: normalizedWallet,
      userEmail: normalizedEmail,
      userId: userId || null,
      associatedAt: new Date().toISOString(),
      status: 'active'
    };
    pipeline.set(`association:${normalizedWallet}`, associationData, { ex: 365 * 24 * 60 * 60 });

    await pipeline.exec();

    console.log(`[Wallet Associate] Associated ${normalizedWallet} with ${normalizedEmail}`);

    return res.status(200).json({
      success: true,
      walletAddress: normalizedWallet,
      userEmail: normalizedEmail,
      userId,
      associatedAt: associationData.associatedAt
    });

  } catch (error) {
    console.error('[Wallet Associate] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
