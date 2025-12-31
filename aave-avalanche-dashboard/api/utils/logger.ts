/**
 * Production Logging System
 * Structured logging for monitoring and debugging
 */

export enum LogLevel {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG'
}

export enum LogCategory {
  API = 'API',
  PAYMENT = 'PAYMENT',
  GMX = 'GMX',
  AUTH = 'AUTH',
  WEBHOOK = 'WEBHOOK',
  DATABASE = 'DATABASE',
  INFRASTRUCTURE = 'INFRASTRUCTURE',
  USER_ACTION = 'USER_ACTION'
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  context?: Record<string, any>;
  requestId?: string;
  userId?: string;
  walletAddress?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

class Logger {
  private static instance: Logger;
  private isEnabled: boolean;
  private logLevel: LogLevel;
  private logBuffer: LogEntry[] = [];
  private maxBufferSize = 1000;

  private constructor() {
    this.isEnabled = process.env.NODE_ENV === 'production';
    this.logLevel = this.getLogLevel();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private getLogLevel(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case 'ERROR': return LogLevel.ERROR;
      case 'WARN': return LogLevel.WARN;
      case 'INFO': return LogLevel.INFO;
      case 'DEBUG': return LogLevel.DEBUG;
      default: return LogLevel.INFO;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.ERROR, LogLevel.WARN, LogLevel.INFO, LogLevel.DEBUG];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex <= currentLevelIndex;
  }

  private formatLogEntry(entry: LogEntry): string {
    const contextStr = entry.context ? ` | Context: ${JSON.stringify(entry.context)}` : '';
    const durationStr = entry.duration ? ` | Duration: ${entry.duration}ms` : '';
    const errorStr = entry.error ? ` | Error: ${entry.error.name}: ${entry.error.message}` : '';
    
    return `[${entry.timestamp}] ${entry.level} [${entry.category}] ${entry.message}${contextStr}${durationStr}${errorStr}`;
  }

  private addToBuffer(entry: LogEntry): void {
    this.logBuffer.push(entry);
    
    // Keep buffer size manageable
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }
  }

  private writeLog(entry: LogEntry): void {
    if (!this.shouldLog(entry.level)) return;

    const formattedMessage = this.formatLogEntry(entry);
    
    if (entry.level === LogLevel.ERROR) {
      console.error(formattedMessage);
    } else if (entry.level === LogLevel.WARN) {
      console.warn(formattedMessage);
    } else if (entry.level === LogLevel.INFO) {
      console.info(formattedMessage);
    } else {
      console.log(formattedMessage);
    }

    // In production, also send to log aggregation service
    if (this.isEnabled) {
      this.sendToLogService(entry);
    }
  }

  private async sendToLogService(entry: LogEntry): Promise<void> {
    try {
      // Example: Send to log aggregation service (Datadog, Logstash, etc.)
      // await fetch('https://your-log-service.com/api/logs', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(entry)
      // });
    } catch (error) {
      console.error('[LOGGER] Failed to send log to service:', error);
    }
  }

  public error(message: string, category: LogCategory, context?: Record<string, any>, error?: Error): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      category,
      message,
      context,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  public warn(message: string, category: LogCategory, context?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      category,
      message,
      context
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  public info(message: string, category: LogCategory, context?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      category,
      message,
      context
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  public debug(message: string, category: LogCategory, context?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.DEBUG,
      category,
      message,
      context
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  public logPerformance(operation: string, category: LogCategory, duration: number, context?: Record<string, any>): void {
    this.info(`Performance: ${operation}`, category, {
      ...context,
      performance: {
        operation,
        duration,
        timestamp: new Date().toISOString()
      }
    });
  }

  public logUserAction(action: string, userId?: string, walletAddress?: string, context?: Record<string, any>): void {
    this.info(`User Action: ${action}`, LogCategory.USER_ACTION, {
      userId,
      walletAddress,
      ...context
    });
  }

  public logApiCall(method: string, url: string, statusCode: number, duration: number, context?: Record<string, any>): void {
    const level = statusCode >= 400 ? LogLevel.WARN : LogLevel.INFO;
    const message = `${method} ${url} - ${statusCode}`;
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category: LogCategory.API,
      message,
      context: {
        ...context,
        api: {
          method,
          url,
          statusCode,
          duration
        }
      }
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  public getLogStats(): {
    totalLogs: number;
    logsByLevel: Record<string, number>;
    logsByCategory: Record<string, number>;
    recentLogs: LogEntry[];
  } {
    const logsByLevel: Record<string, number> = {};
    const logsByCategory: Record<string, number> = {};

    this.logBuffer.forEach(log => {
      logsByLevel[log.level] = (logsByLevel[log.level] || 0) + 1;
      logsByCategory[log.category] = (logsByCategory[log.category] || 0) + 1;
    });

    return {
      totalLogs: this.logBuffer.length,
      logsByLevel,
      logsByCategory,
      recentLogs: this.logBuffer.slice(-50) // Last 50 logs
    };
  }

  public clearBuffer(): void {
    this.logBuffer = [];
  }
}

export const logger = Logger.getInstance();
