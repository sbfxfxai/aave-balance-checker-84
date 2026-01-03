/**
 * Production Alerting System
 * Sends alerts for critical issues and monitoring events
 */

import { logger, LogCategory } from './logger';
import { errorTracker } from './errorTracker';
import { emailService } from './notifications/emailService';
import { slackService } from './notifications/slackService';

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
  private maxHistorySize = 1000;
  private webhookUrl?: string;
  private emailRecipients: string[] = [];
  
  // Redis-based alert history (persistent across server restarts)
  private readonly ALERT_HISTORY_KEY = 'alerts:history';
  private readonly ALERT_TTL = 30 * 24 * 60 * 60; // 30 days TTL for alert history

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

  private async addToHistory(alert: Alert): Promise<void> {
    try {
      const { getRedis } = await import('./redis.js');
      const redis = getRedis();
      
      // Add alert to Redis list (prepend for newest first)
      await redis.lpush(this.ALERT_HISTORY_KEY, JSON.stringify(alert));
      
      // Trim list to maxHistorySize
      await redis.ltrim(this.ALERT_HISTORY_KEY, 0, this.maxHistorySize - 1);
      
      // Set TTL on the list (refresh on each add)
      await redis.expire(this.ALERT_HISTORY_KEY, this.ALERT_TTL);
    } catch (error) {
      // Log error but don't fail alert processing
      console.error('[Alerting] Failed to store alert in Redis:', error);
    }
  }

  private async sendAlert(alert: Alert): Promise<void> {
    if (!this.isEnabled) {
      logger.warn('Alerting disabled', LogCategory.API, { alert });
      return;
    }

    try {
      // Send to webhook (if configured)
      if (this.webhookUrl) {
        await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(alert)
        });
      }

      // Send email notifications
      if (this.emailRecipients.length > 0) {
        await emailService.sendAlert({
          title: alert.title,
          message: alert.message,
          severity: alert.severity,
          timestamp: alert.timestamp,
          context: alert.context
        }, this.emailRecipients);
      }

      // Send Slack notification
      if (this.webhookUrl && this.webhookUrl.includes('hooks.slack.com')) {
        await slackService.sendAlert({
          title: alert.title,
          message: alert.message,
          severity: alert.severity,
          timestamp: alert.timestamp,
          context: alert.context
        });
      }

      // Log the alert
      logger.error(`ALERT: ${alert.title}`, LogCategory.API, {
        alertId: alert.id,
        type: alert.type,
        severity: alert.severity,
        context: alert.context
      });

    } catch (error) {
      logger.error('Failed to send alert', LogCategory.API, { 
        alertId: alert.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  public async triggerAlert(type: AlertType, title: string, message: string, context?: Record<string, any>): Promise<void> {
    const rule = this.rules.get(type);
    if (!rule) {
      logger.warn(`No rule found for alert type: ${type}`, LogCategory.API);
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

    await this.addToHistory(alert);
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
        logger.error(`Error checking alert rule: ${type}`, LogCategory.API, {
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

  public async getAlertHistory(limit: number = 50): Promise<Alert[]> {
    try {
      const { getRedis } = await import('./redis.js');
      const redis = getRedis();
      
      // Get alerts from Redis (newest first)
      const alerts = await redis.lrange(this.ALERT_HISTORY_KEY, 0, limit - 1);
      
      return alerts
        .map((alertStr: string) => {
          try {
            return typeof alertStr === 'string' ? JSON.parse(alertStr) : alertStr;
          } catch {
            return null;
          }
        })
        .filter((alert): alert is Alert => alert !== null);
    } catch (error) {
      console.error('[Alerting] Failed to get alert history from Redis:', error);
      return [];
    }
  }

  public async getActiveAlerts(): Promise<Alert[]> {
    const history = await this.getAlertHistory(this.maxHistorySize);
    return history.filter(alert => !alert.resolved);
  }

  public async resolveAlert(alertId: string): Promise<void> {
    try {
      const { getRedis } = await import('./redis.js');
      const redis = getRedis();
      
      // Get all alerts
      const alerts = await redis.lrange(this.ALERT_HISTORY_KEY, 0, -1);
      
      // Find and update the alert
      for (let i = 0; i < alerts.length; i++) {
        const alertStr = alerts[i];
        try {
          const alert: Alert = typeof alertStr === 'string' ? JSON.parse(alertStr) : alertStr;
          if (alert.id === alertId && !alert.resolved) {
            alert.resolved = true;
            alert.resolvedAt = new Date().toISOString();
            
            // Update in Redis
            await redis.lset(this.ALERT_HISTORY_KEY, i, JSON.stringify(alert));
            
            logger.info(`Alert resolved: ${alertId}`, LogCategory.API, { alertId });
            return;
          }
        } catch {
          // Skip invalid alerts
          continue;
        }
      }
      
      logger.warn(`Alert not found: ${alertId}`, LogCategory.API, { alertId });
    } catch (error) {
      console.error('[Alerting] Failed to resolve alert in Redis:', error);
    }
  }

  public async getAlertStats(): Promise<{
    totalAlerts: number;
    activeAlerts: number;
    alertsBySeverity: Record<string, number>;
    alertsByType: Record<string, number>;
  }> {
    try {
      const history = await this.getAlertHistory(this.maxHistorySize);
      const alertsBySeverity: Record<string, number> = {};
      const alertsByType: Record<string, number> = {};

      history.forEach(alert => {
        alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] || 0) + 1;
        alertsByType[alert.type] = (alertsByType[alert.type] || 0) + 1;
      });

      return {
        totalAlerts: history.length,
        activeAlerts: history.filter(a => !a.resolved).length,
        alertsBySeverity,
        alertsByType
      };
    } catch (error) {
      console.error('[Alerting] Failed to get alert stats from Redis:', error);
      return {
        totalAlerts: 0,
        activeAlerts: 0,
        alertsBySeverity: {},
        alertsByType: {}
      };
    }
  }
}

export const alertingSystem = AlertingSystem.getInstance();
