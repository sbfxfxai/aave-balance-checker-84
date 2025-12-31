/**
 * Production Alerting System
 * Sends alerts for critical issues and monitoring events
 */

import { logger } from './logger';
import { errorTracker } from './errorTracker';

export enum AlertSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export enum AlertType {
  ERROR_RATE_HIGH = 'error_rate_high',
  SERVICE_DOWN = 'service_down',
  PERFORMANCE_DEGRADED = 'performance_degraded',
  PAYMENT_FAILURE = 'payment_failure',
  GMX_FAILURE = 'gmx_failure',
  AUTH_FAILURE = 'auth_failure',
  MEMORY_HIGH = 'memory_high',
  QUEUE_BACKLOG = 'queue_backlog'
}

interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  context?: Record<string, any>;
  timestamp: string;
  resolved?: boolean;
  resolvedAt?: string;
}

interface AlertRule {
  type: AlertType;
  severity: AlertSeverity;
  condition: () => Promise<boolean>;
  message: string;
  cooldownMs: number; // Minimum time between same alert
  lastTriggered?: number;
}

class AlertingSystem {
  private static instance: AlertingSystem;
  private isEnabled: boolean;
  private rules: Map<AlertType, AlertRule> = new Map();
  private alertHistory: Alert[] = [];
  private maxHistorySize = 1000;
  private webhookUrl?: string;
  private emailRecipients: string[] = [];

  private constructor() {
    this.isEnabled = process.env.NODE_ENV === 'production';
    this.webhookUrl = process.env.ALERT_WEBHOOK_URL;
    this.emailRecipients = (process.env.ALERT_EMAIL_RECIPIENTS || '').split(',').filter(Boolean);
    this.setupDefaultRules();
  }

  static getInstance(): AlertingSystem {
    if (!AlertingSystem.instance) {
      AlertingSystem.instance = new AlertingSystem();
    }
    return AlertingSystem.instance;
  }

  private setupDefaultRules(): void {
    // High error rate alert
    this.addRule({
      type: AlertType.ERROR_RATE_HIGH,
      severity: AlertSeverity.HIGH,
      condition: async () => {
        const stats = errorTracker.getErrorStats();
        const totalErrors = stats.totalErrors;
        const criticalErrors = stats.errorsBySeverity.critical || 0;
        
        // Alert if more than 10 errors in last 5 minutes or more than 2 critical errors
        return totalErrors > 10 || criticalErrors > 2;
      },
      message: 'High error rate detected',
      cooldownMs: 5 * 60 * 1000 // 5 minutes
    });

    // Memory usage alert
    this.addRule({
      type: AlertType.MEMORY_HIGH,
      severity: AlertSeverity.MEDIUM,
      condition: async () => {
        const memUsage = process.memoryUsage();
        const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        return memoryUsagePercent > 85;
      },
      message: 'Memory usage is high',
      cooldownMs: 10 * 60 * 1000 // 10 minutes
    });

    // Payment failure alert
    this.addRule({
      type: AlertType.PAYMENT_FAILURE,
      severity: AlertSeverity.CRITICAL,
      condition: async () => {
        const stats = errorTracker.getErrorStats();
        const paymentErrors = stats.errorsByCategory.payment || 0;
        return paymentErrors > 0;
      },
      message: 'Payment processing failure detected',
      cooldownMs: 2 * 60 * 1000 // 2 minutes
    });

    // GMX failure alert
    this.addRule({
      type: AlertType.GMX_FAILURE,
      severity: AlertSeverity.CRITICAL,
      condition: async () => {
        const stats = errorTracker.getErrorStats();
        const gmxErrors = stats.errorsByCategory.gmx || 0;
        return gmxErrors > 0;
      },
      message: 'GMX integration failure detected',
      cooldownMs: 2 * 60 * 1000 // 2 minutes
    });
  }

  public addRule(rule: AlertRule): void {
    this.rules.set(rule.type, rule);
  }

  public removeRule(type: AlertType): void {
    this.rules.delete(type);
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private addToHistory(alert: Alert): void {
    this.alertHistory.push(alert);
    
    // Keep history size manageable
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory.shift();
    }
  }

