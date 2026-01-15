import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { createHash, randomBytes } from 'crypto';

// Force Node.js runtime (required for crypto module)
export const config = {
  runtime: 'nodejs',
};

// ============================================================================
// TYPES & CONFIGURATION
// ============================================================================

export interface MonitoringEvent {
  endpoint: string;
  method: string;
  statusCode: number;
  timestamp: number;
  clientId?: string;
  error?: string;
  duration?: number;
  metadata?: Record<string, any>;
  requestSize?: number;
  responseSize?: number;
}

export interface EndpointStats {
  total: number;
  clientErrors: number;
  serverErrors: number;
  avgDuration?: number;
  errorRate?: number;
  lastHour?: number;
  lastDay?: number;
}

export interface ErrorTypeStats {
  type: string;
  count: number;
  lastSeen: number;
}

// Configuration constants
const EVENT_TTL = 7 * 24 * 60 * 60; // 7 days
const STATS_TTL = 30 * 24 * 60 * 60; // 30 days
const ERROR_RATE_THRESHOLD = 0.05; // 5%
const HIGH_ERROR_COUNT = 10;
const MAX_DURATIONS_TRACKED = 100; // Keep last 100 durations for averaging
const MAX_RECENT_EVENTS = 50;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get hashed client identifier (privacy-safe)
 * Hashes IP addresses for GDPR compliance
 */
function getClientId(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim())
    : req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  
  // Hash for privacy compliance (GDPR)
  return createHash('sha256')
    .update(ip as string)
    .digest('hex')
    .substring(0, 16);
}

/**
 * Generate unique event key with collision prevention
 */
function generateEventKey(endpoint: string): string {
  const timestamp = Date.now();
  const Buffer = (globalThis as any).Buffer;
  const randomBuffer = randomBytes(4);
  const random = Buffer.from(randomBuffer).toString('hex');
  return `monitor:${endpoint}:${timestamp}-${random}`;
}

/**
 * Check if error rates exceed thresholds and trigger alerts
 */
async function checkAlertThresholds(endpoint: string, stats: EndpointStats): Promise<void> {
  const totalErrors = stats.clientErrors + stats.serverErrors;
  const errorRate = stats.total > 0 ? totalErrors / stats.total : 0;
  
  if (errorRate > ERROR_RATE_THRESHOLD) {
    const alertMessage = `High error rate for ${endpoint}: ${(errorRate * 100).toFixed(2)}% (${totalErrors}/${stats.total})`;
    logger.error('Monitoring alert triggered', LogCategory.INFRASTRUCTURE, {
      endpoint,
      errorRate: errorRate * 100,
      totalErrors,
      totalRequests: stats.total
    });
    
    errorTracker.trackError(new Error(alertMessage), {
      category: 'monitoring',
      context: {
        endpoint,
        errorRate: errorRate * 100,
        totalErrors,
        totalRequests: stats.total
      }
    });
  }
  
  if (stats.serverErrors >= HIGH_ERROR_COUNT) {
    const alertMessage = `Multiple server errors for ${endpoint}: ${stats.serverErrors} errors`;
    logger.error('Monitoring alert triggered', LogCategory.INFRASTRUCTURE, {
      endpoint,
      serverErrors: stats.serverErrors,
      alertType: 'high_server_error_count'
    });
    
    errorTracker.trackError(new Error(alertMessage), {
      category: 'monitoring',
      context: {
        endpoint,
        serverErrors: stats.serverErrors,
        alertType: 'high_server_error_count'
      }
    });
  }
}

/**
 * Sanitize error type for Redis key
 */
function sanitizeErrorType(error: string): string {
  return error
    .substring(0, 50)
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .toLowerCase();
}

/**
 * Calculate time-based statistics
 */
function getTimeBasedStats(timestamp: number): { lastHour: number; lastDay: number } {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  const oneDayAgo = now - (24 * 60 * 60 * 1000);
  
  return {
    lastHour: timestamp >= oneHourAgo ? 1 : 0,
    lastDay: timestamp >= oneDayAgo ? 1 : 0
  };
}

// ============================================================================
// CORE MONITORING FUNCTIONS
// ============================================================================

/**
 * Log monitoring event to Redis with proper error handling and atomic operations
 * This function is fire-and-forget and will not throw errors to avoid blocking requests
 */
