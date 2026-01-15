/**
 * Production Alerting System
 * Sends alerts for critical issues and monitoring events
 */

import { logger, LogCategory } from './logger';
import { errorTracker } from './errorTracker';
import { emailService } from './notifications/emailService';
import { slackService } from './notifications/slackService';
import { Redis } from '@upstash/redis';

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
  cooldownMs: number;
  lastTriggered?: Map<string, number>; // Per-instance cooldown tracking
}

interface SendResult {
  success: boolean;
  error?: string;
  channel?: string;
}

interface AlertStats {
  totalAlerts: number;
  activeAlerts: number;
  alertsBySeverity: Record<string, number>;
  alertsByType: Record<string, number>;
}

export class AlertingSystem {
  private static instance: AlertingSystem;
  private isEnabled: boolean;
  private rules: Map<AlertType, AlertRule> = new Map();
  private maxHistorySize = 1000;
  private webhookUrl?: string;
  private emailRecipients: string[] = [];
  private ruleCheckerInterval?: NodeJS.Timeout;
  
  // Redis-based alert history (persistent across server restarts)
  private readonly ALERT_HISTORY_KEY = 'alerts:history';
  private readonly ALERT_TTL = 30 * 24 * 60 * 60; // 30 days TTL for alert history

  private constructor() {
    // Enable alerting unless explicitly disabled
    this.isEnabled = process.env.ALERTING_ENABLED !== 'false';
    this.webhookUrl = process.env.ALERT_WEBHOOK_URL;
    this.emailRecipients = (process.env.ALERT_EMAIL_RECIPIENTS || '').split(',').filter(Boolean);
    this.setupDefaultRules();
    
    // Start automatic rule checking
    if (this.isEnabled) {
      this.startRuleChecker();
    }
  }

  static getInstance(): AlertingSystem {
    if (!AlertingSystem.instance) {
      AlertingSystem.instance = new AlertingSystem();
    }
    return AlertingSystem.instance;
  }

