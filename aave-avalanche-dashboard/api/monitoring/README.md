# Production Monitoring System

This comprehensive monitoring system provides visibility into production issues, error tracking, alerting, and dashboards for the TiltVault application.

## 🚀 Features

### 🔍 Error Tracking
- Centralized error collection and categorization
- Automatic severity classification
- Context tracking (user, wallet, request details)
- Error queue management with configurable size limits

### 📊 Structured Logging
- Multiple log levels (ERROR, WARN, INFO, DEBUG)
- Log categorization for better filtering
- Performance logging for API calls and operations
- Log buffering and external service integration

### 🏥 Health Checks
- Database connectivity monitoring
- External API health (Avalanche RPC, Square, GMX)
- Memory usage monitoring
- Configurable check intervals and timeouts

### 🚨 Alerting System
- Rule-based alert triggers
- Multiple severity levels
- Webhook and email notifications
- Cooldown periods to prevent alert fatigue
- Alert history and resolution tracking

### 📈 Monitoring Dashboards
- Real-time system overview
- Error statistics and trends
- Alert management interface
- Performance metrics visualization

## 📁 File Structure

```
api/
├── utils/
│   ├── errorTracker.ts     # Centralized error tracking
│   ├── logger.ts            # Structured logging system
│   ├── healthCheck.ts       # Health check monitoring
│   └── alerting.ts         # Alerting system
├── monitoring/
│   ├── health.ts            # Health check API endpoint
│   ├── dashboard.ts         # Monitoring dashboard API
│   ├── config.ts            # Monitoring configuration
│   └── README.md            # This file
└── square/
    └── webhook.ts           # Integrated monitoring
```

## 🔧 Configuration

### Environment Variables

```bash
# Error Tracking
ERROR_SERVICE_URL=https://your-error-service.com/api/errors

# Logging
LOG_LEVEL=INFO                    # ERROR, WARN, INFO, DEBUG
LOG_SERVICE_URL=https://your-log-service.com/api/logs

# Alerting
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
ALERT_EMAIL_RECIPIENTS=admin@tiltvault.com,dev@tiltvault.com

# External Services
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
SQUARE_ACCESS_TOKEN=your_square_token
```

## 📡 API Endpoints

### Health Check
```
GET /api/monitoring/health
```

Returns system health status including:
- Overall system status (healthy/degraded/unhealthy)
- Individual service health checks
- Response times and error details
- System uptime and version

### Monitoring Dashboard
```
GET /api/monitoring/dashboard
```

Returns comprehensive monitoring data:
- System overview statistics
- Recent errors and alerts
- Performance metrics
- Log statistics
- Health check summaries

## 🚨 Alert Types

### Critical Alerts
- **Payment Failures**: Square payment processing errors
- **GMX Failures**: GMX integration issues
- **Service Down**: Critical service unavailability

### High Severity Alerts
- **Authentication Failures**: Auth system issues
- **Infrastructure Issues**: Network, database problems

### Medium Severity Alerts
- **API Errors**: General API errors
- **Performance Degradation**: Slow response times

### Low Severity Alerts
- **User Errors**: Validation and user input errors

## 📊 Monitoring Metrics

### Error Metrics
- Total error count by category
- Error severity distribution
- Recent error timeline
- Error rate trends

### Performance Metrics
- API response times
- Memory usage statistics
- Request throughput
- Error rates

### Health Metrics
- Service availability percentages
- Response time distributions
- Uptime statistics
- Resource utilization

## 🔍 Usage Examples

### Tracking Errors
```typescript
import { errorTracker } from '../utils/errorTracker';

// Track a payment error
errorTracker.trackPaymentError(
  new Error('Payment processing failed'),
  { paymentId: 'pay_123', amount: 100 }
);

// Track a GMX error
errorTracker.trackGMXError(
  new Error('Trade execution failed'),
  { tradeId: 'trade_456', pair: 'USDC/AVAX' }
);
```

### Logging
```typescript
import { logger, LogCategory } from '../utils/logger';

// Log API call
logger.logApiCall('POST', '/api/square/webhook', 200, 150, {
  paymentId: 'pay_123',
  eventType: 'payment.paid'
});

// Log user action
logger.logUserAction('deposit_initiated', 'user_123', '0x123...', {
  amount: 100,
  strategy: 'conservative'
});
```

### Triggering Alerts
```typescript
import { alertingSystem } from '../utils/alerting';

// Trigger payment alert
await alertingSystem.triggerPaymentError(
  new Error('Square API timeout'),
  { paymentId: 'pay_123' }
);

// Trigger service down alert
await alertingSystem.triggerServiceDown(
  'avalanche_rpc',
  new Error('Connection timeout')
);
```

## 🚀 Deployment

### Production Setup
1. Set environment variables for monitoring services
2. Configure webhook URLs for alert notifications
3. Set up log aggregation service (optional)
4. Configure error tracking service (optional)

### Monitoring Services Integration
The monitoring system is designed to integrate with:
- **Sentry**: Error tracking and performance monitoring
- **Datadog**: Log aggregation and metrics
- **Logstash**: Centralized logging
- **Slack**: Alert notifications via webhooks
- **Email**: Alert notifications via SMTP

## 📈 Best Practices

### Error Tracking
- Track errors at the source with context
- Include user and wallet information when available
- Use appropriate severity levels
- Add relevant context for debugging

### Logging
- Use structured logging with consistent format
- Include request IDs for tracing
- Log performance metrics for critical operations
- Avoid logging sensitive information

### Alerting
- Set appropriate cooldown periods
- Use descriptive alert titles and messages
- Include relevant context in alerts
- Monitor and adjust alert thresholds

### Health Checks
- Monitor all critical dependencies
- Set appropriate timeouts
- Include meaningful error messages
- Check resource utilization

## 🔧 Maintenance

### Regular Tasks
- Review error patterns and trends
- Adjust alert thresholds based on usage
- Monitor log storage and retention
- Update monitoring configurations

### Troubleshooting
- Check health check endpoints for system status
- Review recent alerts for issues
- Analyze error patterns for root causes
- Monitor performance metrics for degradation

## 📞 Support

For monitoring system issues:
1. Check the health endpoint: `/api/monitoring/health`
2. Review recent alerts in the dashboard
3. Check error statistics and trends
4. Verify external service configurations
