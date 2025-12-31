/**
 * Health Check API Endpoint
 * Provides health status for monitoring systems
 */

import { healthMonitor } from '../utils/healthCheck';
import { logger, LogCategory } from '../utils/logger';

export default async function handler(req: any, res: any) {
  const startTime = Date.now();
  
  try {
    logger.info('Health check requested', LogCategory.API, {
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent']
    });

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const healthResult = await healthMonitor.runHealthCheck();
    const responseTime = Date.now() - startTime;

    // Set appropriate status code based on health
    let statusCode = 200;
    if (healthResult.status === 'unhealthy') {
      statusCode = 503;
    } else if (healthResult.status === 'degraded') {
      statusCode = 200; // Still serve traffic but indicate issues
    }

    logger.logApiCall(req.method || 'GET', req.url || '/health', statusCode, responseTime, {
      healthStatus: healthResult.status,
      checkCount: healthResult.checks.length
    });

    res.status(statusCode).json({
      status: healthResult.status,
      timestamp: healthResult.timestamp,
      uptime: healthResult.uptime,
      version: healthResult.version,
      checks: healthResult.checks,
      responseTime: `${responseTime}ms`
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    logger.error('Health check failed', LogCategory.API, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      responseTime
    });

    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      responseTime: `${responseTime}ms`
    });
  }
}
