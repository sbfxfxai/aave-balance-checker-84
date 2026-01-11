/**
 * Monitoring Configuration
 * Central configuration for all monitoring systems
 */

// Type definitions
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface MonitoringConfig {
  errorTracking: {
    enabled: boolean;
    maxQueueSize: number;
    sendToExternalService: boolean;
  };
  logging: {
    enabled: boolean;
    level: LogLevel;
    maxBufferSize: number;
    sendToLogService: boolean;
  };
  healthChecks: {
    enabled: boolean;
    intervalMs: number;
    timeoutMs: number;
    services: string[];
  };
  alerting: {
    enabled: boolean;
    hasWebhook: boolean;
    hasSlackWebhook: boolean;
    emailRecipients: {
      count: number;
      hasRecipients: boolean;
    };
    thresholds: {
      errorRate: {
        critical: number;
        high: number;
      };
      memoryUsage: {
        critical: number;
        high: number;
        medium: number;
      };
      responseTime: {
        critical: number;
        high: number;
        medium: number;
      };
    };
  };
  performance: {
    enabled: boolean;
    sampleRate: number;
    maxTracesPerMinute: number;
    traceTimeoutMs: number;
  };
}

// Validation helpers
function getPositiveInt(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const parsed = parseInt(envVar, 10);
  return (parsed > 0 && parsed < 1000000) ? parsed : defaultValue;
}

function getPercentage(envVar: string | undefined, defaultValue: number): number {
  if (!envVar) return defaultValue;
  const parsed = parseFloat(envVar);
  return (parsed >= 0 && parsed <= 100) ? parsed : defaultValue;
}

function getFloat(envVar: string | undefined, defaultValue: number, min: number, max: number): number {
  if (!envVar) return defaultValue;
  const parsed = parseFloat(envVar);
  return (parsed >= min && parsed <= max) ? parsed : defaultValue;
}

function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toUpperCase();
  const validLogLevels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
  return validLogLevels.includes(level as LogLevel) 
    ? (level as LogLevel) 
    : 'INFO';
}

function getEmailRecipientInfo(): { count: number; hasRecipients: boolean } {
  const recipients = (process.env.ALERT_EMAIL_RECIPIENTS || '')
    .split(',')
    .map(e => e.trim())
    .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  
  return {
    count: recipients.length,
    hasRecipients: recipients.length > 0
  };
}

// Secure configuration - no sensitive URLs stored
export const monitoringConfig: MonitoringConfig = {
  // Error Tracking
  errorTracking: {
    enabled: process.env.NODE_ENV === 'production',
    maxQueueSize: getPositiveInt(process.env.ERROR_MAX_QUEUE_SIZE, 100),
    sendToExternalService: !!process.env.ERROR_SERVICE_URL,
    // Don't store the actual URL for security
  },

  // Logging
  logging: {
    enabled: true,
    level: getLogLevel(),
    maxBufferSize: getPositiveInt(process.env.LOG_MAX_BUFFER_SIZE, 1000),
    sendToLogService: !!process.env.LOG_SERVICE_URL,
    // Don't store the actual URL for security
  },

  // Health Checks
  healthChecks: {
    enabled: true,
    intervalMs: getPositiveInt(process.env.HEALTH_CHECK_INTERVAL, 60000),
    timeoutMs: getPositiveInt(process.env.HEALTH_CHECK_TIMEOUT, 30000),
    services: [
      'database',
      'avalanche_rpc',
      'square_api',
      'gmx_api',
      'memory'
    ]
  },

  // Alerting
  alerting: {
    enabled: process.env.NODE_ENV === 'production',
    hasWebhook: !!process.env.ALERT_WEBHOOK_URL,
    hasSlackWebhook: !!process.env.SLACK_WEBHOOK_URL,
    emailRecipients: getEmailRecipientInfo(),
    // Don't store actual URLs or emails for security
    
    // Alert thresholds
    thresholds: {
      errorRate: {
        critical: getPositiveInt(process.env.ERROR_RATE_CRITICAL, 10),
        high: getPositiveInt(process.env.ERROR_RATE_HIGH, 5)
      },
      memoryUsage: {
        critical: getPercentage(process.env.MEMORY_CRITICAL_THRESHOLD, 90),
        high: getPercentage(process.env.MEMORY_HIGH_THRESHOLD, 85),
        medium: getPercentage(process.env.MEMORY_MEDIUM_THRESHOLD, 75)
      },
      responseTime: {
        critical: getPositiveInt(process.env.RESPONSE_TIME_CRITICAL, 5000),
        high: getPositiveInt(process.env.RESPONSE_TIME_HIGH, 3000),
        medium: getPositiveInt(process.env.RESPONSE_TIME_MEDIUM, 1000)
      }
    }
  },

  // Performance Monitoring
  performance: {
    enabled: true,
    sampleRate: getFloat(process.env.PERFORMANCE_SAMPLE_RATE, 1.0, 0.0, 1.0),
    maxTracesPerMinute: getPositiveInt(process.env.MAX_TRACES_PER_MINUTE, 100),
    traceTimeoutMs: getPositiveInt(process.env.TRACE_TIMEOUT, 30000)
  }
};