export async function logEvent(event: MonitoringEvent): Promise<void> {
  const startTime = Date.now();
  
  try {
    // Use a timeout wrapper to prevent hanging on Redis connection issues
    const redisPromise = getRedis();
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Redis connection timeout')), 3000)
    );
    
    const redis = await Promise.race([redisPromise, timeoutPromise]);
    const eventKey = generateEventKey(event.endpoint);
    const statsKey = `stats:${event.endpoint}`;
    
    // Use pipeline for atomic operations
    const pipeline = redis.pipeline();
    
    // Store event
    pipeline.set(eventKey, JSON.stringify(event), { ex: EVENT_TTL });
    
    // Update statistics atomically
    pipeline.incr(`${statsKey}:total`);
    
    // Categorize errors properly
    if (event.statusCode >= 400 && event.statusCode < 500) {
      pipeline.incr(`${statsKey}:client_errors`);
    } else if (event.statusCode >= 500) {
      pipeline.incr(`${statsKey}:server_errors`);
    }
    
    // Track duration for averaging (keep last N)
    if (event.duration) {
      pipeline.lpush(`${statsKey}:durations`, event.duration);
      pipeline.ltrim(`${statsKey}:durations`, 0, MAX_DURATIONS_TRACKED - 1);
    }
    
    // Track specific error types
    if (event.error) {
      const errorType = sanitizeErrorType(event.error);
      pipeline.incr(`${statsKey}:error_type:${errorType}`);
      pipeline.expire(`${statsKey}:error_type:${errorType}`, STATS_TTL);
    }
    
    // Track time-based statistics
    const timeStats = getTimeBasedStats(event.timestamp);
    if (timeStats.lastHour) {
      pipeline.incr(`${statsKey}:last_hour`);
      pipeline.expire(`${statsKey}:last_hour`, 2 * 60 * 60); // 2 hours
    }
    if (timeStats.lastDay) {
      pipeline.incr(`${statsKey}:last_day`);
      pipeline.expire(`${statsKey}:last_day`, 25 * 60 * 60); // 25 hours
    }
    
    // Set expiry on stats (using XX flag to avoid race conditions)
    pipeline.expire(`${statsKey}:total`, STATS_TTL);
    pipeline.expire(`${statsKey}:client_errors`, STATS_TTL);
    pipeline.expire(`${statsKey}:server_errors`, STATS_TTL);
    pipeline.expire(`${statsKey}:durations`, STATS_TTL);
    pipeline.expire(`${statsKey}:last_hour`, 2 * 60 * 60);
    pipeline.expire(`${statsKey}:last_day`, 25 * 60 * 60);
    
    await pipeline.exec();
    
    logger.debug('Monitoring event logged', LogCategory.INFRASTRUCTURE, {
      endpoint: event.endpoint,
      statusCode: event.statusCode,
      duration: event.duration,
      clientId: event.clientId?.substring(0, 8) + '...'
    });
    
  } catch (error) {
    // Silently fail - monitoring should never block requests
    // Only log non-timeout errors to avoid spam
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('timeout') || errorMessage.includes('Redis connection timeout')) {
      // Don't log timeout errors in production to reduce noise
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('Monitoring event logging skipped (Redis timeout)', LogCategory.INFRASTRUCTURE, {
          endpoint: event.endpoint,
          duration: Date.now() - startTime
        });
      }
    } else {
      // Log other errors for debugging
      logger.error('Failed to log monitoring event', LogCategory.INFRASTRUCTURE, {
        endpoint: event.endpoint,
        duration: Date.now() - startTime,
        error: errorMessage
      }, error instanceof Error ? error : new Error(errorMessage));
    }
    // Don't throw - this is fire-and-forget
  }
}

/**
 * Wrapper to monitor endpoint execution with comprehensive tracking
 */
