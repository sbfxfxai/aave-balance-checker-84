import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import type { VercelRequest } from '@vercel/node';
import { createHash, randomUUID } from 'crypto';

// SIEM integration configuration
const SIEM_ENABLED = process.env.SIEM_ENABLED === 'true';

// Force Node.js runtime (required for crypto module)
export const config = {
  runtime: 'nodejs',
};

// ============================================================================
// TYPES & CONFIGURATION
// ============================================================================

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
  identifier?: string; // Optional: wallet address, email, etc.
  endpoint: string; // For logging
  algorithm?: 'fixed-window' | 'sliding-window';
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  windowStart?: number;
  windowEnd?: number;
  retryAfter?: number; // Seconds until retry allowed
  requiresCaptcha?: boolean; // ENHANCED: CAPTCHA requirement flag
  captchaProvider?: string; // ENHANCED: CAPTCHA provider (hcaptcha, recaptcha, etc.)
  adaptiveLimitApplied?: boolean; // ENHANCED: Whether adaptive tightening is active
}

export interface RateLimitViolation {
  timestamp: number;
  endpoint: string;
  clientId: string;
  ip?: string;
  userAgent?: string;
}

// Configuration constants
const BYPASS_RATE_LIMIT = process.env.DISABLE_RATE_LIMIT === 'true';
const DEFAULT_ALGORITHM = 'sliding-window';
const VIOLATION_LOG_LIMIT = 1000;
const VIOLATION_LOG_TTL = 7 * 24 * 60 * 60; // 7 days
const SLIDING_WINDOW_BUFFER = 2; // 2x window size for safety

// ENHANCED: Adaptive rate limiting configuration
const ADAPTIVE_RATE_LIMIT_ENABLED = process.env.ADAPTIVE_RATE_LIMIT_ENABLED !== 'false'; // Default: enabled
const ADAPTIVE_VIOLATION_THRESHOLD = parseInt(process.env.ADAPTIVE_VIOLATION_THRESHOLD || '5', 10); // Violations to trigger tightening
const ADAPTIVE_TIGHTENING_WINDOW = parseInt(process.env.ADAPTIVE_TIGHTENING_WINDOW || '300', 10); // 5 minutes
const ADAPTIVE_TIGHTENING_FACTOR = parseFloat(process.env.ADAPTIVE_TIGHTENING_FACTOR || '0.5'); // Reduce limit by 50%
const ADAPTIVE_TIGHTENING_DURATION = parseInt(process.env.ADAPTIVE_TIGHTENING_DURATION || '3600', 10); // 1 hour

// ENHANCED: CAPTCHA integration
const CAPTCHA_ENABLED = process.env.CAPTCHA_ENABLED !== 'false'; // Default: enabled
const CAPTCHA_WALLET_VIOLATION_THRESHOLD = parseInt(process.env.CAPTCHA_WALLET_VIOLATION_THRESHOLD || '3', 10); // Require CAPTCHA after 3 wallet violations
const CAPTCHA_PROVIDER = process.env.CAPTCHA_PROVIDER || 'hcaptcha'; // 'hcaptcha' | 'recaptcha' | 'turnstile'
const CAPTCHA_SECRET_KEY = process.env.CAPTCHA_SECRET_KEY || process.env.HCAPTCHA_SECRET_KEY;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Hash identifier for privacy compliance (GDPR)
 * Prevents storing raw IP addresses or personal data
 */
function hashIdentifier(identifier: string): string {
  return createHash('sha256')
    .update(identifier)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Generate device fingerprint from request headers
 * Combines user-agent + accept-language + accept-encoding for device identification
 */
function generateDeviceFingerprint(req: VercelRequest): string {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';
  
  const fingerprint = `${userAgent}|${acceptLanguage}|${acceptEncoding}`;
  return hashIdentifier(fingerprint);
}

/**
 * Get client identifier from request
 * Uses provided identifier (wallet/email) or falls back to IP
 */
function getClientId(req: VercelRequest, identifier?: string): string {
  if (identifier) {
    return identifier.toLowerCase().trim();
  }
  
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim())
    : req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  
  return ip as string;
}

/**
 * Log rate limit violation for security monitoring
 */
