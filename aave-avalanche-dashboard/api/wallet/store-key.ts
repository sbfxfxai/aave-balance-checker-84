import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { storeWalletKey, hasWalletKey } from './keystore';

// Helper to access Node.js crypto module (available at runtime in Vercel)
function getCrypto() {
  // Use Function constructor to access require in a way TypeScript accepts
  const requireFunc = new Function('return require')();
  return requireFunc('crypto') as {
    randomBytes: (size: number) => Buffer;
    createHash: (algorithm: string) => {
      update: (data: string) => { digest: (encoding: string) => string };
    };
  };
}
import { checkRateLimit, RATE_LIMITS } from './rateLimit';
import { withMonitoring } from './monitoring';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { getRedis } from '../utils/redis';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type RiskProfile = 'low' | 'medium' | 'high' | 'aggressive';

interface StoreKeyResponse {
  success: boolean;
  message?: string;
  walletAddress?: string;
  paymentId?: string;
  error?: string;
  retryAfter?: number;
}

interface KeyStorageError extends Error {
  code?: 'TIMEOUT' | 'CONFLICT' | 'STORAGE_ERROR' | 'VALIDATION_ERROR';
}

// ============================================================================
// CONFIGURATION & VALIDATION
// ============================================================================

const VALID_RISK_PROFILES: readonly RiskProfile[] = ['low', 'medium', 'high', 'aggressive'] as const;
const MIN_ENCRYPTED_KEY_LENGTH = 64;
const MAX_ENCRYPTED_KEY_LENGTH = 4096;
const MIN_AMOUNT = 0.01;
const MAX_AMOUNT = 1_000_000;
const STORAGE_TIMEOUT = 6000; // 6 seconds
const MAX_REQUEST_SIZE = 32 * 1024; // 32KB
const MAX_IP_REQUESTS_PER_HOUR = 100; // Anti-abuse

// ============================================================================
// ZOD SCHEMA VALIDATION
// ============================================================================

const StoreKeySchema = z.object({
  walletAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum wallet address format'),
  encryptedPrivateKey: z.string()
    .min(MIN_ENCRYPTED_KEY_LENGTH, `Encrypted key must be at least ${MIN_ENCRYPTED_KEY_LENGTH} characters`)
    .max(MAX_ENCRYPTED_KEY_LENGTH, `Encrypted key must be at most ${MAX_ENCRYPTED_KEY_LENGTH} characters`)
    .regex(/^[A-Za-z0-9+/=]+$/, 'Encrypted key must be valid base64'),
  userEmail: z.string()
    .email('Invalid email address format')
    .max(254, 'Email address too long')
    .transform(email => email.toLowerCase().trim()),
  riskProfile: z.enum(VALID_RISK_PROFILES as [string, ...string[]], {
    errorMap: () => ({ message: `Invalid risk profile. Must be one of: ${VALID_RISK_PROFILES.join(', ')}` })
  }),
  amount: z.number()
    .min(MIN_AMOUNT, `Amount must be at least ${MIN_AMOUNT}`)
    .max(MAX_AMOUNT, `Amount must be at most ${MAX_AMOUNT}`),
  paymentId: z.string()
    .regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-zA-Z0-9]{8,64})$/i, 'Invalid payment ID format')
});

type StoreKeyRequest = z.infer<typeof StoreKeySchema>;

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Sanitize input to prevent injection attacks
 */
function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/[\r\n]/g, ' ') // Replace newlines with spaces
    .replace(/["']/g, '') // Remove quotes
    .trim()
    .substring(0, 1000); // Limit length
}

/**
 * Hash sensitive data for logging (privacy-compliant)
 */
function hashForLogging(data: string): string {
  const crypto = getCrypto();
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 8);
}

/**
 * Get client IP for logging
 */
