import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { checkRateLimit, RATE_LIMITS } from './rateLimit';
import { withMonitoring } from './monitoring';

// Lazy-initialize Redis client
let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      throw new Error('Redis not configured: KV_REST_API_URL and KV_REST_API_TOKEN required');
    }
    
    _redis = new Redis({ url, token });
  }
  return _redis;
}

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

  await withMonitoring(req, res, 'status', async (): Promise<void> => {
    const paymentId = req.query.payment_id as string;

    if (!paymentId) {
      res.status(400).json({
        error: 'payment_id query parameter is required',
      });
      return;
    }

    // Rate limiting: per payment ID (allows frequent polling)
    const rateLimitResult = await checkRateLimit(req, {
      ...RATE_LIMITS.STATUS,
      identifier: paymentId,
    });

    if (!rateLimitResult.allowed) {
      res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many status checks. Please try again after ${new Date(rateLimitResult.resetAt).toISOString()}`,
        resetAt: rateLimitResult.resetAt,
      });
      return;
    }

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());

    // Check if payment was processed (funded)
    const redis = getRedis();
    // @ts-expect-error - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
    const paymentData = await redis.get(`payment:${paymentId}`);

    if (!paymentData) {
      // Payment not processed yet
      res.status(200).json({
        funded: false,
        payment_id: paymentId,
        message: 'Payment not yet processed',
      });
      return;
    }

    // Payment was processed
    const data = typeof paymentData === 'string' ? JSON.parse(paymentData) : paymentData;
    
    res.status(200).json({
      funded: true,
      payment_id: paymentId,
      tx_hash: data.txHash,
      processed_at: data.processedAt,
      position_id: data.positionId,
    });
  });
}

