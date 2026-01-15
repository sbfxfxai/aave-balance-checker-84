/**
 * Monitoring Dashboard API
 * Provides comprehensive monitoring data for dashboards
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { AlertingSystem } from '../utils/alerting';
const alertingSystem = AlertingSystem.getInstance();
import { healthMonitor } from '../utils/healthCheck';
import { verifyMessage } from 'ethers';

// Rate limiter for dashboard access
let _ratelimit: any = null;

async function getRatelimit() {
  if (!_ratelimit) {
    const redis = await getRedis();
    _ratelimit = new Ratelimit({
      redis: redis as any,
      limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute per IP
      analytics: true,
    });
  }
  return _ratelimit;
}

// Hash PII for privacy protection
function hashPII(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 10) return `${value.substring(0, 2)}***`;
  return `${value.substring(0, 6)}...${value.substring(value.length - 4)}`;
}

// Sanitize error messages to prevent information leakage
function sanitizeErrorMessage(message: string): string {
  if (!message) return '';
  
  // Remove file paths
  message = message.replace(/\/[^\s]+\//g, '/[path]/');
  message = message.replace(/\\[^\s]+\\/g, '\\[path]\\');
  
  // Remove potential API keys (long alphanumeric strings)
  message = message.replace(/[a-zA-Z0-9]{32,}/g, '[redacted]');
  
  // Remove email addresses
  message = message.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]');
  
  // Remove IP addresses
  message = message.replace(/\b\d{1,3}\(\.\d{1,3}\){3}\d{1,3}\b/g, '[ip]');
  
  // Remove wallet addresses
  message = message.replace(/0x[a-fA-F0-9]{40}/g, '[wallet]');
  
  return message;
}

// Verify admin authentication
async function verifyAdminAuth(req: VercelRequest): Promise<{ valid: boolean; adminId?: string }> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false };
  }
  
  const token = authHeader.substring(7);
  
  // For development, accept a simple token
  if (process.env.NODE_ENV !== 'production' && token === 'dev-admin-token') {
    return { valid: true, adminId: 'dev-admin' };
  }
  
  // In production, verify with wallet signature
  try {
    const expectedMessage = `Access monitoring dashboard at ${new Date().toISOString().split('T')[0]}`;
    const recoveredAddress = verifyMessage(expectedMessage, token);
    
    // Check if this address is an admin (stored in Redis)
    const redis = await getRedis();
    const isAdmin = await redis.get(`admin_wallet:${recoveredAddress.toLowerCase()}`);
    
    if (isAdmin) {
      return { valid: true, adminId: recoveredAddress };
    }
    
    return { valid: false };
  } catch (error) {
    return { valid: false };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  
  // CORS headers
  const allowedOrigin = process.env.DASHBOARD_ORIGIN || 'http://localhost:3000';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Rate limiting
    const ratelimit = await getRatelimit();
    const identifier = (req.headers['x-forwarded-for'] as string) || 
                       (req.headers['x-real-ip'] as string) || 
                       'anonymous';
    
    const { success, remaining } = await ratelimit.limit(identifier);
    
    res.setHeader('X-RateLimit-Remaining', remaining.toString());
    
    if (!success) {
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Dashboard refresh rate limit exceeded'
      });
    }

    // Authentication and authorization
    const auth = await verifyAdminAuth(req);
    if (!auth.valid) {
      logger.warn('Unauthorized dashboard access attempt', LogCategory.AUTH, {
        ip: identifier,
        userAgent: req.headers['user-agent']
      });
      
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please provide a valid admin token'
      });
    }

    logger.info('Dashboard accessed by admin', LogCategory.AUTH, {
      adminId: hashPII(auth.adminId),
      ip: identifier
    });

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Get all monitoring data
    const [errorStats, alertStats, healthResult, logStats] = await Promise.all([
      Promise.resolve(errorTracker.getErrorStats()),
      alertingSystem.getAlertStats(),
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

      // Error Tracking (PII sanitized)
      errors: {
        total: errorStats.totalErrors,
        byCategory: errorStats.errorsByCategory,
        bySeverity: errorStats.errorsBySeverity,
        recent: errorStats.recentErrors.map(error => ({
          timestamp: error.context.timestamp,
          category: error.category,
          severity: error.severity,
          message: sanitizeErrorMessage(
            typeof error.error === 'string' ? error.error : error.error.message
          ),
          userId: hashPII(error.context.userId),
          walletAddress: hashPII(error.context.walletAddress),
          endpoint: error.context.endpoint
        }))
      },

      // Alerts
      alerts: {
        total: alertStats.totalAlerts,
        active: alertStats.activeAlerts,
        bySeverity: alertStats.alertsBySeverity,
        byType: alertStats.alertsByType,
        recent: (await alertingSystem.getAlertHistory(10)).map(alert => ({
          id: alert.id,
          type: alert.type,
          severity: alert.severity,
          title: alert.title,
          message: sanitizeErrorMessage(alert.message),
          timestamp: alert.timestamp,
          resolved: alert.resolved,
          resolvedAt: alert.resolvedAt
        }))
      },

      // Logs (PII sanitized)
      logs: {
        total: logStats.totalLogs,
        byLevel: logStats.logsByLevel,
        byCategory: logStats.logsByCategory,
        recent: logStats.recentLogs.map(log => ({
          timestamp: log.timestamp,
          level: log.level,
          category: log.category,
          message: sanitizeErrorMessage(log.message),
          userId: hashPII(log.userId),
          walletAddress: hashPII(log.walletAddress),
          duration: log.duration,
          hasError: !!log.error
        }))
      },

      // Performance Metrics (sanitized for production)
      performance: {
        responseTime: responseTime,
        memoryUsage: process.env.NODE_ENV === 'development' 
          ? process.memoryUsage()
          : {
              percentage: Math.round(
                (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100
              )
            },
        nodeVersion: process.env.NODE_ENV === 'development' ? process.version : 'Node.js',
        platform: process.env.NODE_ENV === 'development' ? process.platform : 'server',
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
      stack: process.env.NODE_ENV === 'development' 
        ? error instanceof Error ? error.stack : undefined
        : undefined,
      responseTime
    });

    res.status(500).json({
      error: 'Failed to fetch dashboard data',
      timestamp: new Date().toISOString(),
      responseTime: `${responseTime}ms`,
      message: process.env.NODE_ENV === 'development' 
        ? error instanceof Error ? error.message : 'Unknown error'
        : 'An error occurred while fetching dashboard data'
    });
  }
}