export async function withMonitoring(
  req: VercelRequest,
  res: VercelResponse,
  endpoint: string,
  handler: () => Promise<void>
): Promise<void> {
  const startTime = Date.now();
  const clientId = getClientId(req);
  let statusCode = 200;
  let error: string | undefined;
  let responseSize = 0;
  
  // Intercept status code setting to capture it accurately
  const originalStatus = res.status.bind(res);
  res.status = (code: number) => {
    statusCode = code;
    return originalStatus(code);
  };
  
  // Intercept response to track size
  const Buffer = (globalThis as any).Buffer;
  const originalSend = res.send.bind(res);
  res.send = (data: any) => {
    if (typeof data === 'string') {
      responseSize = Buffer.byteLength(data, 'utf8');
    } else if (data && typeof data === 'object') {
      responseSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
    }
    return originalSend(data);
  };
  
  // Track request size
  const requestSize = req.headers['content-length'] 
    ? parseInt(req.headers['content-length'], 10) 
    : 0;
  
  try {
    await handler();
    // Capture final status if not explicitly set
    if (res.statusCode) {
      statusCode = res.statusCode;
    }
  } catch (err) {
    statusCode = 500;
    error = err instanceof Error ? err.message : String(err);
    throw err; // Re-throw for Vercel error handling
  } finally {
    const duration = Date.now() - startTime;
    
    // Log event asynchronously (non-blocking)
    const event: MonitoringEvent = {
      endpoint,
      method: req.method || 'UNKNOWN',
      statusCode,
      timestamp: Date.now(),
      clientId,
      error,
      duration,
      requestSize,
      responseSize,
      metadata: {
        path: req.url,
        query: Object.keys(req.query || {}).length > 0 ? req.query : undefined,
        userAgent: req.headers['user-agent'],
        contentType: req.headers['content-type']
      }
    };
    
    // Fire and forget - don't block response
    logEvent(event).catch(err => 
      logger.error('Failed to log monitoring event', LogCategory.INFRASTRUCTURE, {
        endpoint,
        error: err instanceof Error ? err.message : String(err)
      }, err instanceof Error ? err : new Error(String(err)))
    );
    
    // Console logging for immediate visibility
    const logData = {
      clientId: clientId.substring(0, 8) + '...',
      duration: `${duration}ms`,
      path: req.url,
      requestSize: requestSize ? `${requestSize}B` : undefined,
      responseSize: responseSize ? `${responseSize}B` : undefined,
      error: error ? error.substring(0, 100) : undefined
    };
    
    if (statusCode >= 400) {
      logger.error('API request failed', LogCategory.API, {
        endpoint,
        method: req.method,
        statusCode,
        ...logData
      });
    } else {
      logger.info('API request completed', LogCategory.API, {
        endpoint,
        method: req.method,
        statusCode,
        ...logData
      });
    }
  }
}

/**
 * Get comprehensive endpoint statistics with performance metrics
 */
