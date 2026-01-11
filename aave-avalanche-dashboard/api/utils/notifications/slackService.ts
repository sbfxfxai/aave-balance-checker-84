/**
 * Slack Notification Service
 * Sends Slack alerts for critical system issues
 */

import { logger, LogCategory } from '../logger';

type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

interface SlackMessage {
  text: string;
  attachments: SlackAttachment[];
}

interface SlackAttachment {
  color: string;
  title: string;
  text: string;
  fields?: SlackField[];
  footer?: string;
  ts?: number;
}

interface SlackField {
  title: string;
  value: string;
  short?: boolean;
}

interface SlackAlert {
  title: string;
  message: string;
  severity: AlertSeverity;
  timestamp: string;
  context?: Record<string, any>;
}

interface SendResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

class SlackService {
  private static instance: SlackService;
  private isEnabled: boolean;
  private webhookUrl?: string;
  private criticalWebhookUrl?: string;
  private lastMessageTime = 0;
  private recentAlerts = new Map<string, number>();
  
  // Rate limiting: Slack allows 1 message per second per webhook
  private readonly MIN_MESSAGE_INTERVAL = 1000; // 1 second
  private readonly DEDUP_WINDOW = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    this.webhookUrl = process.env.SLACK_WEBHOOK_URL;
    this.criticalWebhookUrl = process.env.SLACK_CRITICAL_WEBHOOK_URL;
    
    // Validate webhook URLs
    this.isEnabled = !!(this.webhookUrl && this.webhookUrl.includes('hooks.slack.com'));
    
