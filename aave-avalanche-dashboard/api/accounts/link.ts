import type { VercelRequest, VercelResponse } from '@vercel/node';

// Lazy-initialize Redis
let _redis: any = null;
async function getRedis(): Promise<any> {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      throw new Error('Redis not configured');
    }
    
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
  }
  return _redis;
}

const LINK_TTL = 365 * 24 * 60 * 60; // 1 year

/**
 * Link a wallet address to an email for easy dashboard access
 * 
 * POST /api/accounts/link
 * Body: { email: string, walletAddress: string }
 * 
 * GET /api/accounts/link?email=...
 * Returns: { walletAddress: string } or null
 * 
 * GET /api/accounts/link?wallet=...
 * Returns: { email: string } or null
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const redis = await getRedis();

    // POST - Link email to wallet
    if (req.method === 'POST') {
      const { email, walletAddress } = req.body;

      if (!email || !walletAddress) {
        return res.status(400).json({ error: 'Missing email or walletAddress' });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedWallet = walletAddress.toLowerCase();

      // Create bidirectional links
      const pipeline = redis.pipeline();
      
      // Email -> Wallet mapping
      pipeline.set(`email:${normalizedEmail}:wallet`, normalizedWallet, { ex: LINK_TTL });
      
      // Wallet -> Email mapping (for reverse lookup)
      pipeline.set(`wallet:${normalizedWallet}:email`, normalizedEmail, { ex: LINK_TTL });
      
      await pipeline.exec();

      console.log(`[Account Link] Linked ${normalizedEmail} to ${normalizedWallet}`);

      return res.status(200).json({
        success: true,
        email: normalizedEmail,
        walletAddress: normalizedWallet,
      });
    }

    // GET - Lookup linked wallet/email
    if (req.method === 'GET') {
      const email = req.query.email as string;
      const wallet = req.query.wallet as string;

      if (email) {
        const normalizedEmail = email.toLowerCase().trim();
        const linkedWallet = await redis.get(`email:${normalizedEmail}:wallet`);
        
        return res.status(200).json({
          success: true,
          email: normalizedEmail,
          walletAddress: linkedWallet || null,
        });
      }

      if (wallet) {
        const normalizedWallet = wallet.toLowerCase();
        const linkedEmail = await redis.get(`wallet:${normalizedWallet}:email`);
        
        return res.status(200).json({
          success: true,
          walletAddress: normalizedWallet,
          email: linkedEmail || null,
        });
      }

      return res.status(400).json({ error: 'Provide email or wallet parameter' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('[Account Link] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
