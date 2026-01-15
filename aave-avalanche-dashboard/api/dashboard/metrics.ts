/**
 * Dashboard Metrics API Endpoints
 * 
 * Provides comprehensive metrics for monitoring:
 * - Supply cap utilization
 * - Position statistics
 * - Error rates
 * - RPC health
 * - Transaction success rates
 */

import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { getAllPositions, getPositionsByStatus } from '../positions/store';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Get supply cap metrics
 */
async function getSupplyCapMetrics(): Promise<{
  currentSupply: string;
  supplyCap: string | null;
  utilizationPercent: number | null;
  projectedUtilization: number | null;
  recentFailures: number;
  recentWarnings: Array<{ timestamp: number; utilization: number }>;
}> {
  try {
    const redis = await getRedis();
    
    // Get recent utilization warnings
    const utilizationLogs = await redis.lrange('monitoring:supply_cap_utilization', 0, 49) || [];
    const warnings = utilizationLogs.map((log: string) => {
      try {
        const data = JSON.parse(log);
        return {
          timestamp: data.timestamp,
          utilization: parseFloat(data.utilizationPercent)
        };
      } catch {
        return null;
      }
    }).filter(Boolean) as Array<{ timestamp: number; utilization: number }>;

    // Get recent failures
    const failureLogs = await redis.lrange('monitoring:supply_cap_failures', 0, 99) || [];
    const recentFailures = failureLogs.length;

    // Get latest utilization (from most recent warning if available)
    const latestWarning = warnings.length > 0 ? warnings[0] : null;
    
    return {
      currentSupply: '0', // Would need to query Aave for current
      supplyCap: null,
      utilizationPercent: latestWarning?.utilization || null,
      projectedUtilization: null,
      recentFailures,
      recentWarnings: warnings.slice(0, 10) // Last 10 warnings
    };
  } catch (error) {
    logger.error('Failed to get supply cap metrics', LogCategory.API, {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return {
      currentSupply: '0',
      supplyCap: null,
      utilizationPercent: null,
      projectedUtilization: null,
      recentFailures: 0,
      recentWarnings: []
    };
  }
}

/**
 * Get position statistics
 */
async function getPositionStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byStrategy: Record<string, number>;
  recent24h: number;
  totalValue: number;
  averageAmount: number;
}> {
  try {
    const allPositions = await getAllPositions();
    
    const byStatus: Record<string, number> = {};
    const byStrategy: Record<string, number> = {};
    let totalValue = 0;
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    let recent24h = 0;

    for (const position of allPositions) {
      // Count by status
      byStatus[position.status] = (byStatus[position.status] || 0) + 1;
      
      // Count by strategy
      byStrategy[position.strategyType] = (byStrategy[position.strategyType] || 0) + 1;
      
      // Sum total value
      totalValue += position.usdcAmount || 0;
      
      // Count recent
      const createdAt = new Date(position.createdAt || 0).getTime();
      if (createdAt > oneDayAgo) {
        recent24h++;
      }
    }

    return {
      total: allPositions.length,
      byStatus,
      byStrategy,
      recent24h,
      totalValue,
      averageAmount: allPositions.length > 0 ? totalValue / allPositions.length : 0
    };
  } catch (error) {
    logger.error('Failed to get position stats', LogCategory.API, {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return {
      total: 0,
      byStatus: {},
      byStrategy: {},
      recent24h: 0,
      totalValue: 0,
      averageAmount: 0
    };
  }
}

/**
 * Get error statistics
 */
async function getErrorStats(): Promise<{
  totalErrors: number;
  byType: Record<string, number>;
  recentErrors: Array<{ timestamp: number; type: string; count: number }>;
  rpcFailures: number;
}> {
  try {
    const redis = await getRedis();
    
    // Get RPC failures
    const rpcFailureLogs = await redis.lrange('monitoring:rpc_failures', 0, 99) || [];
    const rpcFailures = rpcFailureLogs.length;
    
    // Get positions with errors
    const failedPositions = await getPositionsByStatus('failed');
    const supplyFailedPositions = await getPositionsByStatus('supply_failed');
    const capFailedPositions = await getPositionsByStatus('gas_sent_cap_failed');
    
    const byType: Record<string, number> = {};
    
    // Count errors by type from positions
    [...failedPositions, ...supplyFailedPositions, ...capFailedPositions].forEach(pos => {
      const errorType = pos.errorType || 'unknown';
      byType[errorType] = (byType[errorType] || 0) + 1;
    });
    
    // Get recent errors from cap failures
    const recentErrors: Array<{ timestamp: number; type: string; count: number }> = [];
    const capFailureLogs = await redis.lrange('monitoring:supply_cap_failures', 0, 49) || [];
    const errorCounts: Record<string, number> = {};
    
    capFailureLogs.forEach((log: string) => {
      try {
        const data = JSON.parse(log);
        const hour = Math.floor(data.timestamp / (1000 * 60 * 60));
        const key = `${hour}:supply_cap`;
        errorCounts[key] = (errorCounts[key] || 0) + 1;
      } catch {
        // Ignore parse errors
      }
    });
    
    Object.entries(errorCounts).forEach(([key, count]) => {
      const [hour, type] = key.split(':');
      recentErrors.push({
        timestamp: parseInt(hour) * 60 * 60 * 1000,
        type,
        count
      });
    });
    
    return {
      totalErrors: failedPositions.length + supplyFailedPositions.length + capFailedPositions.length,
      byType,
      recentErrors: recentErrors.slice(0, 24), // Last 24 hours
      rpcFailures
    };
  } catch (error) {
    logger.error('Failed to get error stats', LogCategory.API, {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return {
      totalErrors: 0,
      byType: {},
      recentErrors: [],
      rpcFailures: 0
    };
  }
}

/**
 * Get refund statistics
 */
async function getRefundStats(): Promise<{
  eligible: number;
  processed: number;
  pending: number;
  totalRefunded: string;
}> {
  try {
    const capFailedPositions = await getPositionsByStatus('gas_sent_cap_failed');
    const refundPendingPositions = await getPositionsByStatus('failed_refund_pending');
    
    const eligible = capFailedPositions.filter(p => !p.refundTxHash).length;
    const processed = refundPendingPositions.length;
    const pending = capFailedPositions.filter(p => {
      const age = Date.now() - new Date(p.createdAt || 0).getTime();
      return age >= 24 * 60 * 60 * 1000 && !p.refundTxHash;
    }).length;
    
    let totalRefunded = 0;
    refundPendingPositions.forEach(p => {
      if (p.refundAmount) {
        totalRefunded += parseFloat(p.refundAmount);
      }
    });
    
    return {
      eligible,
      processed,
      pending,
      totalRefunded: totalRefunded.toFixed(4)
    };
  } catch (error) {
    logger.error('Failed to get refund stats', LogCategory.API, {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return {
      eligible: 0,
      processed: 0,
      pending: 0,
      totalRefunded: '0'
    };
  }
}

/**
 * Main metrics endpoint
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<VercelResponse> {
  // Optional authentication
  const authToken = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.DASHBOARD_METRICS_TOKEN;
  
  if (expectedToken && authToken !== expectedToken) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  try {
    const [supplyCapMetrics, positionStats, errorStats, refundStats] = await Promise.all([
      getSupplyCapMetrics(),
      getPositionStats(),
      getErrorStats(),
      getRefundStats()
    ]);

    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      supplyCap: supplyCapMetrics,
      positions: positionStats,
      errors: errorStats,
      refunds: refundStats
    });
  } catch (error) {
    logger.error('Failed to get metrics', LogCategory.API, {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get metrics'
    });
  }
}
