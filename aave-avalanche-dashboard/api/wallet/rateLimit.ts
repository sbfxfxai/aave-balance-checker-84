import { Redis } from '@upstash/redis';
import type { VercelRequest } from '@vercel/node';

// Initialize Redis
function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

/**
 * Get client identifier from request (IP address or wallet address)
 */
function getClientId(req: VercelRequest, identifier?: string): string {
  // Use provided identifier (e.g., wallet address, email) if available
  if (identifier) {
    return identifier.toLowerCase().trim();
  }
  
  // Fallback to IP address
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim())
    : req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  
  return ip as string;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
  identifier?: string; // Optional: wallet address, email, etc.
  endpoint: string; // For logging
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

/**
 * Check rate limit for a client
 * Returns rate limit status and remaining requests
 */
export async function checkRateLimit(
  req: VercelRequest,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const redis = getRedis();
  const clientId = getClientId(req, config.identifier);
  const rateLimitKey = `rate_limit:${config.endpoint}:${clientId}`;
  
  // Get current count
  // @ts-expect-error - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
  const current = await redis.get(rateLimitKey);
  const count = current ? parseInt(current as string, 10) : 0;
  
  // Check if limit exceeded
  if (count >= config.maxRequests) {
    // Get TTL to calculate reset time
    // @ts-expect-error - @upstash/redis types may not include ttl method in some TypeScript versions, but it exists at runtime
    const ttl = await redis.ttl(rateLimitKey);
    const resetAt = Date.now() + (ttl * 1000);
    
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      limit: config.maxRequests,
    };
  }
  
  // Increment counter
  if (count === 0) {
    // First request - set with expiry
    // @ts-expect-error - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
    await redis.set(rateLimitKey, '1', { ex: config.windowSeconds });
  } else {
    // Increment existing counter
    // @ts-expect-error - @upstash/redis types may not include incr method in some TypeScript versions, but it exists at runtime
    await redis.incr(rateLimitKey);
  }
  
  const remaining = config.maxRequests - count - 1;
  const resetAt = Date.now() + (config.windowSeconds * 1000);
  
  return {
    allowed: true,
    remaining,
    resetAt,
    limit: config.maxRequests,
  };
}

/**
 * Rate limit configurations for different wallet endpoints
 */
export const RATE_LIMITS = {
  // Store key: 10 requests per wallet per hour
  STORE_KEY: {
    maxRequests: 10,
    windowSeconds: 3600,
    endpoint: 'store-key',
  },
  
  // Store payment info: 20 requests per payment ID per hour
  STORE_PAYMENT_INFO: {
    maxRequests: 20,
    windowSeconds: 3600,
    endpoint: 'store-payment-info',
  },
  
  // Send email: 5 requests per email per hour (prevent spam)
  SEND_EMAIL: {
    maxRequests: 5,
    windowSeconds: 3600,
    endpoint: 'send-email',
  },
  
  // Decrypt mnemonic: 10 requests per email per hour (security-sensitive)
  DECRYPT_MNEMONIC: {
    maxRequests: 10,
    windowSeconds: 3600,
    endpoint: 'decrypt-mnemonic',
  },
  
  // Status check: 60 requests per payment ID per minute (frequent polling)
  STATUS: {
    maxRequests: 60,
    windowSeconds: 60,
    endpoint: 'status',
  },
} as const;

