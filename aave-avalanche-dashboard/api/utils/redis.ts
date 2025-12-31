import { Redis } from '@upstash/redis';

// Shared Redis client for endpoints that don't need Privy
let _redis: Redis | null = null;
let _redisError: string | null = null;

export function getRedis(): Redis {
  if (_redisError) {
    throw new Error(_redisError);
  }

  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      _redisError = 'Redis configuration missing: KV_REST_API_URL and KV_REST_API_TOKEN must be set';
      throw new Error(_redisError);
    }

    try {
      _redis = new Redis({
        url,
        token,
      });
      console.log('[Redis] Connected successfully');
    } catch (error) {
      _redisError = error instanceof Error ? error.message : 'Failed to initialize Redis';
      console.error('[Redis] Initialization error:', _redisError);
      throw new Error(_redisError);
    }
  }

  return _redis;
}

