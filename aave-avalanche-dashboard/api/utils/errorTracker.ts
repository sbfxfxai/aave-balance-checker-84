/**
 * Error tracking and reporting utilities
 */

export interface ErrorReport {
  id: string;
  message: string;
  stack?: string;
  level: 'warning' | 'error' | 'critical';
  source: string;
  userId?: string;
  requestId?: string;
  timestamp: Date;
  metadata: Record<string, any>;
  context: {
    userAgent?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
  };
}

export interface ErrorTrackerConfig {
  enabled: boolean;
  maxErrors: number;
  includeStackTrace: boolean;
  includeContext: boolean;
  samplingRate: number; // 0-1, percentage of errors to track
}

class ErrorTracker {
  private config: ErrorTrackerConfig;
  private errors: ErrorReport[] = [];

  constructor(config: ErrorTrackerConfig) {
    this.config = config;
  }

  /**
   * Track an error
   */
  trackError(
    error: Error | string,
    level: ErrorReport['level'] = 'error',
    source: string = 'unknown',
    metadata: Record<string, any> = {},
    context: Partial<ErrorReport['context']> = {}
  ): string {
    if (!this.config.enabled || Math.random() > this.config.samplingRate) {
      return '';
    }

    const errorReport: ErrorReport = {
      id: `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      message: typeof error === 'string' ? error : error.message,
      stack: this.config.includeStackTrace && error instanceof Error ? error.stack : undefined,
      level,
      source,
      timestamp: new Date(),
      metadata,
      context: {
        userAgent: context.userAgent,
        url: context.url,
        method: context.method,
        headers: this.config.includeContext ? context.headers : undefined,
        body: this.config.includeContext ? context.body : undefined
      }
    };

    this.errors.push(errorReport);
    this.trimErrors();

    console.error(`[ErrorTracker] ${level.toUpperCase()} in ${source}: ${errorReport.message}`, {
      id: errorReport.id,
      metadata
    });

    return errorReport.id;
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 50, level?: ErrorReport['level']): ErrorReport[] {
    let filtered = this.errors.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    if (level) {
      filtered = filtered.filter(error => error.level === level);
    }
    
    return filtered.slice(0, limit);
  }

  /**
   * Get error statistics
   */
  getErrorStats(timeframeHours: number = 24): {
    total: number;
    byLevel: Record<ErrorReport['level'], number>;
    bySource: Record<string, number>;
    ratePerHour: number;
  } {
    const cutoff = new Date(Date.now() - timeframeHours * 60 * 60 * 1000);
    const recentErrors = this.errors.filter(error => error.timestamp > cutoff);

    const byLevel = recentErrors.reduce((acc, error) => {
      acc[error.level] = (acc[error.level] || 0) + 1;
      return acc;
    }, {} as Record<ErrorReport['level'], number>);

    const bySource = recentErrors.reduce((acc, error) => {
      acc[error.source] = (acc[error.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: recentErrors.length,
      byLevel,
      bySource,
      ratePerHour: recentErrors.length / timeframeHours
    };
  }

  /**
   * Clear old errors
   */
  clearOldErrors(olderThanHours: number = 24): void {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    this.errors = this.errors.filter(error => error.timestamp > cutoff);
  }

  /**
   * Export errors for analysis
   */
  exportErrors(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      const headers = ['id', 'timestamp', 'level', 'source', 'message', 'metadata'];
      const rows = this.errors.map(error => [
        error.id,
        error.timestamp.toISOString(),
        error.level,
        error.source,
        error.message.replace(/"/g, '""'),
        JSON.stringify(error.metadata).replace(/"/g, '""')
      ]);
      return [headers, ...rows].map(row => row.join(',')).join('\n');
    }

    return JSON.stringify(this.errors, null, 2);
  }

  private trimErrors(): void {
    if (this.errors.length > this.config.maxErrors) {
      this.errors = this.errors
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, this.config.maxErrors);
    }
  }
}

// Default error tracker instance
export const errorTracker = new ErrorTracker({
  enabled: true,
  maxErrors: 1000,
  includeStackTrace: process.env.NODE_ENV === 'development',
  includeContext: process.env.NODE_ENV === 'development',
  samplingRate: 1.0 // Track all errors
});

// Convenience function for API handlers
export function trackApiError(
  error: Error | string,
  source: string,
  req?: any,
  metadata?: Record<string, any>
): string {
  return errorTracker.trackError(error, 'error', source, metadata || {}, {
    userAgent: req?.headers?.['user-agent'],
    url: req?.url,
    method: req?.method,
    headers: req?.headers,
    body: req?.body
  });
}
