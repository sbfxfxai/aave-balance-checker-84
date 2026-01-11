import type { VercelRequest, VercelResponse } from '@vercel/node';

// Validation functions
function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

function validateWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Helper function for safe logging
function hashEmail(email: string): string {
  return Buffer.from(email).toString('base64').substring(0, 8);
}

// Lazy-initialize Redis and Rate Limiter
let _redis: any = null;
let _ratelimit: any = null;

async function getRedis(): Promise<any> {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      throw new Error('Redis not configured');
    }
    
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
    
    // Initialize rate limiter
    try {
      const { Ratelimit } = await import('@upstash/ratelimit');
      _ratelimit = new Ratelimit({
        redis: _redis,
        limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute
        analytics: true,
      });
    } catch (error) {
      console.warn('[Account Link] Rate limiting not available:', error);
    }
  }
  return { redis: _redis, ratelimit: _ratelimit };
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
    const { redis, ratelimit } = await getRedis();

    // Rate limiting
    if (ratelimit) {
      const identifier = (req.headers['x-forwarded-for'] as string) || 
                        (req.headers['x-real-ip'] as string) || 
                        'anonymous';
      const { success } = await ratelimit.limit(identifier);
      
      if (!success) {
        return res.status(429).json({ 
          error: 'Too many requests. Please try again later.' 
        });
      }
    }

    // POST - Link email to wallet
    if (req.method === 'POST') {
      const { email, walletAddress } = req.body;

      if (!email || !walletAddress) {
        return res.status(400).json({ 
          error: 'Missing required fields: email and walletAddress' 
        });
      }

      // Validate inputs
      if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      if (!validateWalletAddress(walletAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedWallet = walletAddress.toLowerCase();

      // Check for existing link to prevent overwrite
      const existingWallet = await redis.get(`email:${normalizedEmail}:wallet`);
      if (existingWallet && existingWallet !== normalizedWallet) {
        return res.status(409).json({
          error: 'Email already linked to a different wallet',
          existingWallet,
        });
      }

      const existingEmail = await redis.get(`wallet:${normalizedWallet}:email`);
      if (existingEmail && existingEmail !== normalizedEmail) {
        return res.status(409).json({
          error: 'Wallet already linked to a different email',
          existingEmail,
        });
      }

      // Create bidirectional links
      const pipeline = redis.pipeline();
      
      // Email -> Wallet mapping
      pipeline.set(`email:${normalizedEmail}:wallet`, normalizedWallet, { ex: LINK_TTL });
      
      // Wallet -> Email mapping (for reverse lookup)
      pipeline.set(`wallet:${normalizedWallet}:email`, normalizedEmail, { ex: LINK_TTL });
      
      const result = await pipeline.exec();
      if (result.length > 0 && result[0][0] === 'OK') {
        console.log(`[Account Link] Linked ${hashEmail(normalizedEmail)} to ${normalizedWallet}`);
        return res.status(200).json({
          success: true,
          email: normalizedEmail,
          walletAddress: normalizedWallet,
        });
      } else {
        throw new Error(`Failed to create link: ${result[0][1]}`);
      }
    }

    // GET - Lookup linked wallet/email
    if (req.method === 'GET') {
      const email = req.query.email as string;
      const wallet = req.query.wallet as string;

      if (email) {
        const normalizedEmail = email.toLowerCase().trim();
        
        if (!validateEmail(email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        
        const linkedWallet = await redis.get(`email:${normalizedEmail}:wallet`);
        
        return res.status(200).json({
          success: true,
          email: normalizedEmail,
          walletAddress: linkedWallet || null,
        });
      }

      if (wallet) {
        const normalizedWallet = wallet.toLowerCase();
        
        if (!validateWalletAddress(wallet)) {
          return res.status(400).json({ error: 'Invalid wallet address format' });
        }
        
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Account Link] Error:', {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? message : undefined,
    });
  }
}
