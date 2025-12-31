/**
 * Monitoring Dashboard API
 * Provides comprehensive monitoring data for dashboards
 */

import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { alertingSystem } from '../utils/alerting';
import { healthMonitor } from '../utils/healthCheck';

export default async function handler(req: any, res: any) {
  const startTime = Date.now();
  
  try {
    logger.info('Dashboard data requested', LogCategory.API, {
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent']
    });

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Get all monitoring data
    const [errorStats, alertStats, healthResult, logStats] = await Promise.all([
      Promise.resolve(errorTracker.getErrorStats()),
      Promise.resolve(alertingSystem.getAlertStats()),
      healthMonitor.runHealthCheck(),
      Promise.resolve(logger.getLogStats())
    ]);

    const responseTime = Date.now() - startTime;

    const dashboardData = {
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      
      // System Overview
      overview: {
        status: healthResult.status,
        uptime: healthResult.uptime,
        version: healthResult.version,
        totalErrors: errorStats.totalErrors,
        totalAlerts: alertStats.totalAlerts,
        activeAlerts: alertStats.activeAlerts,
        totalLogs: logStats.totalLogs
      },

      // Health Checks
      health: {
        status: healthResult.status,
        checks: healthResult.checks,
        summary: {
          healthy: healthResult.checks.filter(c => c.status === 'healthy').length,
          degraded: healthResult.checks.filter(c => c.status === 'degraded').length,
          unhealthy: healthResult.checks.filter(c => c.status === 'unhealthy').length
        }
      },

      // Error Tracking
      errors: {
        total: errorStats.totalErrors,
        byCategory: errorStats.errorsByCategory,
        bySeverity: errorStats.errorsBySeverity,
        recent: errorStats.recentErrors.map(error => ({
          timestamp: error.context.timestamp,
          category: error.category,
          severity: error.severity,
          message: typeof error.error === 'string' ? error.error : error.error.message,
          userId: error.context.userId,
          walletAddress: error.context.walletAddress,
          endpoint: error.context.endpoint
        }))
      },

      // Alerts
      alerts: {
        total: alertStats.totalAlerts,
        active: alertStats.activeAlerts,
        bySeverity: alertStats.alertsBySeverity,
        byType: alertStats.alertsByType,
        recent: alertingSystem.getAlertHistory(10).map(alert => ({
          id: alert.id,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          timestamp: alert.timestamp,
          resolved: alert.resolved,
          resolvedAt: alert.resolvedAt
        }))
      },

      // Logs
      logs: {
        total: logStats.totalLogs,
        byLevel: logStats.logsByLevel,
        byCategory: logStats.logsByCategory,
        recent: logStats.recentLogs.map(log => ({
          timestamp: log.timestamp,
          level: log.level,
          category: log.category,
          message: log.message,
          userId: log.userId,
          walletAddress: log.walletAddress,
          duration: log.duration,
          hasError: !!log.error
        }))
      },

      // Performance Metrics
      performance: {
        responseTime: responseTime,
        memoryUsage: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform,
        environment: process.env.NODE_ENV || 'development'
      }
    };

    logger.logApiCall(req.method || 'GET', req.url || '/monitoring/dashboard', 200, responseTime, {
      healthStatus: healthResult.status,
      errorCount: errorStats.totalErrors,
      alertCount: alertStats.totalAlerts
    });

    res.status(200).json(dashboardData);

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    logger.error('Dashboard data request failed', LogCategory.API, {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      responseTime
    });

    res.status(500).json({
      error: 'Failed to fetch dashboard data',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`
    });
  }
}