// Configuration validation
export function validateMonitoringConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate alerting thresholds make sense
  if (monitoringConfig.alerting.thresholds.errorRate.critical <= 
      monitoringConfig.alerting.thresholds.errorRate.high) {
    errors.push('Critical error rate threshold must be higher than high threshold');
  }
  
  // Validate health check timing
  if (monitoringConfig.healthChecks.timeoutMs >= monitoringConfig.healthChecks.intervalMs) {
    errors.push('Health check timeout must be less than interval');
  }
  
  // Validate memory thresholds are logical
  if (monitoringConfig.alerting.thresholds.memoryUsage.critical <= 
      monitoringConfig.alerting.thresholds.memoryUsage.high ||
      monitoringConfig.alerting.thresholds.memoryUsage.high <= 
      monitoringConfig.alerting.thresholds.memoryUsage.medium) {
    errors.push('Memory usage thresholds must be: critical > high > medium');
  }
  
  // Validate response time thresholds are logical
  if (monitoringConfig.alerting.thresholds.responseTime.critical <= 
      monitoringConfig.alerting.thresholds.responseTime.high ||
      monitoringConfig.alerting.thresholds.responseTime.high <= 
      monitoringConfig.alerting.thresholds.responseTime.medium) {
    errors.push('Response time thresholds must be: critical > high > medium');
  }
  
  // Validate sample rate
  if (monitoringConfig.performance.sampleRate < 0 || monitoringConfig.performance.sampleRate > 1) {
    errors.push('Performance sample rate must be between 0 and 1');
  }
  
  // Validate queue sizes are reasonable
  if (monitoringConfig.errorTracking.maxQueueSize > 10000) {
    errors.push('Error tracking queue size too large (max 10000)');
  }
  
  if (monitoringConfig.logging.maxBufferSize > 100000) {
    errors.push('Log buffer size too large (max 100000)');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Secure access to sensitive values
export class SecureMonitoringConfig {
  private static validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
  
  static getErrorServiceUrl(): string | null {
    const url = process.env.ERROR_SERVICE_URL;
    return url && this.validateUrl(url) ? url : null;
  }
  
  static getLogServiceUrl(): string | null {
    const url = process.env.LOG_SERVICE_URL;
    return url && this.validateUrl(url) ? url : null;
  }
  
  static getAlertWebhook(): string | null {
    const url = process.env.ALERT_WEBHOOK_URL;
    return url && this.validateUrl(url) ? url : null;
  }
  
  static getSlackWebhook(): string | null {
    const url = process.env.SLACK_WEBHOOK_URL;
    return url && this.validateUrl(url) ? url : null;
  }
  
  static getAlertEmails(): string[] {
    return (process.env.ALERT_EMAIL_RECIPIENTS || '')
      .split(',')
      .map(e => e.trim())
      .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  }
}

// Initialize validation on import
const validation = validateMonitoringConfig();
if (!validation.valid) {
  console.error('❌ Invalid monitoring configuration:', validation.errors);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  } else {
    console.warn('⚠️  Monitoring configuration issues detected in development mode');
  }
} else {
  console.log('✅ Monitoring configuration validated successfully');
}

export default monitoringConfig;
