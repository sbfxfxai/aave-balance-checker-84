import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';

// Initialize Redis
function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

export interface MonitoringEvent {
  endpoint: string;
  method: string;
  statusCode: number;
  timestamp: number;
  clientId?: string;
  error?: string;
  duration?: number;
  metadata?: Record<string, any>;
}

/**
 * Log monitoring event to Redis
 */
export async function logEvent(event: MonitoringEvent): Promise<void> {
  try {
    const redis = getRedis();
    const eventKey = `monitor:${event.endpoint}:${Date.now()}`;
    
    // Store event with 7 day TTL
    await redis.set(eventKey, JSON.stringify(event), {
      ex: 7 * 24 * 60 * 60, // 7 days
    });
    
    // Update endpoint statistics
    const statsKey = `stats:${event.endpoint}`;
    await redis.incr(`${statsKey}:total`);
    
    if (event.statusCode >= 400) {
      await redis.incr(`${statsKey}:errors`);
    }
    
    if (event.statusCode >= 500) {
      await redis.incr(`${statsKey}:server_errors`);
    }
    
    // Set expiry on stats keys (30 days)
    await redis.expire(`${statsKey}:total`, 30 * 24 * 60 * 60);
    await redis.expire(`${statsKey}:errors`, 30 * 24 * 60 * 60);
    await redis.expire(`${statsKey}:server_errors`, 30 * 24 * 60 * 60);
    
  } catch (error) {
    // Don't fail the request if monitoring fails
    console.error('[Monitoring] Failed to log event:', error);
  }
}

/**
 * Get client identifier from request
 */
function getClientId(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim())
    : req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  
  return ip as string;
}

/**
 * Wrapper to monitor endpoint execution
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
  
  try {
    await handler();
    // Capture status code after handler completes
    statusCode = res.statusCode || 200;
  } catch (err) {
    statusCode = 500;
    error = err instanceof Error ? err.message : String(err);
    // Re-throw to let Vercel handle the error response
    throw err;
  } finally {
    const duration = Date.now() - startTime;
    
    // Log event asynchronously (don't block response)
    logEvent({
      endpoint,
      method: req.method || 'UNKNOWN',
      statusCode,
      timestamp: Date.now(),
      clientId,
      error,
      duration,
    }).catch(console.error);
    
    // Log to console for immediate visibility
    if (statusCode >= 400) {
      console.error(`[${endpoint}] ${req.method} ${statusCode} - ${duration}ms`, {
        clientId,
        error,
        path: req.url,
      });
    } else {
      console.log(`[${endpoint}] ${req.method} ${statusCode} - ${duration}ms`, {
        clientId,
        path: req.url,
      });
    }
  }
}

/**
 * Get endpoint statistics
 */
export async function getEndpointStats(endpoint: string): Promise<{
  total: number;
  errors: number;
  serverErrors: number;
}> {
  try {
    const redis = getRedis();
    const statsKey = `stats:${endpoint}`;
    
    const [total, errors, serverErrors] = await Promise.all([
      redis.get(`${statsKey}:total`),
      redis.get(`${statsKey}:errors`),
      redis.get(`${statsKey}:server_errors`),
    ]);
    
    return {
      total: total ? parseInt(total as string, 10) : 0,
      errors: errors ? parseInt(errors as string, 10) : 0,
      serverErrors: serverErrors ? parseInt(serverErrors as string, 10) : 0,
    };
  } catch (error) {
    console.error('[Monitoring] Failed to get stats:', error);
    return { total: 0, errors: 0, serverErrors: 0 };
  }
}

