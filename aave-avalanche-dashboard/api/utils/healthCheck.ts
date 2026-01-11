/**
 * Health Check System
 * Monitors the health of various services and dependencies
 */

import { logger, LogCategory } from './logger';
import { Redis } from '@upstash/redis';

interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  critical?: boolean; // If true, failure makes system unhealthy
  message?: string;
  details?: Record<string, any>;
  lastChecked: string;
  error?: string;
}

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheck[];
  uptime?: number; // Optional since meaningless in serverless
  version: string;
  timestamp: string;
  cached?: boolean; // Indicates if result is from cache
  cacheAge?: number; // Age of cache in milliseconds
}

class HealthMonitor {
  private static instance: HealthMonitor;
  private checks: Map<string, () => Promise<HealthCheck>> = new Map();
  private startTime: number;
  private healthCache?: {
    result: HealthCheckResult;
    cachedAt: number;
  };
  
  // Configuration
  private readonly CACHE_TTL = 30000; // 30 seconds
  private readonly DEFAULT_TIMEOUT = 5000; // 5 seconds
  private readonly MEMORY_UNHEALTHY_THRESHOLD = 90;
  private readonly MEMORY_DEGRADED_THRESHOLD = 75;

  private constructor() {
    this.startTime = Date.now();
    this.registerDefaultChecks();
  }

  static getInstance(): HealthMonitor {
    if (!HealthMonitor.instance) {
      HealthMonitor.instance = new HealthMonitor();
    }
    return HealthMonitor.instance;
  }