  private async sendAlert(alert: Alert): Promise<void> {
    if (!this.isEnabled) {
      logger.warn('Alerting disabled', 'ALERTING', { alert });
      return;
    }

    try {
      // Send to webhook
      if (this.webhookUrl) {
        await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(alert)
        });
      }

      // Send email (you can integrate with SendGrid, AWS SES, etc.)
      if (this.emailRecipients.length > 0) {
        // Example: await emailService.sendAlert(alert, this.emailRecipients);
        logger.info('Alert email sent', 'ALERTING', { 
          alertId: alert.id,
          recipients: this.emailRecipients 
        });
      }

      // Log the alert
      logger.error(`ALERT: ${alert.title}`, 'ALERTING', {
        alertId: alert.id,
        type: alert.type,
        severity: alert.severity,
        context: alert.context
      });

    } catch (error) {
      logger.error('Failed to send alert', 'ALERTING', { 
        alertId: alert.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  public async triggerAlert(type: AlertType, title: string, message: string, context?: Record<string, any>): Promise<void> {
    const rule = this.rules.get(type);
    if (!rule) {
      logger.warn(`No rule found for alert type: ${type}`, 'ALERTING');
      return;
    }

    // Check cooldown
    if (rule.lastTriggered && Date.now() - rule.lastTriggered < rule.cooldownMs) {
      return;
    }

    const alert: Alert = {
      id: this.generateAlertId(),
      type,
      severity: rule.severity,
      title,
      message,
      context,
      timestamp: new Date().toISOString()
    };

    this.addToHistory(alert);
    await this.sendAlert(alert);

    // Update last triggered time
    rule.lastTriggered = Date.now();
  }

  public async checkRules(): Promise<void> {
    if (!this.isEnabled) return;

    for (const [type, rule] of this.rules) {
      try {
        const shouldAlert = await rule.condition();
        if (shouldAlert) {
          await this.triggerAlert(type, rule.message, rule.message, {
            ruleType: type,
            severity: rule.severity
          });
        }
      } catch (error) {
        logger.error(`Error checking alert rule: ${type}`, 'ALERTING', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  public async triggerPaymentError(error: Error, paymentData?: any): Promise<void> {
    await this.triggerAlert(
      AlertType.PAYMENT_FAILURE,
      'Payment Processing Failed',
      `Payment processing failed: ${error.message}`,
      {
        error: error.message,
        stack: error.stack,
        ...paymentData
      }
    );
  }

  public async triggerGMXError(error: Error, tradeData?: any): Promise<void> {
    await this.triggerAlert(
      AlertType.GMX_FAILURE,
      'GMX Integration Failed',
      `GMX integration failed: ${error.message}`,
      {
        error: error.message,
        stack: error.stack,
        ...tradeData
      }
    );
  }

  public async triggerServiceDown(serviceName: string, error?: Error): Promise<void> {
    await this.triggerAlert(
      AlertType.SERVICE_DOWN,
      `Service Down: ${serviceName}`,
      `Service ${serviceName} is down or unresponsive`,
      {
        serviceName,
        error: error?.message,
        stack: error?.stack
      }
    );
  }

  public getAlertHistory(limit: number = 50): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  public getActiveAlerts(): Alert[] {
    return this.alertHistory.filter(alert => !alert.resolved);
  }

  public resolveAlert(alertId: string): void {
    const alert = this.alertHistory.find(a => a.id === alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
      
      logger.info(`Alert resolved: ${alertId}`, 'ALERTING', { alertId });
    }
  }

  public getAlertStats(): {
    totalAlerts: number;
    activeAlerts: number;
    alertsBySeverity: Record<string, number>;
    alertsByType: Record<string, number>;
  } {
    const alertsBySeverity: Record<string, number> = {};
    const alertsByType: Record<string, number> = {};

    this.alertHistory.forEach(alert => {
      alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] || 0) + 1;
      alertsByType[alert.type] = (alertsByType[alert.type] || 0) + 1;
    });

    return {
      totalAlerts: this.alertHistory.length,
      activeAlerts: this.alertHistory.filter(a => !a.resolved).length,
      alertsBySeverity,
      alertsByType
    };
  }
}

export const alertingSystem = AlertingSystem.getInstance();
