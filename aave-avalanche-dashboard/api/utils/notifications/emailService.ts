/**
 * Email Notification Service
 * Sends email alerts for critical system issues
 */

import { logger, LogCategory } from '../logger';

type AlertSeverity = 'critical' | 'high' | 'medium' | 'low';

interface EmailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
}

interface EmailAlert {
  title: string;
  message: string;
  severity: AlertSeverity;
  timestamp: string;
  context?: Record<string, any>;
}

interface SendResult {
  success: boolean;
  error?: string;
  delivered?: number;
  failed?: string[];
}

class EmailService {
  private static instance: EmailService;
  private isEnabled: boolean;
  private apiKey?: string;
  private fromEmail?: string;
  private dashboardUrl?: string;
  private emailProvider?: 'sendgrid' | 'aws-ses' | 'smtp';
  private emailRateLimit = new Map<string, number[]>();

  private constructor() {
    this.isEnabled = !!process.env.EMAIL_SERVICE_API_KEY;
    this.apiKey = process.env.EMAIL_SERVICE_API_KEY;
    this.fromEmail = process.env.FROM_EMAIL || 'alerts@tiltvault.com';
    this.dashboardUrl = process.env.MONITORING_DASHBOARD_URL || 'https://tiltvault.com/monitoring';
    
    // Explicit provider detection
    this.emailProvider = (process.env.EMAIL_PROVIDER as any) || 
      (this.apiKey?.startsWith('SG.') ? 'sendgrid' : undefined);
  }

  static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  // Security: HTML escaping to prevent XSS
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Validate email format
  private validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Rate limiting to prevent email bombing
  private checkRateLimit(recipient: string): boolean {
    const now = Date.now();
    const window = 60 * 60 * 1000; // 1 hour
    const maxEmails = 10; // Max 10 emails per hour per recipient
    
    const recentEmails = (this.emailRateLimit.get(recipient) || [])
      .filter(time => time > now - window);
    
    if (recentEmails.length >= maxEmails) {
      return false;
    }
    
    recentEmails.push(now);
    this.emailRateLimit.set(recipient, recentEmails);
    return true;
  }

  // Format context values safely
  private formatContextValue(value: any): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    
    if (typeof value === 'object') {
      try {
        const json = JSON.stringify(value, null, 2);
        // Truncate large objects
        return json.length > 500 ? json.substring(0, 500) + '...' : json;
      } catch {
        return '[Object]';
      }
    }
    
