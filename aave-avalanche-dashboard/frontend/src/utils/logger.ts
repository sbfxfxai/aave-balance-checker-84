/**
 * Professional logging system with environment-aware levels
 * Prevents sensitive data exposure in production
 */

const isDev = import.meta.env.MODE === 'development';

type LogData = string | number | boolean | object | null | undefined;

export const logger = {
  debug: (...args: LogData[]) => {
    if (isDev) {
      console.log('[DEBUG]', ...args);
    }
  },
  
  info: (...args: LogData[]) => {
    if (isDev) {
      console.info('[INFO]', ...args);
    }
  },
  
  warn: (...args: LogData[]) => {
    if (isDev) {
      console.warn('[WARN]', ...args);
    }
  },
  
  error: (...args: LogData[]) => {
    console.error('[ERROR]', ...args);
    // In production, you could send to error tracking service
    if (!isDev && typeof window !== 'undefined') {
      // Could integrate with Sentry, LogRocket, etc.
      // Sentry.captureException(new Error(args.join(' ')));
    }
  },
  
  // Sensitive data logging - only in development
  sensitive: (...args: LogData[]) => {
    if (isDev) {
      console.log('[SENSITIVE]', ...args);
    }
    // Never log sensitive data in production
  },
  
  // Performance logging
  perf: (label: string, startTime?: number) => {
    if (isDev) {
      if (startTime) {
        const duration = performance.now() - startTime;
        console.log(`[PERF] ${label}: ${duration.toFixed(2)}ms`);
      } else {
        console.time(`[PERF] ${label}`);
      }
    }
  },
};

// Export default for easy importing
export default logger;
