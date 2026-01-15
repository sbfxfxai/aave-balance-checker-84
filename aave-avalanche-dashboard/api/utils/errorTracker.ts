/**
 * Production Error Tracking System
 * Centralized error logging and monitoring for production issues
 */

import { logger, LogCategory } from './logger';
import { Redis } from '@upstash/redis';

interface ErrorContext {
  userId?: string;
  walletAddress?: string;
  requestId?: string;
  endpoint?: string;
  method?: string;
  userAgent?: string;
  timestamp: string;
  environment: string;
  version: string;
  requestBody?: string;
  responseStatus?: number;
  duration?: number;
  ip?: string;
}

interface ErrorOptions {
  category?: ErrorReport['category'];
  severity?: ErrorReport['severity'];
  context?: Partial<ErrorContext>;
}

interface ErrorReport {
  error: any; // Serialized error object
  context: ErrorContext;
  stack?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'payment' | 'gmx' | 'auth' | 'api' | 'infrastructure' | 'user_error';
}

interface ErrorEntry {
  fingerprint: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  report: ErrorReport;
}

class ErrorTracker {
  private static instance: ErrorTracker;
  private isEnabled: boolean;
  private maxHistorySize = 1000;

  // Redis keys
  private readonly ERROR_QUEUE_KEY = 'errors:queue';
  private readonly ERROR_TTL = 24 * 60 * 60; // 24 hours
  private readonly STATS_TTL = 5 * 60; // 5 minutes for stats

  // Rate limiting per error fingerprint
  private readonly RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
  private readonly MAX_ERRORS_PER_FINGERPRINT = 10;

  private constructor() {
    // Enable unless explicitly disabled
    this.isEnabled = process.env.ERROR_TRACKING_ENABLED !== 'false';
  }

  static getInstance(): ErrorTracker {
    if (!ErrorTracker.instance) {
      ErrorTracker.instance = new ErrorTracker();
    }
    return ErrorTracker.instance;
  }