async function logRateLimitViolation(
  endpoint: string,
  clientId: string,
  req: VercelRequest
): Promise<void> {
  try {
    const redis = await getRedis();
    const logKey = `rate_limit_violations:${endpoint}`;
    const logEntry: RateLimitViolation = {
      timestamp: Date.now(),
      endpoint,
      clientId: hashIdentifier(clientId), // Hash for privacy
      ip: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    
    await redis.lpush(logKey, JSON.stringify(logEntry));
    await redis.ltrim(logKey, 0, VIOLATION_LOG_LIMIT - 1);
    await redis.expire(logKey, VIOLATION_LOG_TTL);
    
    logger.warn('Rate limit violation detected', LogCategory.AUTH, {
      endpoint,
      clientId: hashIdentifier(clientId),
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
    });
    
    errorTracker.trackError(new Error(`Rate limit violation: ${endpoint}`), {
      category: 'security',
      context: {
        endpoint,
        clientId: hashIdentifier(clientId),
        ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress
      }
    });
    
  } catch (error) {
    logger.error('Failed to log rate limit violation', LogCategory.AUTH, {
      endpoint,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * ENHANCED: Track violations by factor with adaptive tightening
 * Tracks violations and applies dynamic rate limit reduction if threshold exceeded
 */
async function trackViolationByFactor(
  endpoint: string,
  clientId: string,
  req: VercelRequest
): Promise<void> {
  try {
    const redis = await getRedis();
    const now = Date.now();
    const factor = clientId.includes('@') ? 'email' : 
                   clientId.startsWith('0x') ? 'wallet' : 'ip';
    const hashedClientId = hashIdentifier(clientId);
    
    // Track per-factor violations (for anomaly detection)
    const factorKey = `monitoring:rate_limit:${factor}_violations:${endpoint}:${hashedClientId}`;
    const violationCount = await redis.incr(factorKey);
    await redis.expire(factorKey, ADAPTIVE_TIGHTENING_WINDOW); // 5 minute window
    
    // ENHANCED: Adaptive rate limiting - dynamically tighten limits if threshold exceeded
    if (ADAPTIVE_RATE_LIMIT_ENABLED && violationCount >= ADAPTIVE_VIOLATION_THRESHOLD) {
      const adaptiveKey = `adaptive_rate_limit:${endpoint}:${hashedClientId}`;
      const adaptiveData = {
        originalLimit: null as number | null, // Will be set on first violation
        reducedLimit: null as number | null,
        appliedAt: now,
        expiresAt: now + (ADAPTIVE_TIGHTENING_DURATION * 1000)
      };
      
      // Check if already applied
      const existing = await redis.get(adaptiveKey);
      if (!existing) {
        // First time hitting threshold - apply tightening
        logger.warn('Adaptive rate limiting triggered', LogCategory.AUTH, {
          endpoint,
          factor,
          violationCount,
          tighteningFactor: ADAPTIVE_TIGHTENING_FACTOR,
          duration: ADAPTIVE_TIGHTENING_DURATION
        });
        
        await redis.set(adaptiveKey, JSON.stringify(adaptiveData), { ex: ADAPTIVE_TIGHTENING_DURATION });
      }
    }
    
    // ENHANCED: Track wallet violations for CAPTCHA requirement
    if (factor === 'wallet' && CAPTCHA_ENABLED) {
      const walletViolationKey = `captcha_required:wallet:${hashedClientId}`;
      const walletViolations = await redis.incr(walletViolationKey);
      await redis.expire(walletViolationKey, 3600); // 1 hour window
      
      if (walletViolations >= CAPTCHA_WALLET_VIOLATION_THRESHOLD) {
        // Mark that CAPTCHA is required for this wallet
        await redis.set(`captcha_required:${hashedClientId}`, '1', { ex: 3600 });
        
        logger.warn('CAPTCHA required due to wallet violations', LogCategory.AUTH, {
          endpoint,
          walletViolations,
          threshold: CAPTCHA_WALLET_VIOLATION_THRESHOLD
        });
      }
    }
    
    // Track total violations per endpoint (for alerting)
    const totalKey = `monitoring:rate_limit:total_violations:${endpoint}`;
    await redis.incr(totalKey);
    await redis.expire(totalKey, 3600); // 1 hour window
    
    // ENHANCED: Global signals integration - track system-wide violations
    const globalViolationsKey = 'monitoring:rate_limit:global_violations';
    const globalViolations = await redis.incr(globalViolationsKey);
    await redis.expire(globalViolationsKey, 60); // 1 minute window for global tracking
    
    // ENHANCED: Apply global tightening if system-wide violations exceed threshold
    const GLOBAL_VIOLATION_THRESHOLD = parseInt(process.env.GLOBAL_VIOLATION_THRESHOLD || '100', 10); // 100 violations/min
    const GLOBAL_TIGHTENING_FACTOR = parseFloat(process.env.GLOBAL_TIGHTENING_FACTOR || '0.7'); // Reduce all limits by 30%
    
    if (globalViolations >= GLOBAL_VIOLATION_THRESHOLD) {
      const globalTighteningKey = 'adaptive_rate_limit:global_tightening';
      const globalTightening = await redis.get(globalTighteningKey);
      
      if (!globalTightening) {
        // Apply global tightening across all endpoints
        const tighteningData = {
          appliedAt: now,
          expiresAt: now + (ADAPTIVE_TIGHTENING_DURATION * 1000),
          globalViolations,
          tighteningFactor: GLOBAL_TIGHTENING_FACTOR
        };
        
        await redis.set(globalTighteningKey, JSON.stringify(tighteningData), { ex: ADAPTIVE_TIGHTENING_DURATION });
        
        logger.warn('Global rate limit tightening applied', LogCategory.AUTH, {
          globalViolations,
          threshold: GLOBAL_VIOLATION_THRESHOLD,
          tighteningFactor: GLOBAL_TIGHTENING_FACTOR,
          duration: ADAPTIVE_TIGHTENING_DURATION
        });
        
        // Forward to SIEM for alerting
        if (SIEM_ENABLED) {
          try {
            const { forwardToSIEM } = await import('../utils/siem-integration');
            await forwardToSIEM({
              timestamp: now,
              eventType: 'security_alert',
              severity: 'critical',
              endpoint: 'global',
              metadata: {
                alertType: 'global_rate_limit_tightening',
                globalViolations,
                threshold: GLOBAL_VIOLATION_THRESHOLD,
                tighteningFactor: GLOBAL_TIGHTENING_FACTOR
              }
            }).catch(() => {
              // Fire-and-forget
            });
          } catch (siemError) {
            // SIEM not available
          }
        }
      }
    }
    
    // ENHANCED: Forward to SIEM for anomaly detection
    if (SIEM_ENABLED) {
      try {
        const { forwardToSIEM } = await import('../utils/siem-integration');
        await forwardToSIEM({
          timestamp: now,
          eventType: 'rate_limit_violation',
          severity: violationCount >= ADAPTIVE_VIOLATION_THRESHOLD ? 'high' : 'medium',
          endpoint,
          clientId: hashedClientId,
          ip: req.headers['x-forwarded-for'] as string || req.socket?.remoteAddress,
          userAgent: req.headers['user-agent'],
          metadata: { factor, violationCount }
        }).catch(err => {
          // Don't block on SIEM failures
          logger.warn('SIEM forwarding failed', LogCategory.AUTH, {
            error: err instanceof Error ? err.message : String(err)
          });
        });
      } catch (siemError) {
        // SIEM integration not available - continue without it
        logger.debug('SIEM integration not available', LogCategory.AUTH);
      }
    }
    
    // Check for anomaly (high violation rate)
    const totalViolations = await redis.get<number>(totalKey) || 0;
    if (totalViolations > 20) { // Threshold: 20 violations/hour
      logger.warn('High rate limit violation rate detected', LogCategory.AUTH, {
        endpoint,
        violations: totalViolations,
        factor,
        threshold: 20
      });
      
      // Trigger external alert if configured
      const webhookUrl = process.env.ALERTING_WEBHOOK_URL;
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'rate_limit_anomaly',
            severity: 'warning',
            timestamp: new Date().toISOString(),
            data: {
              endpoint,
              violations: totalViolations,
              factor,
              threshold: 20
            }
          })
        }).catch(() => {}); // Fire and forget
      }
    }
    
  } catch (error) {
    logger.debug('Failed to track violation by factor', LogCategory.AUTH, {
      endpoint,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Get rate limit violations for monitoring
 */
export async function getRateLimitViolations(
  endpoint?: string,
  limit: number = 50
): Promise<RateLimitViolation[]> {
  try {
    const redis = await getRedis();
    const pattern = endpoint ? `rate_limit_violations:${endpoint}` : 'rate_limit_violations:*';
    
    const keys = await redis.keys(pattern);
    const violations: RateLimitViolation[] = [];
    
    for (const key of keys) {
      const logs = (await redis.lrange(key, 0, limit - 1)) as string[];
      violations.push(...logs.map(log => JSON.parse(log)));
    }
    
    return violations
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
      
  } catch (error) {
    logger.error('Failed to get rate limit violations', LogCategory.AUTH, {
      endpoint,
      limit,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return [];
  }
}

// ============================================================================
// RATE LIMITING ALGORITHMS
// ============================================================================

/**
 * Fixed window rate limiting (atomic with race condition fix)
 * Simple but can allow bursts at window boundaries
 */
async function checkFixedWindowRateLimit(
  rateLimitKey: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  try {
    const redis = await getRedis();
    
    // Atomic increment - returns new value
    const count = await redis.incr(rateLimitKey);
    
    // Set expiry only on first request to prevent race conditions
    if (count === 1) {
      await redis.expire(rateLimitKey, config.windowSeconds);
    }
    
    // Get TTL for accurate resetAt calculation
    const ttl = await redis.ttl(rateLimitKey);
    const resetAt = Date.now() + (ttl > 0 ? ttl * 1000 : config.windowSeconds * 1000);
    
    // Check if limit exceeded
    if (count > config.maxRequests) {
    const retryAfter = Math.ceil((resetAt - Date.now()) / 1000); // Seconds until retry
    
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      limit: config.maxRequests,
      retryAfter,
    };
    }
    
    return {
      allowed: true,
      remaining: config.maxRequests - count,
      resetAt,
      limit: config.maxRequests,
    };
    
  } catch (error) {
    logger.error('Fixed window rate limit check failed', LogCategory.AUTH, {
      endpoint: config.endpoint,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    // Fail open on errors to prevent blocking legitimate users
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: Date.now() + (config.windowSeconds * 1000),
      limit: config.maxRequests,
    };
  }
}

/**
 * Sliding window rate limiting (more accurate, prevents burst attacks)
 * Uses Redis sorted sets for time-based tracking
 */
async function checkSlidingWindowRateLimit(
  rateLimitKey: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  try {
    const redis = await getRedis();
    const now = Date.now();
    const windowStart = now - (config.windowSeconds * 1000);
    const windowEnd = now;
    
    // Use pipeline for atomic operations
    const pipeline = redis.pipeline();
    
    // Remove old entries outside the current window
    pipeline.zremrangebyscore(rateLimitKey, 0, windowStart);
    
    // Count current entries in the window
    pipeline.zcard(rateLimitKey);
    
    // Get oldest entry for accurate reset time
    pipeline.zrange(rateLimitKey, 0, 0, { withScores: true });
    
    const results = await pipeline.exec();
    const count = results[1]?.[1] as number || 0;
    const oldestEntries = (results[2]?.[1] as any[]) || [];
    
    // Calculate reset time based on oldest entry or window end
    let resetAt: number;
    if (oldestEntries && Array.isArray(oldestEntries) && oldestEntries.length > 0) {
      const oldestEntry = oldestEntries[0];
      const oldestTimestamp = Number(oldestEntry?.score || oldestEntry?.[1] || windowStart);
      resetAt = oldestTimestamp + (config.windowSeconds * 1000);
    } else {
      resetAt = windowEnd + (config.windowSeconds * 1000);
    }
    
    // Check if limit exceeded
    if (count >= config.maxRequests) {
      const retryAfter = Math.ceil((resetAt - now) / 1000); // Seconds until retry
      
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        limit: config.maxRequests,
        windowStart,
        windowEnd,
        retryAfter
      };
    }
    
    // Add current request with unique ID to prevent collisions
    const requestId = `${now}-${randomUUID()}`;
    await redis.zadd(rateLimitKey, { score: now, member: requestId });
    await redis.expire(rateLimitKey, config.windowSeconds * SLIDING_WINDOW_BUFFER);
    
    return {
      allowed: true,
      remaining: config.maxRequests - count - 1,
      resetAt,
      limit: config.maxRequests,
      windowStart,
      windowEnd
    };
    
  } catch (error) {
    logger.error('Sliding window rate limit check failed', LogCategory.AUTH, {
      endpoint: config.endpoint,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    // Fail open on errors
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: Date.now() + (config.windowSeconds * 1000),
      limit: config.maxRequests,
    };
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Multi-factor rate limiting for high-risk operations
 * Checks multiple identifiers (IP + wallet + email hash) and blocks if ANY exceeds limit
 * 
 * @param req Request object
 * @param config Rate limit configuration
 * @param multiFactorIdentifiers Additional identifiers to check (email, wallet, etc.)
 * @returns Rate limit result (blocked if ANY factor exceeds limit)
 */
export async function checkMultiFactorRateLimit(
  req: VercelRequest,
  config: RateLimitConfig,
  multiFactorIdentifiers?: {
    email?: string;
    wallet?: string;
    userId?: string;
    includeDeviceFingerprint?: boolean;
  }
): Promise<RateLimitResult> {
  const startTime = Date.now();
  
  // Bypass in development if configured
  if (BYPASS_RATE_LIMIT) {
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: Date.now() + (config.windowSeconds * 1000),
      limit: config.maxRequests,
    };
  }
  
  try {
    // Check primary identifier (IP or provided identifier)
    const primaryResult = await checkRateLimit(req, config);
    
    // If primary check fails, block immediately
    if (!primaryResult.allowed) {
      return primaryResult;
    }
    
    // For high-risk operations, check additional factors
    if (multiFactorIdentifiers) {
      const factors: Array<{ name: string; result: RateLimitResult }> = [];
      
      // Check IP-based limit
      const ipResult = await checkRateLimit(req, {
        ...config,
        identifier: undefined // Force IP-based check
      });
      factors.push({ name: 'ip', result: ipResult });
      
      // Check wallet-based limit if provided
      if (multiFactorIdentifiers.wallet) {
        const walletResult = await checkRateLimit(req, {
          ...config,
          identifier: multiFactorIdentifiers.wallet,
          maxRequests: Math.floor(config.maxRequests * 0.7) // Stricter for wallet
        });
        factors.push({ name: 'wallet', result: walletResult });
      }
      
      // Check email-based limit if provided
      if (multiFactorIdentifiers.email) {
        const emailHash = hashIdentifier(multiFactorIdentifiers.email);
        const emailResult = await checkRateLimit(req, {
          ...config,
          identifier: emailHash,
          maxRequests: Math.floor(config.maxRequests * 0.7) // Stricter for email
        });
        factors.push({ name: 'email', result: emailResult });
      }
      
      // Check device fingerprint if enabled (4th factor for bypass resistance)
      if (multiFactorIdentifiers.includeDeviceFingerprint) {
        const deviceFingerprint = generateDeviceFingerprint(req);
        const deviceResult = await checkRateLimit(req, {
          ...config,
          identifier: deviceFingerprint,
          maxRequests: Math.floor(config.maxRequests * 0.8) // Slightly stricter for device
        });
        factors.push({ name: 'device', result: deviceResult });
      }
      
      // Block if ANY factor exceeds limit
      const blockedFactor = factors.find(f => !f.result.allowed);
      if (blockedFactor) {
        logger.warn('Multi-factor rate limit blocked', LogCategory.AUTH, {
          endpoint: config.endpoint,
          blockedFactor: blockedFactor.name,
          factors: factors.map(f => ({ name: f.name, allowed: f.result.allowed }))
        });
        
        const retryAfter = Math.ceil((blockedFactor.result.resetAt - Date.now()) / 1000);
        
        return {
          allowed: false,
          remaining: 0,
          resetAt: blockedFactor.result.resetAt,
          limit: config.maxRequests,
          retryAfter,
        };
      }
      
      // Return most restrictive remaining count
      const minRemaining = Math.min(...factors.map(f => f.result.remaining));
      const maxResetAt = Math.max(...factors.map(f => f.result.resetAt));
      
      return {
        allowed: true,
        remaining: minRemaining,
        resetAt: maxResetAt,
        limit: config.maxRequests,
      };
    }
    
    return primaryResult;
    
  } catch (error) {
    logger.error('Multi-factor rate limit check failed', LogCategory.AUTH, {
      endpoint: config.endpoint,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    // Fail open on errors
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: Date.now() + (config.windowSeconds * 1000),
      limit: config.maxRequests,
    };
  }
}

/**
 * Check rate limit for a client
 * 
 * Features:
 * - Atomic operations to prevent race conditions
 * - Privacy-compliant identifier hashing
 * - Both fixed and sliding window algorithms
 * - Comprehensive violation logging
 * - Development bypass capability
 * - Fail-open on errors
 */
export async function checkRateLimit(
  req: VercelRequest,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const startTime = Date.now();
  
  // Bypass in development if configured
  if (BYPASS_RATE_LIMIT) {
    logger.debug('Rate limit bypassed', LogCategory.AUTH, {
      endpoint: config.endpoint,
      reason: 'DISABLE_RATE_LIMIT=true'
    });
    
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: Date.now() + (config.windowSeconds * 1000),
      limit: config.maxRequests,
    };
  }
  
  try {
    const redis = await getRedis();
    const clientId = getClientId(req, config.identifier);
    const hashedClientId = hashIdentifier(clientId);
    const algorithm = config.algorithm || DEFAULT_ALGORITHM;
    const rateLimitKey = `rate_limit:${algorithm}:${config.endpoint}:${hashedClientId}`;
    
    logger.debug('Checking rate limit', LogCategory.AUTH, {
      endpoint: config.endpoint,
      algorithm,
      clientId: hashedClientId,
      maxRequests: config.maxRequests,
      windowSeconds: config.windowSeconds
    });
    
    // ENHANCED: Check for adaptive rate limiting (dynamic tightening)
    let effectiveConfig = { ...config };
    if (ADAPTIVE_RATE_LIMIT_ENABLED) {
      const adaptiveKey = `adaptive_rate_limit:${config.endpoint}:${hashedClientId}`;
      const adaptiveDataStr = await redis.get(adaptiveKey);
      
      if (adaptiveDataStr) {
        try {
          const adaptiveData = JSON.parse(adaptiveDataStr as string);
          const now = Date.now();
          
          // Check if adaptive limit is still active
          if (now < adaptiveData.expiresAt) {
            // Apply reduced limit (50% of original by default)
            effectiveConfig.maxRequests = Math.floor(config.maxRequests * ADAPTIVE_TIGHTENING_FACTOR);
            
            logger.debug('Adaptive rate limit applied', LogCategory.AUTH, {
              endpoint: config.endpoint,
              originalLimit: config.maxRequests,
              reducedLimit: effectiveConfig.maxRequests,
              expiresAt: new Date(adaptiveData.expiresAt).toISOString()
            });
          } else {
            // Expired - clean up
            await redis.del(adaptiveKey);
          }
        } catch (parseError) {
          // Invalid adaptive data - ignore and use original config
          logger.warn('Failed to parse adaptive rate limit data', LogCategory.AUTH, {
            endpoint: config.endpoint,
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
        }
      }
    }
    
    let result: RateLimitResult;
    
    if (algorithm === 'sliding-window') {
      result = await checkSlidingWindowRateLimit(rateLimitKey, effectiveConfig);
    } else {
      result = await checkFixedWindowRateLimit(rateLimitKey, effectiveConfig);
    }
    
    // ENHANCED: Check if CAPTCHA is required
    let requiresCaptcha = false;
    if (CAPTCHA_ENABLED) {
      try {
        const captchaRequired = await redis.get(`captcha_required:${hashedClientId}`);
        requiresCaptcha = captchaRequired === '1';
      } catch (captchaCheckError) {
        // Fail open - don't block if CAPTCHA check fails
        logger.warn('Failed to check CAPTCHA requirement', LogCategory.AUTH, {
          error: captchaCheckError instanceof Error ? captchaCheckError.message : String(captchaCheckError)
        });
      }
    }
    
    // Calculate retry-after for blocked requests
    if (!result.allowed) {
      result.retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
      await logRateLimitViolation(config.endpoint, clientId, req);
      await trackViolationByFactor(config.endpoint, clientId, req);
    }
    
    // Add CAPTCHA requirement to result
    if (requiresCaptcha) {
      result.requiresCaptcha = true;
      result.captchaProvider = CAPTCHA_PROVIDER;
    }
    
    // Add adaptive limit indicator
    if (effectiveConfig.maxRequests < config.maxRequests) {
      result.adaptiveLimitApplied = true;
    }
    
    logger.debug('Rate limit check completed', LogCategory.AUTH, {
      endpoint: config.endpoint,
      allowed: result.allowed,
      remaining: result.remaining,
      duration: Date.now() - startTime
    });
    
    return result;
    
  } catch (error) {
    logger.error('Rate limit check failed', LogCategory.AUTH, {
      endpoint: config.endpoint,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    // Fail open (allow request) on errors to prevent blocking legitimate users
    // But log the error for investigation
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: Date.now() + (config.windowSeconds * 1000),
      limit: config.maxRequests,
    };
  }
}

/**
 * Get current rate limit status without incrementing
 * Useful for displaying current limits to users
 */
export async function getRateLimitStatus(
  req: VercelRequest,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  try {
    const clientId = getClientId(req, config.identifier);
    const hashedClientId = hashIdentifier(clientId);
    const algorithm = config.algorithm || DEFAULT_ALGORITHM;
    const rateLimitKey = `rate_limit:${algorithm}:${config.endpoint}:${hashedClientId}`;
    
    const now = Date.now();
    const windowStart = now - (config.windowSeconds * 1000);
    
    if (algorithm === 'sliding-window') {
      const redis = await getRedis();
      
      // Remove old entries
      await redis.zremrangebyscore(rateLimitKey, 0, windowStart);
      
      // Count current entries
      const count = await redis.zcard(rateLimitKey);
      
      // Get oldest entry for reset time
      const oldestEntries = await redis.zrange(rateLimitKey, 0, 0, { withScores: true });
      let resetAt: number;
      
      if (oldestEntries.length > 0) {
        const oldestTimestamp = Number(oldestEntries[0].score);
        resetAt = oldestTimestamp + (config.windowSeconds * 1000);
      } else {
        resetAt = now + (config.windowSeconds * 1000);
      }
      
      return {
        allowed: count < config.maxRequests,
        remaining: Math.max(0, config.maxRequests - count),
        resetAt,
        limit: config.maxRequests,
        windowStart,
        windowEnd: now
      };
      
    } else {
      const redis = await getRedis();
      
      const count = await redis.get<number>(rateLimitKey) || 0;
      const ttl = await redis.ttl(rateLimitKey);
      
      return {
        allowed: count < config.maxRequests,
        remaining: Math.max(0, config.maxRequests - count),
        resetAt: Date.now() + (ttl > 0 ? ttl * 1000 : config.windowSeconds * 1000),
        limit: config.maxRequests,
      };
    }
    
  } catch (error) {
    logger.error('Failed to get rate limit status', LogCategory.AUTH, {
      endpoint: config.endpoint,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    // Return default status on error
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: Date.now() + (config.windowSeconds * 1000),
      limit: config.maxRequests,
    };
  }
}

/**
 * Reset rate limit for a specific client (admin function)
 * Useful for testing or manual intervention
 */
export async function resetRateLimit(
  endpoint: string,
  identifier: string,
  algorithm: 'fixed-window' | 'sliding-window' = DEFAULT_ALGORITHM
): Promise<boolean> {
  try {
    const redis = await getRedis();
    const hashedIdentifier = hashIdentifier(identifier);
    
    // Delete both algorithm keys
    const fixedKey = `rate_limit:fixed-window:${endpoint}:${hashedIdentifier}`;
    const slidingKey = `rate_limit:sliding-window:${endpoint}:${hashedIdentifier}`;
    
    const [deletedFixed, deletedSliding] = await Promise.all([
      redis.del(fixedKey),
      redis.del(slidingKey)
    ]);
    
    logger.info('Rate limit reset', LogCategory.AUTH, {
      endpoint,
      identifier: hashedIdentifier,
      algorithm,
      deletedFixed,
      deletedSliding
    });
    
    return deletedFixed > 0 || deletedSliding > 0;
    
  } catch (error) {
    logger.error('Failed to reset rate limit', LogCategory.AUTH, {
      endpoint,
      identifier: hashIdentifier(identifier),
      algorithm,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return false;
  }
}

/**
 * Get rate limit statistics for monitoring
 */
export async function getRateLimitStats(
  endpoint?: string
): Promise<{
  totalKeys: number;
  activeKeys: number;
  algorithms: { 'fixed-window': number; 'sliding-window': number };
  topEndpoints: Array<{ endpoint: string; keyCount: number }>;
}> {
  try {
    const redis = await getRedis();
    
    const pattern = endpoint ? `rate_limit:*:${endpoint}:*` : 'rate_limit:*';
    const keys = await redis.keys(pattern);
    
    const algorithmCounts = { 'fixed-window': 0, 'sliding-window': 0 };
    const endpointCounts: Record<string, number> = {};
    
    for (const key of keys) {
      const parts = key.split(':');
      const algorithm = parts[1] as 'fixed-window' | 'sliding-window';
      const keyEndpoint = parts[2];
      
      algorithmCounts[algorithm]++;
      endpointCounts[keyEndpoint] = (endpointCounts[keyEndpoint] || 0) + 1;
    }
    
    // Check which keys are still active (have TTL)
    const activeKeys = await Promise.all(
      keys.map(async key => {
        const ttl = await redis.ttl(key);
        return ttl > 0;
      })
    );
    
    const activeCount = activeKeys.filter(Boolean).length;
    
    // Get top endpoints by key count
    const topEndpoints = Object.entries(endpointCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([endpoint, count]) => ({ endpoint, keyCount: count }));
    
    return {
      totalKeys: keys.length,
      activeKeys: activeCount,
      algorithms: algorithmCounts,
      topEndpoints
    };
    
  } catch (error) {
    logger.error('Failed to get rate limit statistics', LogCategory.AUTH, {
      endpoint,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return {
      totalKeys: 0,
      activeKeys: 0,
      algorithms: { 'fixed-window': 0, 'sliding-window': 0 },
      topEndpoints: []
    };
  }
}

// ============================================================================
// RATE LIMIT CONFIGURATIONS
// ============================================================================

/**
 * Rate limit configurations for different wallet endpoints
 * Uses sliding window algorithm for most endpoints to prevent burst attacks
 */
export const RATE_LIMITS = {
  // Store key: 10 requests per wallet per hour
  STORE_KEY: {
    maxRequests: 10,
    windowSeconds: 3600,
    endpoint: 'store-key',
    algorithm: 'sliding-window' as const,
  },
  
  // Store payment info: 20 requests per payment ID per hour
  STORE_PAYMENT_INFO: {
    maxRequests: 20,
    windowSeconds: 3600,
    endpoint: 'store-payment-info',
    algorithm: 'sliding-window' as const,
  },
  
  // Send email: 5 requests per email per hour (prevent spam)
  SEND_EMAIL: {
    maxRequests: 5,
    windowSeconds: 3600,
    endpoint: 'send-email',
    algorithm: 'sliding-window' as const,
  },
  
  // Decrypt mnemonic: 3 requests per email per hour (very security-sensitive)
  DECRYPT_MNEMONIC: {
    maxRequests: 3,
    windowSeconds: 3600,
    endpoint: 'decrypt-mnemonic',
    algorithm: 'sliding-window' as const,
  },
  
  // Status check: 60 requests per payment ID per minute (frequent polling)
  STATUS: {
    maxRequests: 60,
    windowSeconds: 60,
    endpoint: 'status',
    algorithm: 'fixed-window' as const, // Fixed window OK for high-frequency polling
  },
  
  // Wallet association: 10 requests per wallet per hour
  ASSOCIATE_WALLET: {
    maxRequests: 10,
    windowSeconds: 3600,
    endpoint: 'associate-wallet',
    algorithm: 'sliding-window' as const,
  },
  
  // General API: 100 requests per IP per minute
  GENERAL_API: {
    maxRequests: 100,
    windowSeconds: 60,
    endpoint: 'general-api',
    algorithm: 'sliding-window' as const,
  },
} as const;

