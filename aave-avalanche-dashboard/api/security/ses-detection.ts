import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';

/**
 * SES Detection Tracking Endpoint
 * Tracks SES (Secure EcmaScript) lockdown detection from wallet extensions
 * 
 * This endpoint receives anonymized detection events to monitor:
 * - Prevalence of SES lockdown in user browsers
 * - Compatibility issues with wallet extensions
 * - Trends over time
 * 
 * No PII is collected - only detection events
 */

const DETECTION_LOG_LIMIT = 10000;
const DETECTION_LOG_TTL = 30 * 24 * 60 * 60; // 30 days

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Set CORS headers
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
    const { timestamp } = req.body as { timestamp?: number };

    // Create anonymized detection event
    const detection = {
      timestamp: timestamp || Date.now(),
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD for aggregation
      hour: new Date().getHours(), // Hour of day for pattern analysis
    };

    // Log to Redis for analysis
    const redis = await getRedis();
    const logKey = 'ses_detections';
    
    await redis.lpush(logKey, JSON.stringify(detection));
    await redis.ltrim(logKey, 0, DETECTION_LOG_LIMIT - 1);
    await redis.expire(logKey, DETECTION_LOG_TTL);

    // Track daily count for trend analysis
    const dailyKey = `ses_detections:daily:${detection.date}`;
    await redis.incr(dailyKey);
    await redis.expire(dailyKey, 60 * 60 * 24 * 35); // 35 days

    // Log to console (non-verbose)
    logger.info('SES detection tracked', LogCategory.SECURITY, {
      date: detection.date,
      hour: detection.hour,
    });

    // Return success
    res.status(200).json({ success: true });

  } catch (error) {
    logger.error('Failed to track SES detection', LogCategory.SECURITY, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));

    // Return success even on error to prevent retries
    res.status(200).json({ success: false });
  }
}

/**
 * Get SES detection statistics
 */
export async function getSESDetectionStats(): Promise<{
  totalDetections: number;
  detectionsByDate: Record<string, number>;
  detectionsByHour: Record<number, number>;
  recentDetections: number; // Last 24 hours
}> {
  try {
    const redis = await getRedis();
    const detections = await redis.lrange('ses_detections', 0, 9999) as string[];

    const detectionsByDate: Record<string, number> = {};
    const detectionsByHour: Record<number, number> = {};
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    let recentDetections = 0;

    for (const detectionStr of detections) {
      try {
        const detection = JSON.parse(detectionStr);
        const date = detection.date || 'unknown';
        const hour = detection.hour ?? -1;
        const timestamp = detection.timestamp || 0;

        detectionsByDate[date] = (detectionsByDate[date] || 0) + 1;
        detectionsByHour[hour] = (detectionsByHour[hour] || 0) + 1;

        if (timestamp > oneDayAgo) {
          recentDetections++;
        }
      } catch {
        // Skip invalid entries
      }
    }

    return {
      totalDetections: detections.length,
      detectionsByDate,
      detectionsByHour,
      recentDetections,
    };
  } catch (error) {
    logger.error('Failed to get SES detection stats', LogCategory.SECURITY, {
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      totalDetections: 0,
      detectionsByDate: {},
      detectionsByHour: {},
      recentDetections: 0,
    };
  }
}