  // Get Redis client with proper error handling
  private async getRedis(): Promise<Redis> {
    try {
      const url = process.env.KV_REST_API_URL || process.env.REDIS_URL;
      const token = process.env.KV_REST_API_TOKEN;

      if (!url || !token) {
        throw new Error('Redis configuration missing for error tracking');
      }

      return new Redis({ url, token });
    } catch (error) {
      logger.error('Failed to initialize Redis for error tracking', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private getContext(request?: any): ErrorContext {
    return {
      userId: request?.userId || request?.user?.id,
      walletAddress: request?.walletAddress || request?.connectedAddress,
      requestId: request?.requestId || this.generateRequestId(),
      endpoint: request?.url || request?.path,
      method: request?.method,
      userAgent: request?.headers?.['user-agent'],
      requestBody: request?.body ? JSON.stringify(request.body).substring(0, 500) : undefined,
      responseStatus: request?.status,
      duration: request?.duration,
      ip: request?.headers?.['x-forwarded-for'] || request?.headers?.['x-real-ip'],
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0'
    };
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Generate error fingerprint for deduplication
  private generateFingerprint(errorReport: ErrorReport): string {
    const { error, category, context } = errorReport;

    const message = typeof error?.message === 'string' ? error?.message : (error?.message || '').toString();
    const stack = typeof error === 'string' ? '' : error?.stack || '';

    // Extract first meaningful stack frame (skip node_modules)
    const stackLine = stack
      .split('\n')
      .find((line: string) => !line.includes('node_modules')) || '';

    // Create fingerprint from category, message, and location
    const fingerprintStr = `${category}:${message}:${stackLine}:${context.endpoint || 'no-endpoint'}`;

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < fingerprintStr.length; i++) {
      const char = fingerprintStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return `fp_${Math.abs(hash).toString(36)}`;
  }

  // Rate limiting per error fingerprint
  private shouldRateLimit(fingerprint: string): boolean {
    const rateLimitKey = `error:rate_limit:${fingerprint}`;
    // Implementation would require Redis with rate limiting
    return false; // For now, no rate limiting
  }

  // Better error categorization with priority-based matching
  private categorizeError(error: Error, endpoint?: string): ErrorReport['category'] {
    const message = error.message.toLowerCase();

    // Priority-based categorization (most specific first)
    if (message.includes('square') && (message.includes('payment') || message.includes('transaction'))) {
      return 'payment';
    }
    if (message.includes('gmx') && (message.includes('trade') || message.includes('position'))) {
      return 'gmx';
    }
    if (message.includes('privy') || message.includes('auth') || message.includes('wallet')) {
      return 'auth';
    }
    if (message.includes('timeout') || message.includes('network') || message.includes('fetch')) {
      return 'infrastructure';
    }
    if (message.includes('validation') || message.includes('invalid') || message.includes('format')) {
      return 'user_error';
    }

    // Fallback to API
    return 'api';
  }

  // Improved severity logic with context awareness
  private getSeverity(error: Error, category: ErrorReport['category']): ErrorReport['severity'] {
    const message = error.message.toLowerCase();

    // Validation/user errors are always low severity
    if (message.includes('validation') || message.includes('invalid') || message.includes('format')) {
      return 'low';
    }

    // Timeout/network issues are high severity
    if (message.includes('timeout') || message.includes('network') || message.includes('fetch')) {
      return 'high';
    }

    // Category-based severity with context awareness
    if (category === 'payment' || category === 'gmx') {
      // Transaction failures are critical, but validation errors are medium
      return message.includes('validation') ? 'medium' : 'critical';
    }

    if (category === 'auth' || category === 'infrastructure') {
      return 'high';
    }

    if (category === 'api') {
      return 'medium';
    }

    return 'low';
  }

  // Proper error serialization to handle circular references
  private serializeError(error: Error): any {
    try {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        // Include any custom properties
        ...(Object.keys(error).length > 0 ? error : {})
      };
    } catch (serializationError) {
      // Fallback for circular references
      return {
        name: error.name || 'Error',
        message: error.message || 'Unknown error',
        stack: error.stack || 'No stack available'
      };
    }
  }

  // Redis-based error storage with deduplication
  private async addToQueue(errorReport: ErrorReport): Promise<void> {
    try {
      const redis = await this.getRedis();
      const fingerprint = this.generateFingerprint(errorReport);

      // Check rate limiting
      if (this.shouldRateLimit(fingerprint)) {
        logger.info('Error rate limited', LogCategory.API, { fingerprint });
        return;
      }

      // Check if error already exists
      const existingKey = `error:${fingerprint}`;
      const existing = await redis.get(existingKey);

      if (existing) {
        // Increment count and update last seen
        const errorEntry: ErrorEntry = JSON.parse(existing as string);
        errorEntry.count++;
        errorEntry.lastSeen = errorReport.context.timestamp;
        await redis.set(existingKey, JSON.stringify(errorEntry), { ex: this.ERROR_TTL });
      } else {
        // New error
        const errorEntry: ErrorEntry = {
          fingerprint,
          count: 1,
          firstSeen: errorReport.context.timestamp,
          lastSeen: errorReport.context.timestamp,
          report: errorReport
        };
        await redis.set(existingKey, JSON.stringify(errorEntry), { ex: this.ERROR_TTL });
        await redis.lpush(this.ERROR_QUEUE_KEY, fingerprint);
        await redis.ltrim(this.ERROR_QUEUE_KEY, 0, this.maxHistorySize - 1);
        await redis.expire(this.ERROR_QUEUE_KEY, this.ERROR_TTL);
      }

      // Update time-based stats for alerting system
      const timeWindow = this.getTimeWindow();
      const statsKey = `errors:stats:${timeWindow}`;
      await redis.hincrby(statsKey, 'total', 1);
      await redis.hincrby(statsKey, `category:${errorReport.category}`, 1);
      await redis.hincrby(statsKey, `severity:${errorReport.severity}`, 1);
      await redis.expire(statsKey, this.STATS_TTL);

    } catch (error) {
      logger.error('Failed to store error in Redis', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error',
        fingerprint: this.generateFingerprint(errorReport)
      });

      // Fall back to in-memory queue for critical errors
      if (errorReport.severity === 'critical') {
        console.error('[CRITICAL ERROR]', errorReport);
      }
    }
  }

  // Get time window for stats (5-minute windows)
  private getTimeWindow(): string {
    const now = new Date();
    const minutes = Math.floor(now.getMinutes() / 5) * 5; // Round to 5-minute window
    now.setMinutes(minutes, 0, 0);
    return now.toISOString();
  }

  // Send to monitoring services (Sentry, etc.)
  private async sendToMonitoring(errorReport: ErrorReport): Promise<void> {
    if (!this.isEnabled) return;

    try {
      console.error('[ERROR TRACKER]', JSON.stringify(errorReport, null, 2));

      // Send to Sentry if configured
      if (process.env.SENTRY_DSN) {
        // Note: This would require @sentry/node package
        // await import * as Sentry from '@sentry/node';
        // Sentry.captureException(errorReport.error, {
        //   level: this.getSentryLevel(errorReport.severity),
        //   tags: {
        //     category: errorReport.category,
        //     environment: errorReport.context.environment,
        //     fingerprint: this.generateFingerprint(errorReport)
        //   },
        //   extra: errorReport.context
        // });
      }

    } catch (monitoringError) {
      logger.error('Failed to send error to monitoring', LogCategory.API, {
        error: monitoringError instanceof Error ? monitoringError.message : 'Unknown error'
      });
    }
  }

  private getSentryLevel(severity: ErrorReport['severity']): 'fatal' | 'error' | 'warning' | 'info' | 'debug' {
    switch (severity) {
      case 'critical': return 'fatal';
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'error';
    }
  }

  public async trackError(
    error: Error | string,
    request?: any,
    options?: ErrorOptions
  ): Promise<void> {
    if (!this.isEnabled) {
      // In development, just log to console
      console.error('[DEV ERROR]', error, options);
      return;
    }

    const errorObj = typeof error === 'string' ? new Error(error) : error;
    const context = {
      ...this.getContext(request),
      ...options?.context
    };

    const category = options?.category || this.categorizeError(errorObj, context.endpoint);
    const severity = options?.severity || this.getSeverity(errorObj, category);

    const errorReport: ErrorReport = {
      error: this.serializeError(errorObj),
      context,
      stack: errorObj.stack,
      severity,
      category
    };

    await this.addToQueue(errorReport);
    await this.sendToMonitoring(errorReport);
  }

  // Convenience methods with forced categories
  public async trackPaymentError(error: Error | string, paymentData?: any, request?: any): Promise<void> {
    await this.trackError(error, request, {
      category: 'payment',
      severity: 'critical',
      context: paymentData
    });
  }

  public async trackGMXError(error: Error | string, tradeData?: any, request?: any): Promise<void> {
    await this.trackError(error, request, {
      category: 'gmx',
      severity: 'critical',
      context: tradeData
    });
  }

  public async trackAuthError(error: Error | string, authData?: any, request?: any): Promise<void> {
    await this.trackError(error, request, {
      category: 'auth',
      severity: 'high',
      context: authData
    });
  }

  public async getErrorStats(windowMinutes: number = 5): Promise<{
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    recentErrors: ErrorReport[];
  }> {
    try {
      const redis = await this.getRedis();

      // Get current time window stats
      const statsKey = `errors:stats:${this.getTimeWindow()}`;
      const stats = await redis.hgetall(statsKey);

      const totalErrors = parseInt(stats?.total as string || '0');
      const errorsByCategory: Record<string, number> = {};
      const errorsBySeverity: Record<string, number> = {};

      // Parse category and severity stats
      Object.entries(stats || {}).forEach(([key, value]) => {
        if (key.startsWith('category:')) {
          errorsByCategory[key.replace('category:', '')] = parseInt(value as string);
        } else if (key.startsWith('severity:')) {
          errorsBySeverity[key.replace('severity:', '')] = parseInt(value as string);
        }
      });

      // Get recent error fingerprints
      const fingerprints = await redis.lrange(this.ERROR_QUEUE_KEY, 0, 9);
      const recentErrors: ErrorReport[] = [];

      for (const fp of fingerprints) {
        const errorEntry = await redis.get(`error:${fp}`);
        if (errorEntry) {
          const entry = JSON.parse(errorEntry as string);
          recentErrors.push(entry.report);
        }
      }

      return {
        totalErrors,
        errorsByCategory,
        errorsBySeverity,
        recentErrors
      };

    } catch (error) {
      logger.error('Failed to get stats from Redis', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Fallback to in-memory queue
      const errorsByCategory: Record<string, number> = {};
      const errorsBySeverity: Record<string, number> = {};

      // Note: In serverless, this will always be empty
      return {
        totalErrors: 0,
        errorsByCategory,
        errorsBySeverity,
        recentErrors: []
      };
    }
  }

  public async getRecentErrors(count: number = 10): Promise<ErrorReport[]> {
    try {
      const redis = await this.getRedis();

      // Get recent error fingerprints
      const fingerprints = await redis.lrange(this.ERROR_QUEUE_KEY, 0, count - 1);
      const recentErrors: ErrorReport[] = [];

      for (const fp of fingerprints) {
        const errorEntry = await redis.get(`error:${fp}`);
        if (errorEntry) {
          const entry = JSON.parse(errorEntry as string);
          recentErrors.push(entry.report);
        }
      }

      return recentErrors;

    } catch (error) {
      logger.error('Failed to get recent errors from Redis', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  public async clearQueue(): Promise<void> {
    try {
      const redis = await this.getRedis();
      await redis.del(this.ERROR_QUEUE_KEY);
      logger.info('Error queue cleared', LogCategory.API);
    } catch (error) {
      console.error('[ERROR TRACKER] Failed to clear queue in Redis:', error);
    }
  }

  // Cleanup method for graceful shutdown
  public shutdown(): void {
    logger.info('Error tracker shutdown', LogCategory.API);
  }
}

export const errorTracker = ErrorTracker.getInstance();