function getClientIP(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const realIP = req.headers['x-real-ip'];
  const socketAddress = req.socket?.remoteAddress;
  
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim();
    return ip || 'unknown';
  }
  
  if (realIP) {
    const ip = Array.isArray(realIP) ? realIP[0] : realIP;
    return ip || 'unknown';
  }
  
  return socketAddress || 'unknown';
}

/**
 * Check request body size limit
 */
function validateRequestSize(req: VercelRequest): void {
  const bodySize = JSON.stringify(req.body || {}).length;
  if (bodySize > MAX_REQUEST_SIZE) {
    throw new Error(`Request body too large (${bodySize} bytes). Maximum allowed: ${MAX_REQUEST_SIZE} bytes`);
  }
}

/**
 * Check IP-based rate limiting for abuse prevention
 */
async function checkIPRateLimit(clientIP: string): Promise<void> {
  try {
    const redis = await getRedis();
    const ipKey = `ip_rate_limit:${clientIP}`;
    const current = await redis.incr(ipKey);
    
    if (current === 1) {
      await redis.expire(ipKey, 3600); // 1 hour
    }
    
    if (current > MAX_IP_REQUESTS_PER_HOUR) {
      throw new Error(`IP rate limit exceeded. Maximum ${MAX_IP_REQUESTS_PER_HOUR} requests per hour`);
    }
  } catch (error) {
    // If Redis fails, allow the request but log the issue
    logger.warn('Failed to check IP rate limit', LogCategory.AUTH, {
      clientIP,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Classify storage errors for better handling
 */
function classifyStorageError(error: Error): KeyStorageError {
  const errorMessage = error.message.toLowerCase();
  
  if (errorMessage.includes('timeout')) {
    const classifiedError = new Error('Storage operation timeout') as KeyStorageError;
    classifiedError.code = 'TIMEOUT';
    return classifiedError;
  }
  
  if (errorMessage.includes('conflict') || errorMessage.includes('already exists')) {
    const classifiedError = new Error('Key already exists') as KeyStorageError;
    classifiedError.code = 'CONFLICT';
    return classifiedError;
  }
  
  if (errorMessage.includes('redis') || errorMessage.includes('storage')) {
    const classifiedError = new Error('Storage service unavailable') as KeyStorageError;
    classifiedError.code = 'STORAGE_ERROR';
    return classifiedError;
  }
  
  const classifiedError = error as KeyStorageError;
  classifiedError.code = 'STORAGE_ERROR';
  return classifiedError;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS headers (restrictive for production)
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['https://www.tiltvault.com'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin ?? '')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await withMonitoring(req, res, 'store-key', async (): Promise<void> => {
    const startTime = Date.now();
    const clientIP = getClientIP(req);
    
    try {
      // Check request body size limit
      validateRequestSize(req);
      
      // Check IP-based rate limiting for abuse prevention
      await checkIPRateLimit(clientIP);
      
      // Validate and parse request body using Zod schema
      const validatedRequest = StoreKeySchema.parse(req.body);
      const { walletAddress, encryptedPrivateKey, userEmail, riskProfile, amount, paymentId } = validatedRequest;
      
      logger.info('Key storage request validated', LogCategory.API, {
        walletAddressHash: hashForLogging(walletAddress),
        emailHash: hashForLogging(userEmail),
        paymentId,
        riskProfile,
        amount,
        ip: clientIP
      });
      
      // Check for idempotency - prevent duplicate storage
      const existingKey = await hasWalletKey(walletAddress);
      if (existingKey) {
        logger.info('Idempotent duplicate key storage attempt', LogCategory.API, {
          walletAddressHash: hashForLogging(walletAddress),
          paymentId,
          ip: clientIP
        });
        
        const response: StoreKeyResponse = {
          success: true,
          message: 'Key already stored (idempotent)',
          walletAddress,
          paymentId
        };
        
        res.status(200).json(response);
        return;
      }
      
      // Rate limiting: per wallet address
      const rateLimitResult = await checkRateLimit(req, {
        ...RATE_LIMITS.STORE_KEY,
        identifier: walletAddress,
      });

      // Always set rate limit headers for consistency
      res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
      res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
      res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());

      if (!rateLimitResult.allowed) {
        logger.warn('Rate limit exceeded for key storage', LogCategory.API, {
          walletAddressHash: hashForLogging(walletAddress),
          paymentId,
          ip: clientIP,
          limit: rateLimitResult.limit,
          resetAt: rateLimitResult.resetAt,
          retryAfter: rateLimitResult.retryAfter
        });
        
        // Set Retry-After header (RFC 7231)
        if (rateLimitResult.retryAfter) {
          res.setHeader('Retry-After', rateLimitResult.retryAfter.toString());
        }
        
        const response: StoreKeyResponse = {
          success: false,
          error: 'rate_limit_exceeded',
          message: `Too many requests. Please try again after ${new Date(rateLimitResult.resetAt).toISOString()}`,
          retryAfter: rateLimitResult.retryAfter
        };
        
        res.status(429).json(response);
        return;
      }

      // Extract user-agent for token binding
      const userAgent = req.headers['user-agent'] || undefined;
      
      // Store encrypted key with timeout protection
      await Promise.race([
        storeWalletKey(
          walletAddress,
          encryptedPrivateKey,
          userEmail,
          riskProfile,
          amount,
          paymentId,
          clientIP, // Pass IP for token binding
          userAgent // Pass user-agent for token binding
        ),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Storage operation timeout')), STORAGE_TIMEOUT)
        )
      ]);
      
      // Privacy-compliant logging (no PII)
      logger.info('Encrypted wallet key stored successfully', LogCategory.API, {
        walletAddressHash: hashForLogging(walletAddress),
        emailHash: hashForLogging(userEmail),
        paymentId,
        riskProfile,
        amount,
        ip: clientIP,
        duration: Date.now() - startTime
      });
      
      const response: StoreKeyResponse = {
        success: true,
        message: 'Encrypted wallet stored securely (non-custodial)',
        walletAddress,
        paymentId
      };
      
      res.status(200).json(response);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const classifiedError = error instanceof Error ? classifyStorageError(error) : new Error(String(error)) as KeyStorageError;
      
      logger.error('Failed to store encrypted wallet key', LogCategory.API, {
        paymentId: req.body?.paymentId || 'unknown',
        ip: clientIP,
        error: errorMessage,
        errorCode: classifiedError.code,
        duration: Date.now() - startTime
      }, error instanceof Error ? error : new Error(errorMessage));
      
      errorTracker.trackError(error instanceof Error ? error : new Error(errorMessage), {
        category: 'wallet',
        context: {
          paymentId: req.body?.paymentId || 'unknown',
          endpoint: 'store-key',
          ip: clientIP,
          errorCode: classifiedError.code
        }
      });
      
      // Handle different error types with appropriate responses
      let statusCode = 500;
      let userMessage = 'Failed to store encrypted wallet key. Please try again later.';
      
      if (classifiedError.code === 'VALIDATION_ERROR' || errorMessage.includes('Invalid') || errorMessage.includes('Missing')) {
        statusCode = 400;
        userMessage = errorMessage;
      } else if (classifiedError.code === 'TIMEOUT') {
        statusCode = 503;
        userMessage = 'Storage service is temporarily unavailable. Please try again later.';
      } else if (classifiedError.code === 'CONFLICT') {
        statusCode = 409;
        userMessage = 'Key has already been stored for this payment.';
      } else if (errorMessage.includes('too large')) {
        statusCode = 413;
        userMessage = errorMessage;
      } else if (errorMessage.includes('IP rate limit')) {
        statusCode = 429;
        userMessage = 'Too many requests from your IP. Please try again later.';
      }
      
      const response: StoreKeyResponse = {
        success: false,
        error: userMessage
      };
      
      res.status(statusCode).json(response);
      return;
    }
  });
}
