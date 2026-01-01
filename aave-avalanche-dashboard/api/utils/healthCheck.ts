/**
 * Health check utilities for monitoring system components
 */

export interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  message?: string;
  lastChecked: Date;
  metadata?: Record<string, any>;
}

export interface HealthCheckResult {
  overall: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheck[];
  timestamp: Date;
  uptime: number;
}

export interface HealthCheckConfig {
  timeout: number;
  retries: number;
  interval: number;
  thresholds: {
    responseTime: number;
    errorRate: number;
  };
}

class HealthChecker {
  private config: HealthCheckConfig;
  private checks: Map<string, () => Promise<HealthCheck>> = new Map();

  constructor(config: HealthCheckConfig) {
    this.config = config;
  }

  /**
   * Register a health check
   */
  registerCheck(name: string, checkFn: () => Promise<HealthCheck>): void {
    this.checks.set(name, checkFn);
  }

  /**
   * Run all health checks
   */
  async runAllChecks(): Promise<HealthCheckResult> {
    const checkPromises = Array.from(this.checks.entries()).map(async ([name, checkFn]) => {
      try {
        const startTime = Date.now();
        const result = await Promise.race([
          checkFn(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), this.config.timeout)
          )
        ]);
        const responseTime = Date.now() - startTime;
        
        return {
          ...result,
          name,
          responseTime,
          lastChecked: new Date()
        };
      } catch (error) {
        return {
          name,
          status: 'unhealthy' as const,
          responseTime: this.config.timeout,
          message: error instanceof Error ? error.message : 'Unknown error',
          lastChecked: new Date()
        };
      }
    });

    const results = await Promise.all(checkPromises);
    
    const overallStatus = this.calculateOverallStatus(results);
    
    return {
      overall: overallStatus,
      checks: results,
      timestamp: new Date(),
      uptime: process.uptime()
    };
  }

  /**
   * Run a specific health check
   */
  async runCheck(name: string): Promise<HealthCheck | null> {
    const checkFn = this.checks.get(name);
    if (!checkFn) return null;

    try {
      const startTime = Date.now();
      const result = await Promise.race([
        checkFn(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), this.config.timeout)
        )
      ]);
      const responseTime = Date.now() - startTime;
      
      return {
        ...result,
        name,
        responseTime,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy' as const,
        responseTime: this.config.timeout,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date()
      };
    }
  }

  /**
   * Get list of registered checks
   */
  getRegisteredChecks(): string[] {
    return Array.from(this.checks.keys());
  }

  private calculateOverallStatus(checks: HealthCheck[]): 'healthy' | 'unhealthy' | 'degraded' {
    const unhealthyCount = checks.filter(check => check.status === 'unhealthy').length;
    const degradedCount = checks.filter(check => check.status === 'degraded').length;
    
    if (unhealthyCount > 0) return 'unhealthy';
    if (degradedCount > 0) return 'degraded';
    return 'healthy';
  }
}

// Default health checker instance
export const healthChecker = new HealthChecker({
  timeout: 5000,
  retries: 3,
  interval: 30000,
  thresholds: {
    responseTime: 2000,
    errorRate: 0.05
  }
});

// Common health check utilities
export const healthChecks = {
  /**
   * Database health check
   */
  database: async (): Promise<HealthCheck> => {
    try {
      // Mock database ping - replace with actual database check
      const startTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, 50));
      const responseTime = Date.now() - startTime;
      
      return {
        name: 'database',
        status: 'healthy',
        responseTime,
        message: 'Database connection successful',
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        name: 'database',
        status: 'unhealthy',
        responseTime: 0,
        message: error instanceof Error ? error.message : 'Database connection failed',
        lastChecked: new Date()
      };
    }
  },

  /**
   * Redis health check
   */
  redis: async (): Promise<HealthCheck> => {
    try {
      // Mock Redis ping - replace with actual Redis check
      const startTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, 30));
      const responseTime = Date.now() - startTime;
      
      return {
        name: 'redis',
        status: 'healthy',
        responseTime,
        message: 'Redis connection successful',
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        name: 'redis',
        status: 'unhealthy',
        responseTime: 0,
        message: error instanceof Error ? error.message : 'Redis connection failed',
        lastChecked: new Date()
      };
    }
  },

  /**
   * External API health check
   */
  externalApi: async (url: string): Promise<HealthCheck> => {
    try {
      const startTime = Date.now();
      const response = await fetch(url, { method: 'HEAD' });
      const responseTime = Date.now() - startTime;
      
      return {
        name: 'external_api',
        status: response.ok ? 'healthy' : 'unhealthy',
        responseTime,
        message: `API responded with ${response.status}`,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        name: 'external_api',
        status: 'unhealthy',
        responseTime: 0,
        message: error instanceof Error ? error.message : 'API check failed',
        lastChecked: new Date()
      };
    }
  },

  /**
   * Memory usage health check
   */
  memory: async (): Promise<HealthCheck> => {
    const usage = process.memoryUsage();
    const heapUsedMB = usage.heapUsed / 1024 / 1024;
    const heapTotalMB = usage.heapTotal / 1024 / 1024;
    const usagePercent = (heapUsedMB / heapTotalMB) * 100;
    
    return {
      name: 'memory',
      status: usagePercent > 90 ? 'unhealthy' : usagePercent > 75 ? 'degraded' : 'healthy',
      responseTime: 0,
      message: `Memory usage: ${heapUsedMB.toFixed(2)}MB (${usagePercent.toFixed(1)}%)`,
      lastChecked: new Date(),
      metadata: {
        heapUsed: heapUsedMB,
        heapTotal: heapTotalMB,
        usagePercent
      }
    };
  }
};

// Register default health checks
healthChecker.registerCheck('database', healthChecks.database);
healthChecker.registerCheck('redis', healthChecks.redis);
healthChecker.registerCheck('memory', healthChecks.memory);
