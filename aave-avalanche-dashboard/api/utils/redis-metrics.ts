/**
 * Redis Operation Metrics
 * Tracks operation counts, failures, and performance for observability
 */

import { getRedis } from './redis';
import { logger, LogCategory } from './logger';

interface RedisMetrics {
  operations: {
    total: number;
    successful: number;
    failed: number;
    byOperation: Record<string, { total: number; failed: number }>;
  };
  rateLimits: {
    totalChecks: number;
    blocked: number;
    byEndpoint: Record<string, { checks: number; blocked: number }>;
  };
  errors: {
    connection: number;
    timeout: number;
    other: number;
  };
  lastUpdated: number;
}

// In-memory metrics (reset on cold start - acceptable for serverless)
let metrics: RedisMetrics = {
  operations: {
    total: 0,
    successful: 0,
    failed: 0,
    byOperation: {}
  },
  rateLimits: {
    totalChecks: 0,
    blocked: 0,
    byEndpoint: {}
  },
  errors: {
    connection: 0,
    timeout: 0,
    other: 0
  },
  lastUpdated: Date.now()
};

// Persist metrics to Redis for cross-instance visibility
const METRICS_KEY = 'redis:metrics';
const METRICS_TTL = 24 * 60 * 60; // 24 hours

/**
 * Track Redis operation
 */
export function trackOperation(
  operation: string,
  success: boolean,
  errorType?: 'connection' | 'timeout' | 'other'
): void {
  metrics.operations.total++;
  
  if (success) {
    metrics.operations.successful++;
  } else {
    metrics.operations.failed++;
    if (errorType) {
      metrics.errors[errorType]++;
    } else {
      metrics.errors.other++;
    }
  }
  
  // Track by operation type
  if (!metrics.operations.byOperation[operation]) {
    metrics.operations.byOperation[operation] = { total: 0, failed: 0 };
  }
  metrics.operations.byOperation[operation].total++;
  if (!success) {
    metrics.operations.byOperation[operation].failed++;
  }
  
  metrics.lastUpdated = Date.now();
  
  // Persist to Redis asynchronously (fire and forget)
  persistMetrics().catch(err => {
    logger.debug('Failed to persist Redis metrics', LogCategory.INFRASTRUCTURE, {
      error: err instanceof Error ? err.message : String(err)
    });
  });
}

/**
 * Track rate limit check
 */
export function trackRateLimit(endpoint: string, blocked: boolean): void {
  metrics.rateLimits.totalChecks++;
  
  if (blocked) {
    metrics.rateLimits.blocked++;
  }
  
  if (!metrics.rateLimits.byEndpoint[endpoint]) {
    metrics.rateLimits.byEndpoint[endpoint] = { checks: 0, blocked: 0 };
  }
  metrics.rateLimits.byEndpoint[endpoint].checks++;
  if (blocked) {
    metrics.rateLimits.byEndpoint[endpoint].blocked++;
  }
  
  metrics.lastUpdated = Date.now();
  
  // Persist to Redis asynchronously
  persistMetrics().catch(err => {
    logger.debug('Failed to persist rate limit metrics', LogCategory.INFRASTRUCTURE);
  });
}

/**
 * Persist metrics to Redis
 */
async function persistMetrics(): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(METRICS_KEY, JSON.stringify(metrics), { ex: METRICS_TTL });
  } catch (error) {
    // Silently fail - metrics are best-effort
  }
}

/**
 * Get current metrics
 */
