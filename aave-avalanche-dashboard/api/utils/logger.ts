/**
 * Logging utilities for consistent application logging
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  source: string;
  metadata?: Record<string, any>;
  requestId?: string;
  userId?: string;
  error?: {
    message: string;
    stack?: string;
    name: string;
  };
}

export interface LoggerConfig {
  level: LogLevel;
  includeMetadata: boolean;
  includeStackTrace: boolean;
  maxLogSize: number;
  enableConsole: boolean;
  enableFile: boolean;
  format: 'json' | 'text';
}

class Logger {
  private config: LoggerConfig;
  private logs: LogEntry[] = [];

  constructor(config: LoggerConfig) {
    this.config = config;
  }

  /**
   * Log a message
   */
  log(
    level: LogLevel,
    message: string,
    source: string = 'app',
    metadata?: Record<string, any>,
    error?: Error
  ): void {
    if (level < this.config.level) return;

    const logEntry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      source,
      metadata: this.config.includeMetadata ? metadata : undefined,
      error: error && this.config.includeStackTrace ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : undefined
    };

    this.logs.push(logEntry);
    this.trimLogs();

    if (this.config.enableConsole) {
      this.outputToConsole(logEntry);
    }
  }

  /**
   * Convenience methods for different log levels
   */
  debug(message: string, source?: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, source, metadata);
  }

  info(message: string, source?: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, source, metadata);
  }

  warn(message: string, source?: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, source, metadata);
  }

  error(message: string, source?: string, metadata?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.ERROR, message, source, metadata, error);
  }

  fatal(message: string, source?: string, metadata?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.FATAL, message, source, metadata, error);
  }

  /**
   * Get recent logs
   */
  getRecentLogs(limit: number = 100, level?: LogLevel): LogEntry[] {
    let filtered = this.logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    if (level !== undefined) {
      filtered = filtered.filter(log => log.level === level);
    }
    
    return filtered.slice(0, limit);
  }

  /**
   * Clear old logs
   */
  clearOldLogs(olderThanHours: number = 24): void {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    this.logs = this.logs.filter(log => log.timestamp > cutoff);
  }

  /**
   * Export logs
   */
  exportLogs(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      const headers = ['timestamp', 'level', 'source', 'message', 'metadata'];
      const rows = this.logs.map(log => [
        log.timestamp.toISOString(),
        LogLevel[log.level],
        log.source,
        log.message.replace(/"/g, '""'),
        JSON.stringify(log.metadata || {}).replace(/"/g, '""')
      ]);
      return [headers, ...rows].map(row => row.join(',')).join('\n');
    }

    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Get log statistics
   */
  getLogStats(timeframeHours: number = 24): {
    total: number;
    byLevel: Record<string, number>;
    bySource: Record<string, number>;
    ratePerHour: number;
  } {
    const cutoff = new Date(Date.now() - timeframeHours * 60 * 60 * 1000);
    const recentLogs = this.logs.filter(log => log.timestamp > cutoff);

    const byLevel = recentLogs.reduce((acc, log) => {
      const levelName = LogLevel[log.level];
      acc[levelName] = (acc[levelName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const bySource = recentLogs.reduce((acc, log) => {
      acc[log.source] = (acc[log.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      total: recentLogs.length,
      byLevel,
      bySource,
      ratePerHour: recentLogs.length / timeframeHours
    };
  }

  private outputToConsole(logEntry: LogEntry): void {
    const levelName = LogLevel[logEntry.level];
    const timestamp = logEntry.timestamp.toISOString();
    
    if (this.config.format === 'json') {
      console.log(JSON.stringify(logEntry));
    } else {
      const metadataStr = logEntry.metadata ? ` ${JSON.stringify(logEntry.metadata)}` : '';
      const errorStr = logEntry.error ? ` Error: ${logEntry.error.message}` : '';
      console.log(`[${timestamp}] ${levelName} [${logEntry.source}] ${logEntry.message}${metadataStr}${errorStr}`);
    }
  }

  private trimLogs(): void {
    if (this.logs.length > this.config.maxLogSize) {
      this.logs = this.logs
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, this.config.maxLogSize);
    }
  }
}

// Default logger instance
export const logger = new Logger({
  level: process.env.NODE_ENV === 'production' ? LogLevel.INFO : LogLevel.DEBUG,
  includeMetadata: true,
  includeStackTrace: process.env.NODE_ENV === 'development',
  maxLogSize: 10000,
  enableConsole: true,
  enableFile: false,
  format: process.env.LOG_FORMAT === 'json' ? 'json' : 'text'
});

// Create context-aware logger for specific modules
export function createLogger(source: string): {
  debug: (message: string, metadata?: Record<string, any>) => void;
  info: (message: string, metadata?: Record<string, any>) => void;
  warn: (message: string, metadata?: Record<string, any>) => void;
  error: (message: string, metadata?: Record<string, any>, error?: Error) => void;
  fatal: (message: string, metadata?: Record<string, any>, error?: Error) => void;
} {
  return {
    debug: (message: string, metadata?: Record<string, any>) => logger.debug(message, source, metadata),
    info: (message: string, metadata?: Record<string, any>) => logger.info(message, source, metadata),
    warn: (message: string, metadata?: Record<string, any>) => logger.warn(message, source, metadata),
    error: (message: string, metadata?: Record<string, any>, error?: Error) => logger.error(message, source, metadata, error),
    fatal: (message: string, metadata?: Record<string, any>, error?: Error) => logger.fatal(message, source, metadata, error)
  };
}

// Request logging middleware helper
export function logRequest(
  method: string,
  url: string,
  statusCode: number,
  responseTime: number,
  requestId?: string,
  userId?: string
): void {
  const level = statusCode >= 400 ? LogLevel.WARN : LogLevel.INFO;
  const message = `${method} ${url} ${statusCode} - ${responseTime}ms`;
  
  logger.log(level, message, 'http', {
    method,
    url,
    statusCode,
    responseTime,
    requestId,
    userId
  });
}
