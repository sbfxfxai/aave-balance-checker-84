/**
 * Logging Utility
 * 
 * Centralized logging system that:
 * - Supports different log levels (debug, info, warn, error)
 * - Can be disabled in production
 * - Provides consistent formatting with component context
 * - Can be easily extended for remote logging
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  component?: string;
  [key: string]: unknown;
}

class Logger {
  private isDevelopment: boolean;
  private enabledLevels: Set<LogLevel>;

  constructor() {
    // Check if we're in development mode
    this.isDevelopment = import.meta.env.DEV || import.meta.env.MODE === 'development';
    
    // In production, only show warn and error
    // In development, show all levels
    this.enabledLevels = new Set<LogLevel>(
      this.isDevelopment 
        ? ['debug', 'info', 'warn', 'error']
        : ['warn', 'error']
    );
  }

  /**
   * Enable or disable specific log levels
   */
  setLevels(levels: LogLevel[]): void {
    this.enabledLevels = new Set(levels);
  }

  /**
   * Enable all log levels (useful for debugging)
   */
  enableAll(): void {
    this.enabledLevels = new Set(['debug', 'info', 'warn', 'error']);
  }

  /**
   * Disable all logging (useful for production)
   */
  disableAll(): void {
    this.enabledLevels.clear();
  }

  private formatMessage(component: string, message: string, context?: LogContext): string {
    const prefix = `[${component}]`;
    if (context && Object.keys(context).length > 0) {
      return `${prefix} ${message}`;
    }
    return `${prefix} ${message}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabledLevels.has(level);
  }

  debug(component: string, message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return;
    const formatted = this.formatMessage(component, message, context);
    console.debug(formatted, context || '');
  }

  info(component: string, message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return;
    const formatted = this.formatMessage(component, message, context);
    console.info(formatted, context || '');
  }

  warn(component: string, message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return;
    const formatted = this.formatMessage(component, message, context);
    console.warn(formatted, context || '');
  }

  error(component: string, message: string, error?: Error | unknown, context?: LogContext): void {
    if (!this.shouldLog('error')) return;
    const formatted = this.formatMessage(component, message, context);
    
    if (error instanceof Error) {
      console.error(formatted, error, context || '');
    } else if (error) {
      console.error(formatted, error, context || '');
    } else {
      console.error(formatted, context || '');
    }
  }

  /**
   * Log success messages (info level with success indicator)
   */
  success(component: string, message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return;
    const formatted = this.formatMessage(component, `✅ ${message}`, context);
    console.info(formatted, context || '');
  }
}

// Export singleton instance
export const logger = new Logger();

// Export convenience functions for common use cases
export const createComponentLogger = (componentName: string) => ({
  debug: (message: string, context?: LogContext) => logger.debug(componentName, message, context),
  info: (message: string, context?: LogContext) => logger.info(componentName, message, context),
  warn: (message: string, context?: LogContext) => logger.warn(componentName, message, context),
  error: (message: string, error?: Error | unknown, context?: LogContext) => 
    logger.error(componentName, message, error, context),
  success: (message: string, context?: LogContext) => logger.success(componentName, message, context),
});

