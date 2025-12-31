/**
 * Monitoring Configuration
 * Central configuration for all monitoring systems
 */

export const monitoringConfig = {
  // Error Tracking
  errorTracking: {
    enabled: process.env.NODE_ENV === 'production',
    maxQueueSize: 100,
    sendToExternalService: !!process.env.ERROR_SERVICE_URL,
    errorServiceUrl: process.env.ERROR_SERVICE_URL,
  },

  // Logging
  logging: {
    enabled: true,
    level: (process.env.LOG_LEVEL as any) || 'INFO',
    maxBufferSize: 1000,
    sendToLogService: !!process.env.LOG_SERVICE_URL,
    logServiceUrl: process.env.LOG_SERVICE_URL,
  },

  // Health Checks
  healthChecks: {
    enabled: true,
    intervalMs: 60000, // 1 minute
    timeoutMs: 30000, // 30 seconds
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
    webhookUrl: process.env.ALERT_WEBHOOK_URL,
    emailRecipients: (process.env.ALERT_EMAIL_RECIPIENTS || '').split(',').filter(Boolean),
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    
    // Alert thresholds
    thresholds: {
      errorRate: {
        critical: 10, // errors per 5 minutes
        high: 5
      },
      memoryUsage: {
        critical: 90, // percentage
        high: 85,
        medium: 75
      },
      responseTime: {
        critical: 5000, // ms
        high: 3000,
        medium: 1000
      }
    }
  },

  // Performance Monitoring
  performance: {
    enabled: true,
    sampleRate: 1.0, // 100% sampling in production
    maxTracesPerMinute: 100,
    traceTimeoutMs: 30000
  }
};

export default monitoringConfig;
