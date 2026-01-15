import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';

/**
 * CSP Violation Reporting Endpoint
 * Receives Content Security Policy violation reports from browsers
 * 
 * This endpoint implements CSP report-uri/report-to functionality
 * to track and monitor CSP violations for security analysis
 */

interface CSPViolationReport {
  'csp-report': {
    'document-uri': string;
    'referrer': string;
    'violated-directive': string;
    'effective-directive': string;
    'original-policy': string;
    'blocked-uri': string;
    'status-code': number;
    'source-file'?: string;
    'line-number'?: number;
    'column-number'?: number;
  };
}

const VIOLATION_LOG_LIMIT = 1000;
const VIOLATION_LOG_TTL = 7 * 24 * 60 * 60; // 7 days

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Set CORS headers (browsers send reports cross-origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const report = req.body as CSPViolationReport;
    const cspReport = report['csp-report'];

    if (!cspReport) {
      res.status(400).json({ error: 'Invalid CSP report format' });
      return;
    }

    // Extract violation details
    const violation = {
      timestamp: Date.now(),
      documentUri: cspReport['document-uri']?.substring(0, 200) || 'unknown',
      violatedDirective: cspReport['violated-directive'] || 'unknown',
      effectiveDirective: cspReport['effective-directive'] || 'unknown',
      blockedUri: cspReport['blocked-uri']?.substring(0, 200) || 'unknown',
      sourceFile: cspReport['source-file']?.substring(0, 200),
      lineNumber: cspReport['line-number'],
      columnNumber: cspReport['column-number'],
      statusCode: cspReport['status-code'] || 0,
      referrer: cspReport['referrer']?.substring(0, 200),
    };

    // Log to Redis for analysis
    const redis = await getRedis();
    const logKey = 'csp_violations';
    
    await redis.lpush(logKey, JSON.stringify(violation));
    await redis.ltrim(logKey, 0, VIOLATION_LOG_LIMIT - 1);
    await redis.expire(logKey, VIOLATION_LOG_TTL);

    // Log to console for immediate visibility
    logger.warn('CSP violation reported', LogCategory.SECURITY, {
      violatedDirective: violation.violatedDirective,
      blockedUri: violation.blockedUri.substring(0, 50),
      sourceFile: violation.sourceFile?.substring(0, 50),
    });

    // Track violation patterns for anomaly detection
    const patternKey = `csp_violations:pattern:${violation.violatedDirective}:${violation.blockedUri.substring(0, 50)}`;
    await redis.incr(patternKey);
    await redis.expire(patternKey, 3600); // 1 hour

    // Check for high violation rate (potential attack or misconfiguration)
    const violationCount = await redis.get<number>(patternKey) || 0;
    if (violationCount > 50) {
      logger.error('High CSP violation rate detected', LogCategory.SECURITY, {
        violatedDirective: violation.violatedDirective,
        blockedUri: violation.blockedUri.substring(0, 50),
        count: violationCount,
      });

      // Trigger external alert if configured
      const webhookUrl = process.env.ALERTING_WEBHOOK_URL;
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'csp_violation_anomaly',
            severity: 'warning',
            timestamp: new Date().toISOString(),
            data: {
              violatedDirective: violation.violatedDirective,
              blockedUri: violation.blockedUri.substring(0, 50),
              count: violationCount,
              threshold: 50,
            }
          })
        }).catch(() => {}); // Fire and forget
      }
    }

    // Return 204 No Content (CSP spec requires this)
    res.status(204).end();

  } catch (error) {
    logger.error('Failed to process CSP violation report', LogCategory.SECURITY, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));

    // Still return 204 to prevent browser retries
    res.status(204).end();
  }
}

/**
 * Get CSP violation statistics
 */
export async function getCSPViolationStats(): Promise<{
  totalViolations: number;
  violationsByDirective: Record<string, number>;
  topBlockedUris: Array<{ uri: string; count: number }>;
}> {
  try {
    const redis = await getRedis();
    const violations = await redis.lrange('csp_violations', 0, 999) as string[];

    const violationsByDirective: Record<string, number> = {};
    const blockedUriCounts: Record<string, number> = {};

    for (const violationStr of violations) {
      try {
        const violation = JSON.parse(violationStr);
        const directive = violation.violatedDirective || 'unknown';
        const blockedUri = violation.blockedUri || 'unknown';

        violationsByDirective[directive] = (violationsByDirective[directive] || 0) + 1;
        blockedUriCounts[blockedUri] = (blockedUriCounts[blockedUri] || 0) + 1;
      } catch {
        // Skip invalid entries
      }
    }

    const topBlockedUris = Object.entries(blockedUriCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([uri, count]) => ({ uri: uri.substring(0, 100), count }));

    return {
      totalViolations: violations.length,
      violationsByDirective,
      topBlockedUris,
    };
  } catch (error) {
    logger.error('Failed to get CSP violation stats', LogCategory.SECURITY, {
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      totalViolations: 0,
      violationsByDirective: {},
      topBlockedUris: [],
    };
  }
}
