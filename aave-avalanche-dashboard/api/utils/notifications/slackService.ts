/**
 * Slack Notification Service
 * Sends Slack alerts for critical system issues
 */

import { logger, LogCategory } from '../logger';

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
  severity: string;
  timestamp: string;
  context?: Record<string, any>;
}

class SlackService {
  private static instance: SlackService;
  private isEnabled: boolean;
  private webhookUrl?: string;

  private constructor() {
    this.isEnabled = !!process.env.SLACK_WEBHOOK_URL;
    this.webhookUrl = process.env.SLACK_WEBHOOK_URL;
  }

  static getInstance(): SlackService {
    if (!SlackService.instance) {
      SlackService.instance = new SlackService();
    }
    return SlackService.instance;
  }

  private getSeverityColor(severity: string): string {
    const colors = {
      critical: 'danger',    // red
      high: 'warning',       // orange
      medium: 'good',        // green
      low: '#36a64f'         // light green
    };
    return colors[severity as keyof typeof colors] || 'good';
  }

  private getSeverityEmoji(severity: string): string {
    const emojis = {
      critical: '🚨',
      high: '⚠️',
      medium: 'ℹ️',
      low: '✅'
    };
    return emojis[severity as keyof typeof emojis] || 'ℹ️';
  }

  private generateSlackMessage(alert: SlackAlert): SlackMessage {
    const color = this.getSeverityColor(alert.severity);
    const emoji = this.getSeverityEmoji(alert.severity);

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

    // Add context fields if available
    if (alert.context) {
      Object.entries(alert.context).forEach(([key, value]) => {
        const displayValue = typeof value === 'object' 
          ? JSON.stringify(value, null, 2).substring(0, 200) + (JSON.stringify(value).length > 200 ? '...' : '')
          : String(value);
        
        fields.push({
          title: key,
          value: displayValue,
          short: displayValue.length < 50
        });
      });
    }

    const attachment: SlackAttachment = {
      color,
      title: alert.title,
      text: alert.message,
      fields: fields.slice(0, 10), // Slack limits to 10 fields per attachment
      footer: 'TiltVault Monitoring System',
      ts: Math.floor(new Date(alert.timestamp).getTime() / 1000)
    };

    return {
      text: `${emoji} TiltVault Alert: ${alert.title}`,
      attachments: [attachment]
    };
  }

  private async sendSlackMessage(message: SlackMessage): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error('Slack webhook URL not configured');
    }

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Slack webhook error: ${response.status} - ${error}`);
    }

    logger.info('Slack message sent successfully', LogCategory.API, {
      title: message.text,
      attachments: message.attachments.length
    });
  }

  public async sendAlert(alert: SlackAlert): Promise<void> {
    if (!this.isEnabled) {
      logger.warn('Slack service disabled', LogCategory.API);
      return;
    }

    try {
      const message = this.generateSlackMessage(alert);
      await this.sendSlackMessage(message);
    } catch (error) {
      logger.error('Failed to send Slack alert', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error',
        alertTitle: alert.title
      });
    }
  }

  public async sendCriticalAlert(title: string, message: string, context?: Record<string, any>): Promise<void> {
    const alert: SlackAlert = {
      title,
      message,
      severity: 'critical',
      timestamp: new Date().toISOString(),
      context
    };

    await this.sendAlert(alert);
  }

  public async sendHighSeverityAlert(title: string, message: string, context?: Record<string, any>): Promise<void> {
    const alert: SlackAlert = {
      title,
      message,
      severity: 'high',
      timestamp: new Date().toISOString(),
      context
    };

    await this.sendAlert(alert);
  }

  public async testSlackConfiguration(): Promise<boolean> {
    try {
      const testAlert: SlackAlert = {
        title: 'Slack Configuration Test',
        message: 'This is a test message to verify the Slack notification system is working correctly.',
        severity: 'low',
        timestamp: new Date().toISOString(),
        context: {
          test: true,
          service: 'TiltVault Monitoring',
          environment: process.env.NODE_ENV || 'development'
        }
      };

      await this.sendAlert(testAlert);
      return true;
    } catch (error) {
      logger.error('Slack configuration test failed', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  public async sendPaymentFailureAlert(paymentId: string, error: string, context?: Record<string, any>): Promise<void> {
    await this.sendCriticalAlert(
      '💳 Payment Processing Failed',
      `Payment ${paymentId} failed to process: ${error}`,
      {
        paymentId,
        error,
        ...context
      }
    );
  }

  public async sendGMXFailureAlert(tradeId: string, error: string, context?: Record<string, any>): Promise<void> {
    await this.sendCriticalAlert(
      '📈 GMX Trade Failed',
      `GMX trade ${tradeId} failed to execute: ${error}`,
      {
        tradeId,
        error,
        ...context
      }
    );
  }

  public async sendServiceDownAlert(serviceName: string, error: string, context?: Record<string, any>): Promise<void> {
    await this.sendHighSeverityAlert(
      '🔴 Service Unavailable',
      `Service ${serviceName} is down or unresponsive: ${error}`,
      {
        serviceName,
        error,
        ...context
      }
    );
  }

  public async sendHighErrorRateAlert(errorCount: number, timeWindow: string, context?: Record<string, any>): Promise<void> {
    await this.sendHighSeverityAlert(
      '📊 High Error Rate Detected',
      `${errorCount} errors detected in the last ${timeWindow}`,
      {
        errorCount,
        timeWindow,
        ...context
      }
    );
  }

  public async sendMemoryUsageAlert(usagePercent: number, context?: Record<string, any>): Promise<void> {
    const severity = usagePercent > 90 ? 'critical' : 'high';
    await this.sendAlert({
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
