/**
 * Health Check System
 * Monitors the health of various services and dependencies
 */

interface HealthCheck {
  name: string;
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime: number;
  message?: string;
  details?: Record<string, any>;
  lastChecked: string;
  error?: string;
}

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: HealthCheck[];
  uptime: number;
  version: string;
  timestamp: string;
}

class HealthMonitor {
  private static instance: HealthMonitor;
  private checks: Map<string, () => Promise<HealthCheck>> = new Map();
  private startTime: number;

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

  private registerDefaultChecks(): void {
    // Database health check
    this.registerCheck('database', async () => {
      const start = Date.now();
      try {
        // Example: Check database connectivity
        // await db.query('SELECT 1');
        return {
          name: 'database',
          status: 'healthy',
          responseTime: Date.now() - start,
          lastChecked: new Date().toISOString()
        };
      } catch (error) {
        return {
          name: 'database',
          status: 'unhealthy',
          responseTime: Date.now() - start,
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
        const response = await fetch(process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_blockNumber',
            params: [],
            id: 1
          })
        });

        if (response.ok) {
          const data = await response.json();
          return {
            name: 'avalanche_rpc',
            status: 'healthy',
            responseTime: Date.now() - start,
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
          message: 'Avalanche RPC unavailable',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Square API health check
    this.registerCheck('square_api', async () => {
      const start = Date.now();
      try {
        const response = await fetch('https://connect.squareup.com/v2/locations', {
          headers: {
            'Authorization': `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          return {
            name: 'square_api',
            status: 'healthy',
            responseTime: Date.now() - start,
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
          message: 'Square API issues',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // GMX API health check
    this.registerCheck('gmx_api', async () => {
      const start = Date.now();
      try {
        const response = await fetch('https://avalanche-api.gmxinfra.io/tokens', {
          method: 'GET',
          headers: { 'User-Agent': 'tiltvault-health-check/1.0' }
        });

        if (response.ok) {
          const tokens = await response.json();
          return {
            name: 'gmx_api',
            status: 'healthy',
            responseTime: Date.now() - start,
            details: { availableTokens: tokens.length },
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
          message: 'GMX API issues',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    });

    // Memory usage check
    this.registerCheck('memory', async () => {
      const start = Date.now();
      try {
        const memUsage = process.memoryUsage();
        const totalMemory = memUsage.heapTotal;
        const usedMemory = memUsage.heapUsed;
        const memoryUsagePercent = (usedMemory / totalMemory) * 100;

        let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
        if (memoryUsagePercent > 90) {
          status = 'unhealthy';
        } else if (memoryUsagePercent > 75) {
          status = 'degraded';
        }

        return {
          name: 'memory',
          status,
          responseTime: Date.now() - start,
          details: {
            usedMemory: `${Math.round(usedMemory / 1024 / 1024)}MB`,
            totalMemory: `${Math.round(totalMemory / 1024 / 1024)}MB`,
            usagePercent: `${memoryUsagePercent.toFixed(2)}%`
          },
          lastChecked: new Date().toISOString()
        };
      } catch (error) {
        return {
          name: 'memory',
          status: 'unhealthy',
          responseTime: Date.now() - start,
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

  public async runHealthCheck(): Promise<HealthCheckResult> {
    const checkPromises = Array.from(this.checks.entries()).map(async ([name, checkFunction]) => {
      try {
        return await checkFunction();
      } catch (error) {
        const healthCheck: HealthCheck = {
          name,
          status: 'unhealthy',
          responseTime: 0,
          message: 'Health check failed',
          lastChecked: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error'
        };
        return healthCheck;
      }
    });

    const results: HealthCheck[] = await Promise.all(checkPromises);
    
    // Determine overall status
    let overallStatus: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
    const unhealthyCount = results.filter(check => check.status === 'unhealthy').length;
    const degradedCount = results.filter(check => check.status === 'degraded').length;

    if (unhealthyCount > 0) {
      overallStatus = 'unhealthy';
    } else if (degradedCount > 0) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      checks: results,
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
      timestamp: new Date().toISOString()
    };
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
}

export const healthMonitor = HealthMonitor.getInstance();