export async function getMetrics(): Promise<RedisMetrics> {
  try {
    const redis = await getRedis();
    const stored = await redis.get<string>(METRICS_KEY);
    
    if (stored) {
      const storedMetrics = JSON.parse(stored) as RedisMetrics;
      // Merge with in-memory metrics (in-memory takes precedence for current instance)
      return {
        ...storedMetrics,
        operations: {
          ...storedMetrics.operations,
          total: storedMetrics.operations.total + metrics.operations.total,
          successful: storedMetrics.operations.successful + metrics.operations.successful,
          failed: storedMetrics.operations.failed + metrics.operations.failed,
          byOperation: {
            ...storedMetrics.operations.byOperation,
            ...Object.entries(metrics.operations.byOperation).reduce((acc, [op, stats]) => {
              acc[op] = {
                total: (storedMetrics.operations.byOperation[op]?.total || 0) + stats.total,
                failed: (storedMetrics.operations.byOperation[op]?.failed || 0) + stats.failed
              };
              return acc;
            }, {} as Record<string, { total: number; failed: number }>)
          }
        },
        rateLimits: {
          ...storedMetrics.rateLimits,
          totalChecks: storedMetrics.rateLimits.totalChecks + metrics.rateLimits.totalChecks,
          blocked: storedMetrics.rateLimits.blocked + metrics.rateLimits.blocked,
          byEndpoint: {
            ...storedMetrics.rateLimits.byEndpoint,
            ...Object.entries(metrics.rateLimits.byEndpoint).reduce((acc, [endpoint, stats]) => {
              acc[endpoint] = {
                checks: (storedMetrics.rateLimits.byEndpoint[endpoint]?.checks || 0) + stats.checks,
                blocked: (storedMetrics.rateLimits.byEndpoint[endpoint]?.blocked || 0) + stats.blocked
              };
              return acc;
            }, {} as Record<string, { checks: number; blocked: number }>)
          }
        },
        lastUpdated: Math.max(storedMetrics.lastUpdated, metrics.lastUpdated)
      };
    }
  } catch (error) {
    logger.debug('Failed to load stored metrics', LogCategory.INFRASTRUCTURE);
  }
  
  return metrics;
}

/**
 * Reset metrics (useful for testing or manual reset)
 */
export function resetMetrics(): void {
  metrics = {
    operations: {
      total: 0,
      successful: 0,
      failed: 0,
      byOperation: {}
    },
    rateLimits: {
      totalChecks: 0,
      blocked: 0,
      byEndpoint: {}
    },
    errors: {
      connection: 0,
      timeout: 0,
      other: 0
    },
    lastUpdated: Date.now()
  };
}

/**
 * Get metrics summary for monitoring/alerting
 */
export async function getMetricsSummary(): Promise<{
  successRate: number;
  errorRate: number;
  rateLimitBlockRate: number;
  topFailedOperations: Array<{ operation: string; failureRate: number }>;
  topBlockedEndpoints: Array<{ endpoint: string; blockRate: number }>;
}> {
  const currentMetrics = await getMetrics();
  
  const successRate = currentMetrics.operations.total > 0
    ? (currentMetrics.operations.successful / currentMetrics.operations.total) * 100
    : 100;
  
  const errorRate = currentMetrics.operations.total > 0
    ? (currentMetrics.operations.failed / currentMetrics.operations.total) * 100
    : 0;
  
  const rateLimitBlockRate = currentMetrics.rateLimits.totalChecks > 0
    ? (currentMetrics.rateLimits.blocked / currentMetrics.rateLimits.totalChecks) * 100
    : 0;
  
  // Top failed operations
  const topFailedOperations = Object.entries(currentMetrics.operations.byOperation)
    .map(([operation, stats]) => ({
      operation,
      failureRate: stats.total > 0 ? (stats.failed / stats.total) * 100 : 0
    }))
    .sort((a, b) => b.failureRate - a.failureRate)
    .slice(0, 5);
  
  // Top blocked endpoints
  const topBlockedEndpoints = Object.entries(currentMetrics.rateLimits.byEndpoint)
    .map(([endpoint, stats]) => ({
      endpoint,
      blockRate: stats.checks > 0 ? (stats.blocked / stats.checks) * 100 : 0
    }))
    .sort((a, b) => b.blockRate - a.blockRate)
    .slice(0, 5);
  
  return {
    successRate,
    errorRate,
    rateLimitBlockRate,
    topFailedOperations,
    topBlockedEndpoints
  };
}
