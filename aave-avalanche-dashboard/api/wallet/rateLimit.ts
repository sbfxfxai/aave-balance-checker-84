import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

/**
 * Rate limiting middleware and utilities
 */
export class RateLimiter {
  private redis: Redis;
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number = 60000, maxRequests: number = 100) {
    this.redis = getRedis();
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  /**
   * Check if request is allowed
   */
  async isAllowed(key: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
    total: number;
  }> {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const redisKey = `rate_limit:${key}`;

    try {
      // Clean old entries
      await this.redis.zremrangebyscore(redisKey, 0, windowStart);

      // Count current requests
      const current = await this.redis.zcard(redisKey);

      if (current >= this.maxRequests) {
        // Get oldest request time for reset time
        const oldest = await this.redis.zrange(redisKey, 0, 0);
        const resetTime = oldest.length > 0 ? parseInt(oldest[0] as string) + this.windowMs : now + this.windowMs;

        return {
          allowed: false,
          remaining: 0,
          resetTime,
          total: this.maxRequests
        };
      }

      // Add current request
      await this.redis.zadd(redisKey, now, `${now}_${Math.random()}`);
      await this.redis.expire(redisKey, Math.ceil(this.windowMs / 1000));

      return {
        allowed: true,
        remaining: this.maxRequests - current - 1,
        resetTime: now + this.windowMs,
        total: this.maxRequests
      };
    } catch (error) {
      console.error('[RateLimit] Redis error:', error);
      // Fail open - allow request if Redis is down
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetTime: now + this.windowMs,
        total: this.maxRequests
      };
    }
  }

  /**
   * Create middleware for Express/Vercel
   */
  middleware(keyGenerator: (req: VercelRequest) => string) {
    return async (req: VercelRequest, res: VercelResponse, next?: Function) => {
      const key = keyGenerator(req);
      const result = await this.isAllowed(key);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', result.total);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000));

      if (!result.allowed) {
        return res.status(429).json({
          error: 'Too many requests',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        });
      }

      if (next) next();
      return result;
    };
  }
}

// Default rate limiters
export const rateLimiters = {
  // General API rate limiter
  api: new RateLimiter(60000, 100), // 100 requests per minute
  
  // Auth endpoints - more restrictive
  auth: new RateLimiter(60000, 10), // 10 requests per minute
  
  // Wallet operations - very restrictive
  wallet: new RateLimiter(60000, 5), // 5 requests per minute
  
  // Email sending - very restrictive
  email: new RateLimiter(60000, 3), // 3 requests per minute
};

// Key generators
export const keyGenerators = {
  // Rate limit by IP
  byIP: (req: VercelRequest) => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? (forwarded as string).split(',')[0] : 'unknown';
    return `ip:${ip}`;
  },

  // Rate limit by user email
  byEmail: (req: VercelRequest) => {
    const email = req.body?.email || req.query?.email;
    return email ? `email:${email.toString().toLowerCase()}` : 'unknown';
  },

  // Rate limit by wallet address
  byWallet: (req: VercelRequest) => {
    const wallet = req.body?.walletAddress || req.query?.wallet;
    return wallet ? `wallet:${wallet.toString().toLowerCase()}` : 'unknown';
  },

  // Rate limit by user ID
  byUserId: (req: VercelRequest) => {
    const userId = req.body?.userId || req.headers['x-user-id'];
    return userId ? `user:${userId}` : 'unknown';
  },

  // Combined IP + endpoint
  byIPAndEndpoint: (req: VercelRequest) => {
    const ip = keyGenerators.byIP(req);
    const endpoint = req.url || 'unknown';
    return `${ip}:${endpoint}`;
  }
};

/**
 * GET /api/wallet/rateLimit
 * Check current rate limit status
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, key } = req.query;

    if (!type || !key) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['type', 'key']
      });
    }

    const limiter = rateLimiters[type as keyof typeof rateLimiters];
    if (!limiter) {
      return res.status(400).json({ 
        error: 'Invalid rate limiter type',
        available: Object.keys(rateLimiters)
      });
    }

    const result = await limiter.isAllowed(key.toString());

    return res.status(200).json({
      success: true,
      type,
      key,
      ...result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[RateLimit] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