  // Automatic rule checking every minute
  private startRuleChecker(): void {
    this.ruleCheckerInterval = setInterval(async () => {
      try {
        await this.checkRules();
      } catch (error) {
        logger.error('Rule check failed', LogCategory.API, { 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, 60000); // Check every minute
  }

  // Get Redis client with proper error handling
  private async getRedis(): Promise<Redis> {
    try {
      const url = process.env.KV_REST_API_URL || process.env.REDIS_URL;
      const token = process.env.KV_REST_API_TOKEN;
      
      if (!url || !token) {
        throw new Error('Redis configuration missing for alerting system');
      }
      
      return new Redis({ url, token });
    } catch (error) {
      logger.error('Failed to initialize Redis for alerting', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private setupDefaultRules(): void {
    // High error rate alert
    this.addRule({
      type: AlertType.ERROR_RATE_HIGH,
      severity: AlertSeverity.HIGH,
      condition: async () => {
        const stats = await errorTracker.getErrorStats();
        const totalErrors = stats.totalErrors;
        const criticalErrors = stats.errorsBySeverity.critical || 0;
        
        // Alert if more than 10 errors in last 5 minutes or more than 2 critical errors
        return totalErrors > 10 || criticalErrors > 2;
      },
      message: 'High error rate detected',
      cooldownMs: 5 * 60 * 1000, // 5 minutes
      lastTriggered: new Map()
    });

    // Memory usage alert (fixed to use RSS vs total memory)
    this.addRule({
      type: AlertType.MEMORY_HIGH,
      severity: AlertSeverity.MEDIUM,
      condition: async () => {
        const memUsage = process.memoryUsage();
        const os = await import('os');
        const totalMem = os.totalmem();
        const memoryUsagePercent = (memUsage.rss / totalMem) * 100;
        return memoryUsagePercent > 85;
      },
      message: 'System memory usage is high',
      cooldownMs: 10 * 60 * 1000, // 10 minutes
      lastTriggered: new Map()
    });

    // Payment failure alert
    this.addRule({
      type: AlertType.PAYMENT_FAILURE,
      severity: AlertSeverity.CRITICAL,
      condition: async () => {
        const stats = await errorTracker.getErrorStats();
        const paymentErrors = stats.errorsByCategory.payment || 0;
        return paymentErrors > 0;
      },
      message: 'Payment processing failure detected',
      cooldownMs: 2 * 60 * 1000, // 2 minutes
      lastTriggered: new Map()
    });

    // GMX failure alert
    this.addRule({
      type: AlertType.GMX_FAILURE,
      severity: AlertSeverity.CRITICAL,
      condition: async () => {
        const stats = await errorTracker.getErrorStats();
        const gmxErrors = stats.errorsByCategory.gmx || 0;
        return gmxErrors > 0;
      },
      message: 'GMX integration failure detected',
      cooldownMs: 2 * 60 * 1000, // 2 minutes
      lastTriggered: new Map()
    });
  }

  public addRule(rule: AlertRule): void {
    if (!rule.lastTriggered) {
      rule.lastTriggered = new Map();
    }
    this.rules.set(rule.type, rule);
  }

  public removeRule(type: AlertType): void {
    this.rules.delete(type);
  }

  // Per-instance cooldown checking
  private checkCooldown(type: AlertType, key: string): boolean {
    const rule = this.rules.get(type);
    if (!rule || !rule.lastTriggered) return true;
    
    const cooldownKey = `${type}:${key}`;
    const lastTriggered = rule.lastTriggered.get(cooldownKey);
    const now = Date.now();
    
    if (lastTriggered && now - lastTriggered < rule.cooldownMs) {
      return false;
    }
    
    rule.lastTriggered.set(cooldownKey, now);
    return true;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Optimized alert storage using Redis hash for O(1) lookups
  private async addToHistory(alert: Alert): Promise<void> {
    try {
      const redis = await this.getRedis();
      
      // Store alert in hash for fast lookup (O(1))
      await redis.hset(`alert:${alert.id}`, JSON.stringify(alert));
      await redis.expire(`alert:${alert.id}`, this.ALERT_TTL);
      
      // Add ID to list for chronological ordering
      await redis.lpush(this.ALERT_HISTORY_KEY, alert.id);
      await redis.ltrim(this.ALERT_HISTORY_KEY, 0, this.maxHistorySize - 1);
      await redis.expire(this.ALERT_HISTORY_KEY, this.ALERT_TTL);
      
    } catch (error) {
      logger.error('Failed to store alert in Redis', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error',
        alertId: alert.id
      });
    }
  }

  // Webhook helper with timeout and error handling
  private async sendWebhook(alert: Alert): Promise<SendResult> {
    if (!this.webhookUrl) {
      return { success: false, error: 'Webhook URL not configured', channel: 'webhook' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }

      return { success: true, channel: 'webhook' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage, channel: 'webhook' };
    } finally {
      clearTimeout(timeout);
    }
  }

  // Parallel notification sending with error handling
  private async sendAlert(alert: Alert): Promise<void> {
    if (!this.isEnabled) {
      logger.warn('Alerting disabled', LogCategory.API, { alert });
      return;
    }

    const notifications = [];

    // Generic webhook
    if (this.webhookUrl) {
      notifications.push(
        this.sendWebhook(alert).catch(result => 
          logger.error('Webhook failed', LogCategory.API, { 
            error: result.error,
            channel: result.channel
          })
        )
      );
    }

    // Email notifications
    if (this.emailRecipients.length > 0) {
      notifications.push(
        emailService.sendAlert({
          title: alert.title,
          message: alert.message,
          severity: alert.severity,
          timestamp: alert.timestamp,
          context: alert.context
        }, this.emailRecipients).catch(result => {
          if (!result.success) {
            logger.error('Email alert failed', LogCategory.API, { 
              error: result.error,
              recipients: this.emailRecipients.length
            });
          }
        })
      );
    }

    // Slack notification (always send, even if webhook is Slack to avoid duplication)
    notifications.push(
      slackService.sendAlert({
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        timestamp: alert.timestamp,
        context: alert.context
      }).catch(result => {
        if (!result.success) {
          logger.error('Slack alert failed', LogCategory.API, { 
            error: result.error
          });
        }
      })
    );

    // Send all notifications in parallel
    await Promise.allSettled(notifications);

    // Log the alert
    logger.error(`ALERT: ${alert.title}`, LogCategory.API, {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      context: alert.context
    });
  }

  public async triggerAlert(
  type: AlertType, 
  title: string, 
  message: string, 
  context?: Record<string, any>
): Promise<void> {
    const rule = this.rules.get(type);
    if (!rule) {
      logger.warn(`No rule found for alert type: ${type}`, LogCategory.API);
      return;
    }

    // Create cooldown key from type + relevant context
    const cooldownKey = context?.paymentId || context?.tradeId || context?.serviceName || 'default';
    
    if (!this.checkCooldown(type, cooldownKey)) {
      const lastTriggeredTime = rule.lastTriggered?.get(`${type}:${cooldownKey}`) || 0;
      logger.info('Alert suppressed by cooldown', LogCategory.API, { 
        type, 
        cooldownKey,
        timeSinceLast: Date.now() - lastTriggeredTime
      });
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
      const redis = await this.getRedis();
      
      // Get alert IDs from Redis (newest first)
      const alertIds = await redis.lrange(this.ALERT_HISTORY_KEY, 0, limit - 1) as string[];
      
      // Get alerts from hash storage (parallel for performance)
      const alertPromises = alertIds.map(async (alertId) => {
        try {
          const alertStr = await redis.hget(`alert:${alertId}`);
          return alertStr ? JSON.parse(alertStr) : null;
        } catch {
          return null;
        }
      });
      
      const alerts = await Promise.all(alertPromises);
      return alerts.filter((alert): alert is Alert => alert !== null);
      
    } catch (error) {
      logger.error('Failed to get alert history from Redis', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  public async getActiveAlerts(): Promise<Alert[]> {
    const history = await this.getAlertHistory(this.maxHistorySize);
    return history.filter(alert => !alert.resolved);
  }

  // Optimized alert resolution using Redis hash (O(1) lookup)
  public async resolveAlert(alertId: string): Promise<void> {
    try {
      const redis = await this.getRedis();
      
      // Get alert from hash (O(1) lookup)
      const alertStr = await redis.hget(`alert:${alertId}`);
      if (!alertStr) {
        logger.warn(`Alert not found: ${alertId}`, LogCategory.API, { alertId });
        return;
      }

      const alert: Alert = JSON.parse(alertStr);
      if (!alert.resolved) {
        alert.resolved = true;
        alert.resolvedAt = new Date().toISOString();
        
        // Update in hash
        await redis.hset(`alert:${alertId}`, JSON.stringify(alert));
        logger.info(`Alert resolved: ${alertId}`, LogCategory.API, { alertId });
      }
    } catch (error) {
      logger.error('Failed to resolve alert in Redis', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error',
        alertId
      });
    }
  }

  public async getAlertStats(): Promise<AlertStats> {
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
      logger.error('Failed to get alert stats from Redis', LogCategory.API, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        totalAlerts: 0,
        activeAlerts: 0,
        alertsBySeverity: {},
        alertsByType: {}
      };
    }
  }

  // Cleanup method for graceful shutdown
  public shutdown(): void {
    if (this.ruleCheckerInterval) {
      clearInterval(this.ruleCheckerInterval);
      this.ruleCheckerInterval = undefined;
      logger.info('Alerting system shutdown', LogCategory.API);
    }
  }
}

export const alertingSystem: AlertingSystem = AlertingSystem.getInstance();