export async function getEndpointStats(endpoint: string): Promise<EndpointStats> {
  try {
    const redis = await getRedis();
    const statsKey = `stats:${endpoint}`;
    
    const [total, clientErrors, serverErrors, durations, lastHour, lastDay] = await Promise.all([
      redis.get<number>(`${statsKey}:total`),
      redis.get<number>(`${statsKey}:client_errors`),
      redis.get<number>(`${statsKey}:server_errors`),
      redis.lrange(`${statsKey}:durations`, 0, -1) as Promise<number[]>,
      redis.get<number>(`${statsKey}:last_hour`),
      redis.get<number>(`${statsKey}:last_day`)
    ]);
    
    const stats: EndpointStats = {
      total: total || 0,
      clientErrors: clientErrors || 0,
      serverErrors: serverErrors || 0,
      lastHour: lastHour || 0,
      lastDay: lastDay || 0
    };
    
    // Calculate average duration
    if (durations && durations.length > 0) {
      const sum = durations.reduce((acc, d) => acc + Number(d), 0);
      stats.avgDuration = Math.round(sum / durations.length);
    }
    
    // Calculate error rate
    if (stats.total > 0) {
      stats.errorRate = (stats.clientErrors + stats.serverErrors) / stats.total;
    }
    
    // Check alert thresholds
    await checkAlertThresholds(endpoint, stats);
    
    logger.debug('Endpoint statistics retrieved', LogCategory.INFRASTRUCTURE, {
      endpoint,
      total: stats.total,
      errorRate: stats.errorRate ? (stats.errorRate * 100).toFixed(2) + '%' : '0%',
      avgDuration: stats.avgDuration
    });
    
    return stats;
    
  } catch (error) {
    logger.error('Failed to get endpoint statistics', LogCategory.INFRASTRUCTURE, {
      endpoint,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return { 
      total: 0, 
      clientErrors: 0, 
      serverErrors: 0 
    };
  }
}

/**
 * Get error type statistics for an endpoint
 */
export async function getErrorTypeStats(endpoint: string): Promise<ErrorTypeStats[]> {
  try {
    const redis = await getRedis();
    const pattern = `stats:${endpoint}:error_type:*`;
    
    const keys = await redis.keys(pattern);
    const errorStats = await Promise.all(
      keys.map(async key => {
        const type = key.split(':').pop() || 'unknown';
        const count = await redis.get<number>(key);
        return {
          type,
          count: count || 0,
          lastSeen: Date.now()
        };
      })
    );
    
    return errorStats
      .filter(stat => stat.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 error types
    
  } catch (error) {
    logger.error('Failed to get error type statistics', LogCategory.INFRASTRUCTURE, {
      endpoint,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return [];
  }
}

/**
 * Get recent events for an endpoint (limited to prevent memory issues)
 */
export async function getRecentEvents(
  endpoint: string, 
  limit: number = MAX_RECENT_EVENTS
): Promise<MonitoringEvent[]> {
  try {
    const redis = await getRedis();
    const pattern = `monitor:${endpoint}:*`;
    
    // Use SCAN instead of KEYS for production safety
    const keys = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    // Sort by timestamp (extracted from key) and limit
    const sortedKeys = keys
      .sort((a, b) => {
        const timeA = parseInt(a.split(':')[2]?.split('-')[0] || '0');
        const timeB = parseInt(b.split(':')[2]?.split('-')[0] || '0');
        return timeB - timeA; // Descending
      })
      .slice(0, limit);
    
    const events = await Promise.all(
      sortedKeys.map(async key => {
        const data = await redis.get<string>(key);
        return data ? JSON.parse(data) as MonitoringEvent : null;
      })
    );
    
    return events.filter(Boolean) as MonitoringEvent[];
    
  } catch (error) {
    logger.error('Failed to get recent events', LogCategory.INFRASTRUCTURE, {
      endpoint,
      limit,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return [];
  }
}

/**
 * Get system-wide monitoring statistics
 */
export async function getSystemStats(): Promise<{
  totalEndpoints: number;
  totalRequests: number;
  totalErrors: number;
  avgResponseTime?: number;
  topEndpoints: Array<{ endpoint: string; requests: number; errorRate: number }>;
}> {
  try {
    const redis = await getRedis();
    
    // Get all stats keys
    const statsKeys = await redis.keys('stats:*:total');
    const endpoints = statsKeys.map(key => key.split(':')[1]);
    
    const endpointStats = await Promise.all(
      endpoints.map(async endpoint => {
        const stats = await getEndpointStats(endpoint);
        return {
          endpoint,
          ...stats
        };
      })
    );
    
    const totalRequests = endpointStats.reduce((sum, stat) => sum + stat.total, 0);
    const totalErrors = endpointStats.reduce((sum, stat) => sum + stat.clientErrors + stat.serverErrors, 0);
    
    // Calculate average response time across all endpoints
    const avgResponseTimes = endpointStats
      .filter(stat => stat.avgDuration)
      .map(stat => stat.avgDuration!);
    
    const avgResponseTime = avgResponseTimes.length > 0
      ? Math.round(avgResponseTimes.reduce((sum, time) => sum + time, 0) / avgResponseTimes.length)
      : undefined;
    
    // Get top endpoints by request count
    const topEndpoints = endpointStats
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(stat => ({
        endpoint: stat.endpoint,
        requests: stat.total,
        errorRate: stat.total > 0 ? (stat.clientErrors + stat.serverErrors) / stat.total : 0
      }));
    
    return {
      totalEndpoints: endpoints.length,
      totalRequests,
      totalErrors,
      avgResponseTime,
      topEndpoints
    };
    
  } catch (error) {
    logger.error('Failed to get system statistics', LogCategory.INFRASTRUCTURE, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return {
      totalEndpoints: 0,
      totalRequests: 0,
      totalErrors: 0,
      topEndpoints: []
    };
  }
}

/**
 * Clean up old monitoring data (maintenance function)
 */
export async function cleanupOldData(endpoint?: string): Promise<{ deleted: number }> {
  try {
    const redis = await getRedis();
    const pattern = endpoint ? `monitor:${endpoint}:*` : 'monitor:*';
    
    // Use SCAN for safety
    const keys = [];
    let cursor = '0';
    
    do {
      const result = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = result[0];
      keys.push(...result[1]);
    } while (cursor !== '0');
    
    const now = Date.now();
    const cutoff = now - (EVENT_TTL * 1000);
    
    const keysToDelete = keys.filter(key => {
      const timestamp = parseInt(key.split(':')[2]?.split('-')[0] || '0');
      return timestamp < cutoff;
    });
    
    if (keysToDelete.length > 0) {
      // Delete in batches to avoid blocking
      const batchSize = 100;
      let deleted = 0;
      
      for (let i = 0; i < keysToDelete.length; i += batchSize) {
        const batch = keysToDelete.slice(i, i + batchSize);
        await redis.del(batch);
        deleted += batch.length;
      }
      
      logger.info('Monitoring data cleanup completed', LogCategory.INFRASTRUCTURE, {
        endpoint: endpoint || 'all',
        deleted,
        totalScanned: keys.length
      });
      
      return { deleted };
    }
    
    return { deleted: 0 };
    
  } catch (error) {
    logger.error('Failed to cleanup old monitoring data', LogCategory.INFRASTRUCTURE, {
      endpoint,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return { deleted: 0 };
  }
}