    if (this.criticalWebhookUrl && !this.criticalWebhookUrl.includes('hooks.slack.com')) {
      logger.warn('Critical webhook URL appears invalid', LogCategory.API);
    }
  }

  static getInstance(): SlackService {
    if (!SlackService.instance) {
      SlackService.instance = new SlackService();
    }
    return SlackService.instance;
  }

  // Sanitize values to prevent Slack markdown injection
  private sanitizeValue(value: any): string {
    const str = typeof value === 'object' 
      ? JSON.stringify(value, null, 2)
      : String(value);
    
    // Escape Slack special characters and truncate
    return str
      .substring(0, 200)
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/&/g, '&amp;')
      + (str.length > 200 ? '...' : '');
  }

  // Get appropriate webhook URL based on severity
  private getWebhookUrl(severity: AlertSeverity): string {
    if (severity === 'critical' && this.criticalWebhookUrl) {
      return this.criticalWebhookUrl;
    }
    return this.webhookUrl!;
  }

  // Message deduplication to prevent spam
  private shouldSendAlert(alert: SlackAlert): boolean {
    const alertKey = `${alert.title}:${alert.severity}`;
    const lastSent = this.recentAlerts.get(alertKey);
    const now = Date.now();

    if (lastSent && now - lastSent < this.DEDUP_WINDOW) {
      logger.info('Alert deduplicated', LogCategory.API, { alertKey });
      return false;
    }

    this.recentAlerts.set(alertKey, now);
    
    // Cleanup old entries
    for (const [key, time] of this.recentAlerts.entries()) {
      if (now - time > this.DEDUP_WINDOW) {
        this.recentAlerts.delete(key);
      }
    }

    return true;
  }

  private getSeverityColor(severity: AlertSeverity): string {
    const colors = {
      critical: 'danger',    // red
      high: 'warning',       // orange  
      medium: '#ffc107',     // yellow (custom hex - not green!)
      low: 'good'            // green
    };
    return colors[severity] || 'good';
  }

  private getSeverityEmoji(severity: AlertSeverity): string {
    const emojis = {
      critical: '🚨',
      high: '⚠️',
      medium: 'ℹ️',
      low: '✅'
    };
    return emojis[severity] || 'ℹ️';
  }

  private generateSlackMessage(alert: SlackAlert): SlackMessage {
    const color = this.getSeverityColor(alert.severity);
    const emoji = this.getSeverityEmoji(alert.severity);

    // Priority fields: severity and time first
    const fields: SlackField[] = [
      {
        title: 'Severity',
        value: `${emoji} ${alert.severity.toUpperCase()}`,
        short: true
      },
      {
        title: 'Time',
        value: new Date(alert.timestamp).toLocaleString(),
        short: true
      }
    ];

    // Add context fields if available (limit to 8 more to stay under 10 total)
    if (alert.context) {
      Object.entries(alert.context)
        .slice(0, 8) // Limit context fields
        .forEach(([key, value]) => {
          const displayValue = this.sanitizeValue(value);
          
          fields.push({
            title: this.sanitizeValue(key),
            value: displayValue,
            short: displayValue.length < 50
          });
        });
    }

    const attachment: SlackAttachment = {
      color,
      title: this.sanitizeValue(alert.title),
      text: this.sanitizeValue(alert.message),
      fields,
      footer: 'TiltVault Monitoring System',
      ts: Math.floor(new Date(alert.timestamp).getTime() / 1000)
    };

    return {
      text: `${emoji} TiltVault Alert: ${this.sanitizeValue(alert.title)}`,
      attachments: [attachment]
    };
  }

  // Retry logic with exponential backoff
  private async sendSlackMessageWithRetry(
    message: SlackMessage, 
    webhookUrl: string,
    maxRetries = 3
  ): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const messageId = await this.sendSlackMessage(message, webhookUrl);
        return messageId;
      } catch (error) {
        if (attempt === maxRetries) throw error;
        
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10s
        logger.warn(`Slack send attempt ${attempt} failed, retrying in ${delay}ms`, LogCategory.API, {
          error: error instanceof Error ? error.message : 'Unknown',
          attempt,
          maxRetries
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error('All retry attempts failed');
  }

  private async sendSlackMessage(message: SlackMessage, webhookUrl: string): Promise<string> {
    // Rate limiting: enforce minimum interval between messages
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    if (timeSinceLastMessage < this.MIN_MESSAGE_INTERVAL) {
      await new Promise(resolve => 
        setTimeout(resolve, this.MIN_MESSAGE_INTERVAL - timeSinceLastMessage)
      );
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    this.lastMessageTime = Date.now();

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Slack webhook error: ${response.status} - ${error}`);
    }

    // Extract message ID from response if available
    const responseText = await response.text();
    const messageId = responseText.includes('message_ts') 
      ? JSON.parse(responseText).message_ts 
      : `msg_${Date.now()}`;

    logger.info('Slack message sent successfully', LogCategory.API, {
      title: message.text,
      messageId
    });

    return messageId;
  }

  public async sendAlert(alert: SlackAlert): Promise<SendResult> {
    if (!this.isEnabled) {
      return { success: false, error: 'Slack service disabled' };
    }

    // Check deduplication
    if (!this.shouldSendAlert(alert)) {
      return { success: false, error: 'Alert deduplicated' };
    }

    try {
      const message = this.generateSlackMessage(alert);
      const webhookUrl = this.getWebhookUrl(alert.severity);
      const messageId = await this.sendSlackMessageWithRetry(message, webhookUrl);
      
      return { 
        success: true, 
        messageId 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Failed to send Slack alert', LogCategory.API, {
        error: errorMessage,
        alertTitle: alert.title,
        severity: alert.severity
      });

      return { 
        success: false, 
        error: errorMessage 
      };
    }
  }

  public async sendCriticalAlert(title: string, message: string, context?: Record<string, any>): Promise<SendResult> {
    const alert: SlackAlert = {
      title,
      message,
      severity: 'critical',
      timestamp: new Date().toISOString(),
      context
    };

    return this.sendAlert(alert);
  }

  public async sendHighSeverityAlert(title: string, message: string, context?: Record<string, any>): Promise<SendResult> {
    const alert: SlackAlert = {
      title,
      message,
      severity: 'high',
      timestamp: new Date().toISOString(),
      context
    };

    return this.sendAlert(alert);
  }

  public async testSlackConfiguration(): Promise<SendResult> {
    try {
      const testAlert: SlackAlert = {
        title: 'Slack Configuration Test',
        message: 'This is a test message to verify the Slack notification system is working correctly.',
        severity: 'low',
        timestamp: new Date().toISOString(),
        context: {
          test: true,
          service: 'TiltVault Monitoring',
          environment: process.env.NODE_ENV || 'development',
          webhookType: this.webhookUrl ? 'configured' : 'missing',
          criticalWebhook: this.criticalWebhookUrl ? 'configured' : 'missing'
        }
      };

      const result = await this.sendAlert(testAlert);
      
      if (result.success) {
        logger.info('Slack configuration test successful', LogCategory.API, {
          messageId: result.messageId
        });
      } else {
        logger.error('Slack configuration test failed', LogCategory.API, {
          error: result.error
        });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Slack configuration test failed', LogCategory.API, {
        error: errorMessage
      });
      
      return { success: false, error: errorMessage };
    }
  }

  public async sendPaymentFailureAlert(paymentId: string, error: string, context?: Record<string, any>): Promise<SendResult> {
    return this.sendCriticalAlert(
      '💳 Payment Processing Failed',
      `Payment ${paymentId} failed to process: ${error}`,
      {
        paymentId,
        error,
        ...context
      }
    );
  }

  public async sendGMXFailureAlert(tradeId: string, error: string, context?: Record<string, any>): Promise<SendResult> {
    return this.sendCriticalAlert(
      '📈 GMX Trade Failed',
      `GMX trade ${tradeId} failed to execute: ${error}`,
      {
        tradeId,
        error,
        ...context
      }
    );
  }

  public async sendServiceDownAlert(serviceName: string, error: string, context?: Record<string, any>): Promise<SendResult> {
    return this.sendHighSeverityAlert(
      '🔴 Service Unavailable',
      `Service ${serviceName} is down or unresponsive: ${error}`,
      {
        serviceName,
        error,
        ...context
      }
    );
  }

  public async sendHighErrorRateAlert(errorCount: number, timeWindow: string, context?: Record<string, any>): Promise<SendResult> {
    return this.sendHighSeverityAlert(
      '📊 High Error Rate Detected',
      `${errorCount} errors detected in the last ${timeWindow}`,
      {
        errorCount,
        timeWindow,
        ...context
      }
    );
  }

  public async sendMemoryUsageAlert(usagePercent: number, context?: Record<string, any>): Promise<SendResult> {
    const severity: AlertSeverity = usagePercent > 90 ? 'critical' : 'high';
    return this.sendAlert({
      title: '💾 High Memory Usage',
      message: `Memory usage is at ${usagePercent}%`,
      severity,
      timestamp: new Date().toISOString(),
      context: {
        usagePercent,
        ...context
      }
    });
  }
}

export const slackService = SlackService.getInstance();