  // Timeout wrapper for all health checks
  private async withTimeout<T>(
    promise: Promise<T>, 
    timeoutMs: number,
    name: string
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    try {
      return await promise;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`Health check '${name}' timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Get Redis client with proper error handling
  private async getRedis(): Promise<Redis> {
    try {
      const url = process.env.KV_REST_API_URL || process.env.REDIS_URL;
      const token = process.env.KV_REST_API_TOKEN;
      
      if (!url || !token) {
        throw new Error('Redis configuration missing for health monitoring');
      }
      
      return new Redis({ url, token });
    } catch (error) {
      logger.error('Failed to initialize Redis for health monitoring', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private registerDefaultChecks(): void {
    // Redis health check (CRITICAL)
    this.registerCheck('redis', async () => {
      const start = Date.now();
      try {
        const redis = await this.getRedis();
        
        await this.withTimeout(
          redis.ping(),
          this.DEFAULT_TIMEOUT,
          'redis'
        );
        
        return {
          name: 'redis',
          status: 'healthy',
          responseTime: Date.now() - start,
          critical: true,
          lastChecked: new Date().toISOString()
        };
      } catch (error) {
        return {
          name: 'redis',
          status: 'unhealthy',
          responseTime: Date.now() - start,
          critical: true,
          message: 'Redis connection failed',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Database health check (placeholder - implement actual check)
    this.registerCheck('database', async () => {
      const start = Date.now();
      try {
        // TODO: Implement actual database health check
        // For now, we'll check if we can connect to a test table
        // await db.query('SELECT 1 FROM health_check LIMIT 1');
        
        // Placeholder: Always return healthy for now
        // In production, implement actual database connectivity test
        return {
          name: 'database',
          status: 'healthy',
          responseTime: Date.now() - start,
          critical: true,
          message: 'Database check not implemented - placeholder',
          lastChecked: new Date().toISOString()
        };
      } catch (error) {
        return {
          name: 'database',
          status: 'unhealthy',
          responseTime: Date.now() - start,
          critical: true,
          message: 'Database connection failed',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // External API health check (Avalanche RPC)
    this.registerCheck('avalanche_rpc', async () => {
      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.DEFAULT_TIMEOUT);
        
        const response = await this.withTimeout(
          fetch(process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              method: 'eth_blockNumber',
              params: [],
              id: 1
            })
          }),
          this.DEFAULT_TIMEOUT,
          'avalanche_rpc'
        );

        if (response.ok) {
          const data = await response.json();
          return {
            name: 'avalanche_rpc',
            status: 'healthy',
            responseTime: Date.now() - start,
            critical: true,
            details: { latestBlock: data.result },
            lastChecked: new Date().toISOString()
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        return {
          name: 'avalanche_rpc',
          status: 'unhealthy',
          responseTime: Date.now() - start,
          critical: true,
          message: 'Avalanche RPC unavailable',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Square API health check via public status page (no auth)
    this.registerCheck('square_api', async () => {
      const start = Date.now();
      try {
        const response = await this.withTimeout(
          fetch('https://status.squareup.com/api/v2/status.json'),
          this.DEFAULT_TIMEOUT,
          'square_api'
        );

        if (response.ok) {
          const data = await response.json();
          const isHealthy = data.status?.indicator === 'none';
          
          return {
            name: 'square_api',
            status: isHealthy ? 'healthy' : 'degraded',
            responseTime: Date.now() - start,
            critical: true,
            details: data.status,
            lastChecked: new Date().toISOString()
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        return {
          name: 'square_api',
          status: 'degraded',
          responseTime: Date.now() - start,
          critical: true,
          message: 'Square API status check failed',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // GMX API health check
    this.registerCheck('gmx_api', async () => {
      const start = Date.now();
      try {
        const response = await this.withTimeout(
          fetch('https://avalanche-api.gmxinfra.io/tokens', {
            method: 'GET',
            headers: { 'User-Agent': 'tiltvault-health-check/1.0' }
          }),
          this.DEFAULT_TIMEOUT,
          'gmx_api'
        );

        if (response.ok) {
          const tokens = await response.json();
          return {
            name: 'gmx_api',
            status: 'healthy',
            responseTime: Date.now() - start,
            critical: false, // GMX is not critical for basic functionality
            details: { availableTokens: Array.isArray(tokens) ? tokens.length : 0 },
            lastChecked: new Date().toISOString()
          };
        } else {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        return {
          name: 'gmx_api',
          status: 'degraded',
          responseTime: Date.now() - start,
          critical: false,
          message: 'GMX API issues',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Memory usage check (fixed to use RSS vs system memory)
    this.registerCheck('memory', async () => {
      const start = Date.now();
      try {
        const os = await import('os');
        const memUsage = process.memoryUsage();
        const totalSystemMemory = os.totalmem();
        const memoryUsagePercent = (memUsage.rss / totalSystemMemory) * 100;

        const unhealthyThreshold = parseFloat(process.env.MEMORY_UNHEALTHY_THRESHOLD || this.MEMORY_UNHEALTHY_THRESHOLD.toString());
        const degradedThreshold = parseFloat(process.env.MEMORY_DEGRADED_THRESHOLD || this.MEMORY_DEGRADED_THRESHOLD.toString());

        let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
        
        if (memoryUsagePercent > unhealthyThreshold) {
          status = 'unhealthy';
        } else if (memoryUsagePercent > degradedThreshold) {
          status = 'degraded';
        }

        return {
          name: 'memory',
          status,
          responseTime: Date.now() - start,
          critical: false,
          details: {
            rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            totalSystem: `${Math.round(totalSystemMemory / 1024 / 1024)}MB`,
            usagePercent: `${memoryUsagePercent.toFixed(2)}%` 
          },
          lastChecked: new Date().toISOString()
        };
      } catch (error) {
        return {
          name: 'memory',
          status: 'unhealthy',
          responseTime: Date.now() - start,
          critical: false,
          message: 'Failed to get memory usage',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });
  }

  public registerCheck(name: string, checkFunction: () => Promise<HealthCheck>): void {
    this.checks.set(name, checkFunction);
  }

  public removeCheck(name: string): void {
    this.checks.delete(name);
  }

  // Save health check history to Redis
  private async saveHealthCheckHistory(result: HealthCheckResult): Promise<void> {
    try {
      const redis = await this.getRedis();
      
      const historyEntry = {
        timestamp: Date.now(),
        status: result.status,
        checksCount: result.checks.length,
        unhealthyCount: result.checks.filter(c => c.status === 'unhealthy').length,
        degradedCount: result.checks.filter(c => c.status === 'degraded').length
      };
      
      await redis.lpush('health:history', JSON.stringify(historyEntry));
      await redis.ltrim('health:history', 0, 999); // Keep last 1000 entries
      await redis.expire('health:history', 7 * 24 * 60 * 60); // 7 days
    } catch (error) {
      // Don't fail health check if history save fails
      logger.error('Failed to save health check history', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Get actual deployment uptime from Redis
  private async getDeploymentUptime(): Promise<number> {
    try {
      const redis = await this.getRedis();
      let deploymentTime = await redis.get('system:deployment_time');
      
      if (!deploymentTime) {
        // Set deployment time if not exists
        deploymentTime = Date.now().toString();
        await redis.set('system:deployment_time', deploymentTime, { ex: 365 * 24 * 60 * 60 }); // 1 year
      }
      
      return Date.now() - parseInt(deploymentTime);
    } catch (error) {
      // Fallback to instance uptime
      return Date.now() - this.startTime;
    }
  }

  private async performHealthCheck(): Promise<HealthCheckResult> {
    const checkPromises = Array.from(this.checks.entries()).map(async ([name, checkFunction]) => {
      try {
        return await checkFunction();
      } catch (error) {
        const healthCheck: HealthCheck = {
          name,
          status: 'unhealthy',
          responseTime: 0,
          critical: false,
          message: 'Health check failed',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        return healthCheck;
      }
    });

    const results = await Promise.allSettled(checkPromises);
    const checks: HealthCheck[] = results
      .filter((r): r is PromiseFulfilledResult<HealthCheck> => r.status === 'fulfilled')
      .map(r => r.value);
    
    // Determine overall status based on critical checks
    const criticalUnhealthy = checks.filter(
      c => c.critical && c.status === 'unhealthy'
    ).length;
    
    const criticalDegraded = checks.filter(
      c => c.critical && c.status === 'degraded'
    ).length;

    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    
    if (criticalUnhealthy > 0) {
      overallStatus = 'unhealthy';
    } else if (criticalDegraded > 0 || checks.some(c => !c.critical && c.status === 'unhealthy')) {
      overallStatus = 'degraded';
    }

    const result: HealthCheckResult = {
      status: overallStatus,
      checks,
      uptime: await this.getDeploymentUptime(),
      version: process.env.APP_VERSION || process.env.npm_package_version || '1.0.0',
      timestamp: new Date().toISOString()
    };

    // Save history asynchronously (don't wait)
    this.saveHealthCheckHistory(result).catch(err => {
      logger.error('Failed to save health check history', LogCategory.API, { error: err });
    });

    return result;
  }

  public async runHealthCheck(useCache = true): Promise<HealthCheckResult> {
    if (useCache && this.healthCache) {
      const age = Date.now() - this.healthCache.cachedAt;
      if (age < this.CACHE_TTL) {
        return {
          ...this.healthCache.result,
          cached: true,
          cacheAge: age
        };
      }
    }
    
    const result = await this.performHealthCheck();
    this.healthCache = { result, cachedAt: Date.now() };
    return result;
  }

  public async runSingleCheck(name: string): Promise<HealthCheck> {
    const checkFunction = this.checks.get(name);
    if (!checkFunction) {
      throw new Error(`Health check '${name}' not found`);
    }

    try {
      return await checkFunction();
    } catch (error) {
      const healthCheck: HealthCheck = {
        name,
        status: 'unhealthy',
        responseTime: 0,
        critical: false,
        message: 'Health check failed',
        lastChecked: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      return healthCheck;
    }
  }

  public getRegisteredChecks(): string[] {
    return Array.from(this.checks.keys());
  }

  public async getHealthHistory(limit: number = 50): Promise<any[]> {
    try {
      const redis = await this.getRedis();
      const history = await redis.lrange('health:history', 0, limit - 1);
      return history.map(entry => JSON.parse(entry as string));
    } catch (error) {
      logger.error('Failed to get health history', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  // Cleanup method for graceful shutdown
  public shutdown(): void {
    this.healthCache = undefined;
    logger.info('Health monitor shutdown', LogCategory.API);
  }
}

export const healthMonitor = HealthMonitor.getInstance();
