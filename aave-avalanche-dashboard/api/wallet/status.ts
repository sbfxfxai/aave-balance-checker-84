import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

/**
 * GET /api/wallet/status
 * Returns wallet status and connectivity information
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
    const { walletAddress, userEmail } = req.query;
    const redis = getRedis();

    let statusData: any = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    };

    // System status checks
    const systemChecks = await Promise.allSettled([
      // Redis connectivity
      redis.ping().then(() => ({ service: 'redis', status: 'healthy' })),
      
      // Check key count
      redis.dbsize().then((count: number) => ({ 
        service: 'redis_keys', 
        status: 'healthy',
        count 
      }))
    ]);

    statusData.system = {
      redis: systemChecks[0].status === 'fulfilled' ? 'connected' : 'disconnected',
      totalKeys: systemChecks[1].status === 'fulfilled' ? systemChecks[1].value?.count : 0
    };

    // Wallet-specific status
    if (walletAddress) {
      const normalizedWallet = walletAddress.toString().toLowerCase();
      
      const [hasKey, associatedUser, associationData] = await Promise.all([
        redis.exists(`wallet_key:${normalizedWallet}`),
        redis.get(`wallet_user:${normalizedWallet}`),
        redis.get(`association:${normalizedWallet}`)
      ]);

      statusData.wallet = {
        address: normalizedWallet,
        hasStoredKey: Boolean(hasKey),
        associatedUser,
        associationData,
        lastChecked: new Date().toISOString()
      };
    }

    // User-specific status
    if (userEmail) {
      const normalizedEmail = userEmail.toString().toLowerCase();
      
      const [userWallets, userActivity] = await Promise.all([
        redis.smembers(`user_wallets:${normalizedEmail}`),
        redis.lrange(`user_activity:${normalizedEmail}`, 0, 4) // Last 5 activities
      ]);

      statusData.user = {
        email: normalizedEmail,
        walletCount: userWallets.length,
        wallets: userWallets,
        recentActivity: userActivity,
        lastChecked: new Date().toISOString()
      };
    }

    // Global statistics
    const [walletKeys, userAssociations, totalConnections] = await Promise.all([
      redis.keys('wallet_key:*'),
      redis.keys('wallet_user:*'),
      redis.keys('user_wallets:*')
    ]);

    statusData.global = {
      totalWalletsWithKeys: walletKeys.length,
      totalUserAssociations: userAssociations.length,
      totalUserConnections: totalConnections.length,
      timestamp: new Date().toISOString()
    };

    // Health status
    const isHealthy = statusData.system.redis === 'connected';
    
    return res.status(isHealthy ? 200 : 503).json({
      success: isHealthy,
      status: isHealthy ? 'healthy' : 'unhealthy',
      data: statusData
    });

  } catch (error) {
    console.error('[Wallet Status] Error:', error);
    return res.status(500).json({ 
      success: false,
      status: 'unhealthy',
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
}
