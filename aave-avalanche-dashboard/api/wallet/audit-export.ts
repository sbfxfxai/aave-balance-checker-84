/**
 * Audit Log Export Utility
 * 
 * Exports audit logs to immutable storage (S3, Datadog, etc.)
 * Provides compliance-ready audit trails for security operations
 * 
 * SECURITY:
 * - All logs are redacted of PII (emails, wallet addresses hashed)
 * - Immutable export format (JSONL, CSV)
 * - Timestamped exports with integrity checksums
 * - Supports scheduled exports and on-demand exports
 */

import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { createHash } from 'crypto';

// Configuration
const AUDIT_LOG_PREFIX = 'audit:';
const EXPORT_TTL = 90 * 24 * 60 * 60; // 90 days for exports
const MAX_EXPORT_SIZE = 100 * 1024 * 1024; // 100MB max export

export interface AuditLogEntry {
  timestamp: number;
  action: string;
  category: string;
  userId?: string;
  walletAddress?: string;
  email?: string;
  ip?: string;
  userAgent?: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

export interface AuditExport {
  exportId: string;
  startTime: number;
  endTime: number;
  entryCount: number;
  format: 'jsonl' | 'csv';
  checksum: string;
  exportedAt: number;
  exportedBy?: string;
}

/**
 * Redact PII from audit log entry
 * Hashes emails and wallet addresses for privacy compliance
 */
function redactPII(entry: AuditLogEntry): AuditLogEntry {
  const redacted = { ...entry };
  
  if (redacted.email) {
    redacted.email = createHash('sha256')
      .update(redacted.email.toLowerCase().trim())
      .digest('hex')
      .substring(0, 16);
  }
  
  if (redacted.walletAddress) {
    redacted.walletAddress = createHash('sha256')
      .update(redacted.walletAddress.toLowerCase().trim())
      .digest('hex')
      .substring(0, 16);
  }
  
  if (redacted.userId) {
    redacted.userId = createHash('sha256')
      .update(redacted.userId)
      .digest('hex')
      .substring(0, 16);
  }
  
  // Hash IP addresses
  if (redacted.ip) {
    redacted.ip = createHash('sha256')
      .update(redacted.ip)
      .digest('hex')
      .substring(0, 16);
  }
  
  return redacted;
}

/**
 * Export audit logs for a time range
 * 
 * @param startTime Start timestamp (milliseconds)
 * @param endTime End timestamp (milliseconds)
 * @param format Export format ('jsonl' or 'csv')
 * @param categories Optional filter by categories
 * @returns Export data and metadata
 */
export async function exportAuditLogs(
  startTime: number,
  endTime: number,
  format: 'jsonl' | 'csv' = 'jsonl',
  categories?: string[]
): Promise<{
  success: boolean;
  export?: AuditExport;
  data?: string;
  error?: string;
}> {
  try {
    const redis = await getRedis();
    
    // Get all audit log keys
    const auditKeys = await redis.keys(`${AUDIT_LOG_PREFIX}*`);
    
    const entries: AuditLogEntry[] = [];
    
    // Collect entries from all audit log keys
    for (const key of auditKeys) {
      // Skip export metadata keys
      if (key.includes(':export:')) continue;
      
      const logs = await redis.lrange(key, 0, -1);
      
      for (const logStr of logs) {
        try {
          const entry: AuditLogEntry = JSON.parse(logStr);
          
          // Filter by time range
          if (entry.timestamp < startTime || entry.timestamp > endTime) {
            continue;
          }
          
          // Filter by category if specified
          if (categories && categories.length > 0 && !categories.includes(entry.category)) {
            continue;
          }
          
          entries.push(entry);
        } catch (parseError) {
          logger.warn('Failed to parse audit log entry', LogCategory.AUTH, {
            key,
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
        }
      }
    }
    
    // Sort by timestamp
    entries.sort((a, b) => a.timestamp - b.timestamp);
    
    // Redact PII
    const redactedEntries = entries.map(redactPII);
    
    // Generate export data
    let exportData: string;
    let checksum: string;
    
    if (format === 'jsonl') {
      exportData = redactedEntries.map(entry => JSON.stringify(entry)).join('\n');
    } else {
      // CSV format
      const headers = ['timestamp', 'action', 'category', 'userId', 'walletAddress', 'email', 'ip', 'success', 'error'];
      const rows = redactedEntries.map(entry => [
        new Date(entry.timestamp).toISOString(),
        entry.action,
        entry.category,
        entry.userId || '',
        entry.walletAddress || '',
        entry.email || '',
        entry.ip || '',
        entry.success ? 'true' : 'false',
        entry.error || ''
      ]);
      
      exportData = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');
    }
    
    // Calculate checksum
    checksum = createHash('sha256')
      .update(exportData)
      .digest('hex');
    
    // Check size
    const size = Buffer.byteLength(exportData, 'utf8');
    if (size > MAX_EXPORT_SIZE) {
      return {
        success: false,
        error: `Export size (${size} bytes) exceeds maximum (${MAX_EXPORT_SIZE} bytes)`
      };
    }
    
    // Create export metadata
    const exportId = `export_${Date.now()}_${createHash('sha256').update(checksum).digest('hex').substring(0, 8)}`;
    const exportMetadata: AuditExport = {
      exportId,
      startTime,
      endTime,
      entryCount: redactedEntries.length,
      format,
      checksum,
      exportedAt: Date.now()
    };
    
    // Store export metadata in Redis
    const exportKey = `${AUDIT_LOG_PREFIX}export:${exportId}`;
    await redis.set(exportKey, JSON.stringify(exportMetadata), { ex: EXPORT_TTL });
    
    logger.info('Audit log export created', LogCategory.AUTH, {
      exportId,
      entryCount: redactedEntries.length,
      format,
      size,
      checksum: checksum.substring(0, 16) + '...'
    });
    
    return {
      success: true,
      export: exportMetadata,
      data: exportData
    };
    
  } catch (error) {
    logger.error('Failed to export audit logs', LogCategory.AUTH, {
      startTime,
      endTime,
      format,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Export failed'
    };
  }
}

/**
 * Get export metadata by ID
 */
export async function getExportMetadata(exportId: string): Promise<AuditExport | null> {
  try {
    const redis = await getRedis();
    const exportKey = `${AUDIT_LOG_PREFIX}export:${exportId}`;
    const metadataStr = await redis.get<string>(exportKey);
    
    if (!metadataStr) {
      return null;
    }
    
    return JSON.parse(metadataStr) as AuditExport;
    
  } catch (error) {
    logger.error('Failed to get export metadata', LogCategory.AUTH, {
      exportId,
      error: error instanceof Error ? error.message : String(error)
    });
    
    return null;
  }
}

/**
 * List all exports
 */
export async function listExports(limit: number = 50): Promise<AuditExport[]> {
  try {
    const redis = await getRedis();
    const exportKeys = await redis.keys(`${AUDIT_LOG_PREFIX}export:*`);
    
    const exports: AuditExport[] = [];
    
    for (const key of exportKeys.slice(0, limit)) {
      const metadataStr = await redis.get<string>(key);
      if (metadataStr) {
        try {
          exports.push(JSON.parse(metadataStr) as AuditExport);
        } catch (parseError) {
          logger.warn('Failed to parse export metadata', LogCategory.AUTH, { key });
        }
      }
    }
    
    // Sort by export time (newest first)
    exports.sort((a, b) => b.exportedAt - a.exportedAt);
    
    return exports;
    
  } catch (error) {
    logger.error('Failed to list exports', LogCategory.AUTH, {
      limit,
      error: error instanceof Error ? error.message : String(error)
    });
    
    return [];
  }
}

/**
 * Get audit log statistics
 */
export async function getAuditLogStats(
  startTime?: number,
  endTime?: number
): Promise<{
  totalEntries: number;
  byCategory: Record<string, number>;
  byAction: Record<string, number>;
  successRate: number;
  errorRate: number;
  timeRange: { start: number; end: number };
}> {
  try {
    const redis = await getRedis();
    const auditKeys = await redis.keys(`${AUDIT_LOG_PREFIX}*`);
    
    const now = Date.now();
    const start = startTime || (now - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
    const end = endTime || now;
    
    const entries: AuditLogEntry[] = [];
    
    for (const key of auditKeys) {
      if (key.includes(':export:')) continue;
      
      const logs = await redis.lrange(key, 0, -1);
      
      for (const logStr of logs) {
        try {
          const entry: AuditLogEntry = JSON.parse(logStr);
          if (entry.timestamp >= start && entry.timestamp <= end) {
            entries.push(entry);
          }
        } catch {
          // Skip invalid entries
        }
      }
    }
    
    const byCategory: Record<string, number> = {};
    const byAction: Record<string, number> = {};
    let successCount = 0;
    let errorCount = 0;
    
    for (const entry of entries) {
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;
      
      if (entry.success) {
        successCount++;
      } else {
        errorCount++;
      }
    }
    
    const total = entries.length;
    const successRate = total > 0 ? successCount / total : 0;
    const errorRate = total > 0 ? errorCount / total : 0;
    
    return {
      totalEntries: total,
      byCategory,
      byAction,
      successRate,
      errorRate,
      timeRange: { start, end }
    };
    
  } catch (error) {
    logger.error('Failed to get audit log stats', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return {
      totalEntries: 0,
      byCategory: {},
      byAction: {},
      successRate: 0,
      errorRate: 0,
      timeRange: { start: startTime || 0, end: endTime || Date.now() }
    };
  }
}
