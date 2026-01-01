/**
 * Alerting utilities for system monitoring and notifications
 */

export interface Alert {
  id: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  source: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface AlertConfig {
  enabled: boolean;
  webhookUrl?: string;
  emailRecipients?: string[];
  slackChannel?: string;
  thresholds: {
    errorRate: number;
    responseTime: number;
    memoryUsage: number;
  };
}

class AlertManager {
  private config: AlertConfig;
  private alerts: Alert[] = [];

  constructor(config: AlertConfig) {
    this.config = config;
  }

  /**
   * Send an alert
   */
  async sendAlert(alert: Omit<Alert, 'id' | 'timestamp'>): Promise<void> {
    if (!this.config.enabled) return;

    const fullAlert: Alert = {
      ...alert,
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date()
    };

    this.alerts.push(fullAlert);
    console.log(`[Alert] ${alert.level.toUpperCase()}: ${alert.message}`, alert.metadata);

    // Send to configured destinations
    await Promise.all([
      this.sendToWebhook(fullAlert),
      this.sendToEmail(fullAlert),
      this.sendToSlack(fullAlert)
    ]);
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 50): Alert[] {
    return this.alerts
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Clear old alerts
   */
  clearOldAlerts(olderThanHours: number = 24): void {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    this.alerts = this.alerts.filter(alert => alert.timestamp > cutoff);
  }

  private async sendToWebhook(alert: Alert): Promise<void> {
    if (!this.config.webhookUrl) return;

    try {
      await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert)
      });
    } catch (error) {
      console.error('[Alert] Failed to send webhook:', error);
    }
  }

  private async sendToEmail(alert: Alert): Promise<void> {
    if (!this.config.emailRecipients?.length) return;
    // TODO: Implement email sending
    console.log(`[Alert] Email alert would be sent to: ${this.config.emailRecipients.join(', ')}`);
  }

  private async sendToSlack(alert: Alert): Promise<void> {
    if (!this.config.slackChannel) return;
    // TODO: Implement Slack integration
    console.log(`[Alert] Slack alert would be sent to: ${this.config.slackChannel}`);
  }
}

// Default alert manager instance
export const alertManager = new AlertManager({
  enabled: process.env.NODE_ENV === 'production',
  thresholds: {
    errorRate: 0.05, // 5%
    responseTime: 2000, // 2 seconds
    memoryUsage: 0.8 // 80%
  }
});

// Convenience functions
export const alert = {
  info: (message: string, source: string, metadata?: Record<string, any>) =>
    alertManager.sendAlert({ level: 'info', message, source, metadata }),
  
  warning: (message: string, source: string, metadata?: Record<string, any>) =>
    alertManager.sendAlert({ level: 'warning', message, source, metadata }),
  
  error: (message: string, source: string, metadata?: Record<string, any>) =>
    alertManager.sendAlert({ level: 'error', message, source, metadata }),
  
  critical: (message: string, source: string, metadata?: Record<string, any>) =>
    alertManager.sendAlert({ level: 'critical', message, source, metadata })
};
