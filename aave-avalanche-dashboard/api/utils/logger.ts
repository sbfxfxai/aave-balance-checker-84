/**
 * Production Logging System
 * Structured logging for monitoring and debugging
 */

import { logger, LogCategory } from './logger'; // Import existing logger
import { Redis } from '@upstash/redis';

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
  private currentRequestId?: string;
  
  // Redis-based log buffer for serverless compatibility
  private readonly LOG_BUFFER_KEY = 'logs:buffer';
  private readonly MAX_BUFFER_SIZE = 1000;
  private readonly LOG_TTL = 24 * 60 * 60; // 24 hours
  
  // Async log batching
  private logQueue: LogEntry[] = [];
  private flushTimeout?: NodeJS.Timeout;
  private readonly BATCH_SIZE = 100;
  private readonly FLUSH_INTERVAL = 5000; // 5 seconds
  
  // Configuration
  private readonly SAMPLE_RATES = {
    [LogLevel.ERROR]: 1.0,    // Always log errors
    [LogLevel.WARN]: 1.0,    // Always log warnings
    [LogLevel.INFO]: 0.1,    // 10% sampling
    [LogLevel.DEBUG]: 0.01   // 1% sampling
  };
  
  // PII redaction patterns
  private readonly SENSITIVE_PATTERNS = [
    /password/i,
    /token/i,
    /api[_-]?key/i,
    /secret/i,
    /private[_-]?key/i,
    /ssn/i,
    /credit[_-]?card/i,
    /cvv/i,
    /mnemonic/i,
    /wallet[_-]?private[_-]?key/i
  ];

  private constructor() {
    this.isEnabled = process.env.LOGGING_ENABLED !== 'false';
    this.logLevel = this.getLogLevel();
    
    if (this.isEnabled) {
      this.startLogFlusher();
    }
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

  // Set request ID for tracing across the request
  public setRequestId(requestId: string): void {
    this.currentRequestId = requestId;
  }

  // Clear request ID when request ends
  public clearRequestId(): void {
    this.currentRequestId = undefined;
  }

  // PII redaction to prevent sensitive data exposure
  private sanitizeContext(context?: Record<string, any>): Record<string, any> | undefined {
    if (!context) return undefined;
    
    const sanitized = { ...context };
    
    for (const [key, value] of Object.entries(sanitized)) {
      // Check if key contains sensitive terms
      if (this.SENSITIVE_PATTERNS.some(pattern => pattern.test(key))) {
        sanitized[key] = '[REDACTED]';
        continue;
      }
      
      // Check if value is sensitive
      if (typeof value === 'string') {
        if (this.SENSITIVE_PATTERNS.some(pattern => pattern.test(value))) {
          sanitized[key] = '[REDCATED]';
          continue;
        }
      }
      
      // Recursively sanitize nested objects
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeContext(value);
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          typeof item === 'object' && item !== null ? this.sanitizeContext(item) : item
        );
      }
    }
    
    return sanitized;
  }

  // Safe JSON serialization to handle circular references
  private safeStringify(obj: any, maxLength = 1000): string {
    const seen = new WeakSet();
    
    const replacer = (key: string, value: any): any => {
      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular Reference]';
        seen.add(value);
      }
      
      // Handle non-serializable types
      if (typeof value === 'function') return '[Function]';
      if (typeof value === 'undefined') return '[Undefined]';
      if (typeof value === 'symbol') return value.toString();
      if (typeof value === 'bigint') return value.toString();
      
      return value;
    };
    
    try {
      const str = JSON.stringify(obj, replacer);
      return str.length > maxLength ? str.substring(0, maxLength) + '...[truncated]' : str;
    } catch (error) {
      return `[Serialization Error: ${error instanceof Error ? error.message : 'Unknown error'}]`;
    }
  }

  // Log sampling to control volume and cost
  private shouldSampleLog(entry: LogEntry): boolean {
    // Always log errors and warnings
    if (entry.level === LogLevel.ERROR || entry.level === LogLevel.WARN) {
      return true;
    }
    
    // Use configured sample rates
    const sampleRate = this.SAMPLE_RATES[entry.level] || 0.01;
    
    // Allow override via environment variable
    const envSampleRate = parseFloat(process.env.LOG_SAMPLE_RATE || String(sampleRate));
    
    return Math.random() < envSampleRate;
  }

  // Get Redis client with proper error handling
  private async getRedis(): Promise<Redis> {
    try {
      const url = process.env.KV_REST_API_URL || process.env.REDIS_URL;
      const token = process.env.KV_REST_API_TOKEN;
      
      if (!url || !token) {
        throw new Error('Redis configuration missing for logging');
      }
      
      return new Redis({ url, token });
    } catch (error) {
      console.error('[LOGGER] Failed to initialize Redis for logging', error);
      throw error;
    }
  }

  // Add log entry to Redis buffer (serverless compatible)
  private async addToBuffer(entry: LogEntry): Promise<void> {
    try {
      const redis = await this.getRedis();
      
      // Add to Redis list (newest first)
      await redis.lpush(this.LOG_BUFFER_KEY, this.safeStringify(entry));
      
      // Trim to max size
      await redis.ltrim(this.LOG_BUFFER_KEY, 0, this.MAX_BUFFER_SIZE - 1);
      
      // Set TTL
      await redis.expire(this.LOG_BUFFER_KEY, this.LOG_TTL);
      
    } catch (error) {
      // Don't fail logging if Redis fails
      console.error('[LOGGER] Failed to add log to buffer:', error);
    }
  }

  // Get log buffer from Redis
  private async getLogBuffer(limit: number = 50): Promise<LogEntry[]> {
    try {
      const redis = await this.getRedis();
      const logs = await redis.lrange(this.LOG_BUFFER_KEY, 0, limit - 1);
      
      return logs.map(logStr => {
        try {
          return JSON.parse(logStr as string);
        } catch {
          return null;
        }
      }).filter((log): log is LogEntry => log !== null);
      
    } catch (error) {
      console.error('[LOGGER] Failed to get log buffer:', error);
      return [];
    }
  }

  // Format log entry for console output (development)
  private formatLogEntry(entry: LogEntry): string {
    const contextStr = entry.context ? ` | Context: ${this.safeStringify(entry.context, 200)}` : '';
    const durationStr = entry.duration ? ` | Duration: ${entry.duration}ms` : '';
    const errorStr = entry.error ? ` | Error: ${entry.error.name}: ${entry.error.message}` : '';
    
    return `[${entry.timestamp}] ${entry.level} [${entry.category}] ${entry.message}${contextStr}${durationStr}${errorStr}`;
  }

  // Queue log entry for async batch sending
  private queueForSending(entry: LogEntry): void {
    this.logQueue.push(entry);
    
    // Flush if queue is full
    if (this.logQueue.length >= this.BATCH_SIZE) {
      this.flushLogs();
    } else if (!this.flushTimeout) {
      // Otherwise flush after interval
      this.flushTimeout = setTimeout(() => {
        this.flushLogs();
      }, this.FLUSH_INTERVAL);
    }
  }

  // Start background log flushing
  private startLogFlusher(): void {
    if (this.flushTimeout) {
      clearInterval(this.flushTimeout);
    }
    
    this.flushTimeout = setInterval(() => {
      this.flushLogs().catch(error => {
        console.error('[LOGGER] Failed to flush logs:', error);
      });
    }, this.FLUSH_INTERVAL);
  }

  // Flush logs to external service
  private async flushLogs(): Promise<void> {
    if (this.logQueue.length === 0) {
      return;
    }
    
    const batch = this.logQueue.splice(0, this.BATCH_SIZE);
    this.flushTimeout = undefined;
    
    try {
      // Send to log aggregation service
      if (process.env.LOG_SERVICE_URL && process.env.LOG_SERVICE_API_KEY) {
        const response = await fetch(process.env.LOG_SERVICE_URL, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.LOG_SERVICE_API_KEY}` 
          },
          body: JSON.stringify({ 
            logs: batch,
            source: 'tiltvault-api',
            timestamp: new Date().toISOString()
          })
        });
        
        if (!response.ok) {
          throw new Error(`Log service returned ${response.status}`);
        }
      }
    } catch (error) {
      console.error('[LOGGER] Failed to send logs to service:', error);
      // Don't re-add to queue to avoid infinite loop
    }
  }

  // Core logging method
  private writeLog(entry: LogEntry): void {
    if (!this.shouldSampleLog(entry)) return;

    // Output format depends on environment
    if (this.isEnabled) {
      // Structured JSON for production log aggregation
      const jsonLog = this.safeStringify(entry);
      
      if (entry.level === LogLevel.ERROR) {
        console.error(jsonLog);
      } else if (entry.level === LogLevel.WARN) {
        console.warn(jsonLog);
      } else if (entry.level === LogLevel.INFO) {
        console.info(jsonLog);
      } else {
        console.log(jsonLog);
      }
    } else {
      // Human-readable format for development
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
    }

    // Queue for async batch sending
    if (this.isEnabled) {
      this.queueForSending(entry);
    }
  }

  public error(message: string, category: LogCategory, context?: Record<string, any>, error?: Error): void {
    const sanitizedContext = this.sanitizeContext(context);
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.ERROR,
      category,
      message,
      context: sanitizedContext,
      requestId: this.currentRequestId,
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
    const sanitizedContext = this.sanitizeContext(context);
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.WARN,
      category,
      message,
      context: sanitizedContext,
      requestId: this.currentRequestId
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  public info(message: string, category: LogCategory, context?: Record<string, any>): void {
    const sanitizedContext = this.sanitizeContext(context);
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      category,
      message,
      context: sanitizedContext,
      requestId: this.currentRequestId
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  public debug(message: string, category: LogCategory, context?: Record<string, any>): void {
    const sanitizedContext = this.sanitizeContext(context);
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.DEBUG,
      category,
      message,
      context: sanitizedContext,
      requestId: this.currentRequestId
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  // Performance logging with dynamic levels based on duration
  public logPerformance(operation: string, category: LogCategory, duration: number, context?: Record<string, any>): void {
    // Dynamic level based on duration
    let level: LogLevel;
    if (duration > 10000) {
      level = LogLevel.ERROR;
    } else if (duration > 5000) {
      level = LogLevel.WARN;
    } else if (duration > 1000) {
      level = LogLevel.INFO;
    } else {
      level = LogLevel.DEBUG;
    }
    
    const sanitizedContext = this.sanitizeContext(context);
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message: `Performance: ${operation}`,
      requestId: this.currentRequestId,
      duration,
      context: this.sanitizeContext({
        ...sanitizedContext,
        performance: {
          operation,
          duration,
          threshold: duration > 5000 ? 'SLOW' : duration > 1000 ? 'ACCEPTABLE' : 'FAST'
        }
      })
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  public logUserAction(action: string, userId?: string, walletAddress?: string, context?: Record<string, any>): void {
    // Sanitize PII in user action logs
    const sanitizedContext = this.sanitizeContext(context);
    
    // Redact wallet address partially for privacy
    const sanitizedWalletAddress = walletAddress 
      ? `${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}`
      : undefined;
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      category: LogCategory.USER_ACTION,
      message: `User Action: ${action}`,
      context: this.sanitizeContext({
        ...sanitizedContext,
        userId,
        walletAddress: sanitizedWalletAddress
      })
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  // API call logging with better error handling
  public logApiCall(
    method: string, 
    url: string, 
    statusCode: number, 
    duration: number, 
    context?: Record<string, any>,
    error?: Error
  ): void {
    // Better status code handling
    const level = statusCode >= 500 ? LogLevel.ERROR :
                  statusCode >= 400 ? LogLevel.WARN :
                  statusCode >= 300 ? LogLevel.INFO :
                  LogLevel.DEBUG;
    
    const message = `${method} ${url} - ${statusCode} (${duration}ms)`;
    
    const sanitizedContext = this.sanitizeContext(context);
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category: LogCategory.API,
      message,
      requestId: this.currentRequestId,
      duration,
      context: this.sanitizeContext({
        ...sanitizedContext,
        api: {
          method,
          url,
          statusCode,
          duration
        }
      }),
      error: error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : undefined
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  // Transaction logging for payment operations
  public logTransaction(
    transactionId: string,
    type: string,
    status: 'started' | 'completed' | 'failed',
    context?: Record<string, any>
  ): void {
    const level = status === 'failed' ? LogLevel.ERROR : LogLevel.INFO;
    
    const sanitizedContext = this.sanitizeContext(context);
    
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category: LogCategory.PAYMENT,
      message: `Transaction ${status}: ${type}`,
      requestId: this.currentRequestId,
      context: this.sanitizeContext({
        ...sanitizedContext,
        transaction: {
          id: transactionId,
          type,
          status,
          timestamp: new Date().toISOString()
        }
      })
    };

    this.addToBuffer(entry);
    this.writeLog(entry);
  }

  // Get log statistics from Redis
  public async getLogStats(windowMinutes: number = 60): Promise<{
    totalLogs: number;
    logsByLevel: Record<string, number>;
    logsByCategory: Record<string, number>;
    recentLogs: LogEntry[];
    errorRate: number;
    avgDuration?: number;
  }> {
    try {
      const redis = await this.getRedis();
      
      // Get recent logs
      const recentLogs = await this.getLogBuffer(50);
      
      // Calculate statistics
      const logsByLevel: Record<string, number> = {};
      const logsByCategory: Record<string, number> = {};
      let totalDuration = 0;
      let durationCount = 0;
      
      recentLogs.forEach(log => {
        logsByLevel[log.level] = (logsByLevel[log.level] || 0) + 1);
        logsByCategory[log.category] = (logsByCategory[log.category] || 0) + 1);
        
        if (log.duration) {
          totalDuration += log.duration;
          durationCount++;
        }
      });
      
      const errorCount = logsByLevel[LogLevel.ERROR] || 0;
      const totalLogs = recentLogs.length;
      const errorRate = totalLogs > 0 ? (errorCount / totalLogs) * 100 : 0;
      
      return {
        totalLogs,
        logsByLevel,
        logsByCategory,
        recentLogs,
        errorRate,
        avgDuration: durationCount > 0 ? Math.round(totalDuration / durationCount) : undefined
      };
      
    } catch (error) {
      console.error('[LOGGER] Failed to get log stats:', error);
      return {
        totalLogs: 0,
        logsByLevel: {},
        logsByCategory: {},
        recentLogs: [],
        errorRate: 0
      };
    }
  }

  // Clear log buffer
  public async clearBuffer(): Promise<void> {
    try {
      const redis = await this.getRedis();
      await redis.del(this.LOG_BUFFER_KEY);
      console.log('[LOGGER] Log buffer cleared');
    } catch (error) {
      console.error('[LOGGER] Failed to clear log buffer:', error);
    }
  }

  // Cleanup method for graceful shutdown
  public shutdown(): void {
    if (this.flushTimeout) {
      clearInterval(this.flushTimeout);
      this.flushTimeout = undefined;
    }
    
    // Flush any remaining logs
    if (this.logQueue.length > 0) {
      this.flushLogs().catch(error => {
        console.error('[LOGGER] Failed to flush logs on shutdown:', error);
      });
    }
    
    console.log('[LOGGER] Logger shutdown');
  }
}

export const logger = Logger.getInstance();
