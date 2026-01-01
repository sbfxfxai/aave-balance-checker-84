import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

/**
 * GET /api/wallet/monitoring
 * Returns wallet monitoring and statistics
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const redis = getRedis();
    const { walletAddress, userEmail } = req.query;

    if (!walletAddress && !userEmail) {
      return res.status(400).json({ 
        error: 'Either walletAddress or userEmail parameter is required'
      });
    }

    let walletStats: any = {};

    if (walletAddress) {
      const normalizedWallet = walletAddress.toString().toLowerCase();
      
      // Get wallet association info
      const associatedUser = await redis.get(`wallet_user:${normalizedWallet}`);
      const associationData = await redis.get(`association:${normalizedWallet}`);
      
      // Get wallet key status
      const keyExists = await redis.exists(`wallet_key:${normalizedWallet}`);
      
      // Get wallet activity (mock data for now)
      const activity = await redis.lrange(`wallet_activity:${normalizedWallet}`, 0, 9);
      
      walletStats = {
        walletAddress: normalizedWallet,
        associatedUser,
        associationData,
        hasStoredKey: keyExists,
        recentActivity: activity,
        lastChecked: new Date().toISOString()
      };
    }

    if (userEmail) {
      const normalizedEmail = userEmail.toString().toLowerCase();
      
      // Get all wallets for user
      const userWallets = await redis.smembers(`user_wallets:${normalizedEmail}`);
      
      // Get user statistics
      const userStats = {
        userEmail: normalizedEmail,
        walletCount: userWallets.length,
        wallets: userWallets,
        lastChecked: new Date().toISOString()
      };

      if (walletAddress) {
        // Combine both if both parameters provided
        walletStats.userStats = userStats;
      } else {
        // Return only user stats
        walletStats = userStats;
      }
    }

    // Get global wallet statistics
    const globalStats = {
      totalWallets: await redis.dbsize(), // Approximate
      activeWallets: await redis.keys('wallet_key:*').then(keys => keys.length),
      totalAssociations: await redis.keys('wallet_user:*').then(keys => keys.length),
      timestamp: new Date().toISOString()
    };

    return res.status(200).json({
      success: true,
      data: walletStats,
      global: globalStats
    });

  } catch (error) {
    console.error('[Wallet Monitoring] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