    return String(value);
  }

  private generateAlertEmail(alert: EmailAlert): EmailMessage {
    const severityColors = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#28a745'
    };

    const color = severityColors[alert.severity as keyof typeof severityColors] || '#6c757d';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>TiltVault Alert: ${this.escapeHtml(alert.title)}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background-color: #f8f9fa; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
          .header p { margin: 10px 0 0 0; opacity: 0.9; }
          .content { padding: 30px; }
          .alert-box { border-left: 4px solid ${color}; background: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 4px; }
          .alert-title { font-size: 18px; font-weight: 600; margin: 0 0 10px 0; color: #333; }
          .alert-message { color: #666; line-height: 1.5; margin: 0 0 15px 0; }
          .alert-meta { font-size: 12px; color: #999; }
          .severity { display: inline-block; padding: 4px 8px; background: ${color}; color: white; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
          .context { margin-top: 20px; }
          .context-item { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
          .context-item:last-child { border-bottom: none; }
          .context-label { font-weight: 600; color: #333; }
          .context-value { color: #666; font-family: monospace; word-break: break-all; }
          .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 14px; }
          .footer a { color: #667eea; text-decoration: none; }
          .timestamp { color: #999; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🚨 TiltVault Alert</h1>
            <p>Critical system notification requiring attention</p>
          </div>
          
          <div class="content">
            <div class="alert-box">
              <div class="alert-title">${this.escapeHtml(alert.title)}</div>
              <div class="alert-message">${this.escapeHtml(alert.message)}</div>
              <div class="alert-meta">
                <span class="severity">${this.escapeHtml(alert.severity)}</span>
                <span class="timestamp">${new Date(alert.timestamp).toLocaleString()}</span>
              </div>
            </div>

            ${alert.context ? `
            <div class="context">
              <h3 style="margin: 0 0 15px 0; color: #333; font-size: 16px;">Context Information</h3>
              ${Object.entries(alert.context).map(([key, value]) => `
                <div class="context-item">
                  <span class="context-label">${this.escapeHtml(key)}:</span>
                  <span class="context-value">${this.formatContextValue(value)}</span>
                </div>
              `).join('')}
            </div>
            ` : ''}
          </div>

          <div class="footer">
            <p>This alert was generated by the TiltVault monitoring system.</p>
            <p>For immediate assistance, contact the engineering team.</p>
            <p><a href="${this.escapeHtml(this.dashboardUrl || 'https://tiltvault.com/monitoring')}">View Monitoring Dashboard</a></p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
TiltVault Alert: ${alert.title}

Severity: ${alert.severity.toUpperCase()}
Time: ${new Date(alert.timestamp).toLocaleString()}

${alert.message}

${alert.context ? '\nContext Information:\n' + Object.entries(alert.context).map(([key, value]) => `${key}: ${this.formatContextValue(value)}`).join('\n') : ''}

---
This alert was generated by the TiltVault monitoring system.
For immediate assistance, contact the engineering team.
Monitoring Dashboard: ${this.dashboardUrl}
    `;

    return {
      to: [], // Will be set by caller
      subject: `🚨 TiltVault Alert: ${alert.title}`,
      html,
      text
    };
  }

  // Retry logic with exponential backoff
  private async sendWithRetry(
    email: EmailMessage, 
    maxRetries = 3
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.sendViaSendGrid(email);
        return;
      } catch (error) {
        if (attempt === maxRetries) throw error;
        
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10s
        logger.warn(`Email send attempt ${attempt} failed, retrying in ${delay}ms`, LogCategory.API, {
          error: error instanceof Error ? error.message : 'Unknown',
          attempt,
          maxRetries
        });
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private async sendViaSendGrid(email: EmailMessage): Promise<void> {
    if (!this.apiKey) {
      throw new Error('SendGrid API key not configured');
    }

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{
          to: email.to.map(email => ({ email })),
          subject: email.subject
        }],
        from: { email: this.fromEmail },
        content: [
          { type: 'text/plain', value: email.text },
          { type: 'text/html', value: email.html }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SendGrid API error: ${response.status} - ${error}`);
    }

    logger.info('Email sent via SendGrid', LogCategory.API, {
      recipients: email.to,
      subject: email.subject
    });
  }

  private async sendViaAWSSES(email: EmailMessage): Promise<void> {
    // AWS SES implementation would require AWS SDK
    // For now, throw error to indicate not implemented
    throw new Error('AWS SES not implemented - please install AWS SDK and configure credentials');
  }

  private async sendViaSMTP(email: EmailMessage): Promise<void> {
    // SMTP implementation would require nodemailer or similar
    // For now, throw error to indicate not implemented
    throw new Error('SMTP not implemented - please install nodemailer and configure SMTP settings');
  }

  public async sendAlert(alert: EmailAlert, recipients: string[]): Promise<SendResult> {
    if (!this.isEnabled) {
      return { success: false, error: 'Email service disabled' };
    }

    // Validate all recipients
    const validRecipients = recipients.filter(this.validateEmail);
    if (validRecipients.length === 0) {
      return { success: false, error: 'No valid email recipients' };
    }

    // Check rate limits
    const rateLimitedRecipients: string[] = [];
    const allowedRecipients: string[] = [];
    
    for (const recipient of validRecipients) {
      if (!this.checkRateLimit(recipient)) {
        rateLimitedRecipients.push(recipient);
      } else {
        allowedRecipients.push(recipient);
      }
    }

    if (allowedRecipients.length === 0) {
      return { 
        success: false, 
        error: 'All recipients rate limited',
        failed: rateLimitedRecipients
      };
    }

    try {
      const email = this.generateAlertEmail(alert);
      email.to = allowedRecipients;

      // Send with retry logic
      if (this.emailProvider === 'sendgrid') {
        await this.sendWithRetry(email);
      } else if (this.emailProvider === 'aws-ses') {
        await this.sendViaAWSSES(email);
      } else if (this.emailProvider === 'smtp') {
        await this.sendViaSMTP(email);
      } else {
        throw new Error('No email provider configured');
      }

      const result: SendResult = {
        success: true,
        delivered: allowedRecipients.length
      };

      if (rateLimitedRecipients.length > 0) {
        result.failed = rateLimitedRecipients;
        logger.warn('Some recipients rate limited', LogCategory.API, {
          rateLimited: rateLimitedRecipients,
          delivered: allowedRecipients.length
        });
      }

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Failed to send email alert', LogCategory.API, {
        error: errorMessage,
        alertTitle: alert.title,
        recipients: allowedRecipients,
        rateLimited: rateLimitedRecipients
      });

      return { 
        success: false, 
        error: errorMessage,
        failed: [...rateLimitedRecipients, ...allowedRecipients]
      };
    }
  }

  public async testEmailConfiguration(recipients: string[]): Promise<SendResult> {
    try {
      const testAlert: EmailAlert = {
        title: 'Email Configuration Test',
        message: 'This is a test email to verify the email notification system is working correctly.',
        severity: 'low',
        timestamp: new Date().toISOString(),
        context: {
          test: true,
          service: 'TiltVault Monitoring',
          environment: process.env.NODE_ENV || 'development',
          provider: this.emailProvider || 'none'
        }
      };

      const result = await this.sendAlert(testAlert, recipients);
      
      if (result.success) {
        logger.info('Email configuration test successful', LogCategory.API, {
          delivered: result.delivered,
          failed: result.failed
        });
      } else {
        logger.error('Email configuration test failed', LogCategory.API, {
          error: result.error,
          failed: result.failed
        });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Email configuration test failed', LogCategory.API, {
        error: errorMessage
      });
      
      return { success: false, error: errorMessage, failed: recipients };
    }
  }
}

export const emailService = EmailService.getInstance();
