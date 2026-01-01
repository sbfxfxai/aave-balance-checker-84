/**
 * Email notification utilities
 */

export interface EmailConfig {
  provider: 'mailgun' | 'sendgrid' | 'ses';
  apiKey: string;
  domain?: string;
  fromEmail: string;
  fromName: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  template?: string;
  templateData?: Record<string, any>;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType: string;
  }>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: string;
}

class EmailNotifier {
  private config: EmailConfig;

  constructor(config: EmailConfig) {
    this.config = config;
  }

  /**
   * Send email
   */
  async sendEmail(message: EmailMessage): Promise<EmailResult> {
    try {
      switch (this.config.provider) {
        case 'mailgun':
          return await this.sendMailgun(message);
        case 'sendgrid':
          return await this.sendSendGrid(message);
        case 'ses':
          return await this.sendSES(message);
        default:
          throw new Error(`Unsupported email provider: ${this.config.provider}`);
      }
    } catch (error) {
      console.error('[Email] Send error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: this.config.provider
      };
    }
  }

  /**
   * Send via Mailgun
   */
  private async sendMailgun(message: EmailMessage): Promise<EmailResult> {
    if (!this.config.domain) {
      throw new Error('Mailgun domain is required');
    }

    const formData = new FormData();
    formData.append('from', `${this.config.fromName} <${this.config.fromEmail}>`);
    
    if (Array.isArray(message.to)) {
      message.to.forEach(email => formData.append('to', email));
    } else {
      formData.append('to', message.to);
    }
    
    formData.append('subject', message.subject);
    
    if (message.text) formData.append('text', message.text);
    if (message.html) formData.append('html', message.html);

    const response = await fetch(`https://api.mailgun.net/v3/${this.config.domain}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`api:${this.config.apiKey}`).toString('base64')}`
      },
      body: formData
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mailgun API error: ${error}`);
    }

    const result = await response.json();
    return {
      success: true,
      messageId: result.id,
      provider: 'mailgun'
    };
  }

  /**
   * Send via SendGrid
   */
  private async sendSendGrid(message: EmailMessage): Promise<EmailResult> {
    const payload = {
      personalizations: [{
        to: Array.isArray(message.to) 
          ? message.to.map(email => ({ email }))
          : [{ email: message.to }]
      }],
      from: { email: this.config.fromEmail, name: this.config.fromName },
      subject: message.subject,
      content: [
        ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
        ...(message.html ? [{ type: 'text/html', value: message.html }] : [])
      ]
    };

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`SendGrid API error: ${error}`);
    }

    const messageId = response.headers.get('X-Message-Id');
    return {
      success: true,
      messageId: messageId || undefined,
      provider: 'sendgrid'
    };
  }

  /**
   * Send via AWS SES
   */
  private async sendSES(message: EmailMessage): Promise<EmailResult> {
    // Mock SES implementation - would require AWS SDK in production
    console.log('[Email] SES send (mock):', {
      to: message.to,
      subject: message.subject,
      provider: 'ses'
    });

    return {
      success: true,
      messageId: `ses_${Date.now()}`,
      provider: 'ses'
    };
  }
}

// Default email notifier instance
export const emailNotifier = new EmailNotifier({
  provider: (process.env.EMAIL_PROVIDER as any) || 'mailgun',
  apiKey: process.env.EMAIL_API_KEY || '',
  domain: process.env.EMAIL_DOMAIN,
  fromEmail: process.env.EMAIL_FROM || 'noreply@tiltvault.com',
  fromName: process.env.EMAIL_FROM_NAME || 'TiltVault'
});

// Convenience functions
export const email = {
  send: (message: EmailMessage) => emailNotifier.sendEmail(message),
  
  // Common email templates
  welcome: (to: string, userName: string) => emailNotifier.sendEmail({
    to,
    subject: 'Welcome to TiltVault!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Welcome to TiltVault, ${userName}!</h1>
        <p>Thank you for joining our secure banking and investment platform.</p>
        <p>Your account is now ready to use. You can:</p>
        <ul>
          <li>Connect your wallet</li>
          <li>Start trading</li>
          <li>Monitor your portfolio</li>
        </ul>
        <p>If you have any questions, please don't hesitate to contact our support team.</p>
        <p>Best regards,<br>The TiltVault Team</p>
      </div>
    `
  }),

  verificationCode: (to: string, code: string) => emailNotifier.sendEmail({
    to,
    subject: 'Your TiltVault Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Your Verification Code</h2>
        <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 5px; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px;">${code}</span>
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
      </div>
    `
  }),

  passwordReset: (to: string, resetLink: string) => emailNotifier.sendEmail({
    to,
    subject: 'Reset Your TiltVault Password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Reset Your Password</h2>
        <p>Click the link below to reset your password:</p>
        <div style="margin: 30px 0;">
          <a href="${resetLink}" style="background: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
        </div>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this reset, please ignore this email.</p>
      </div>
    `
  }),

  transactionAlert: (to: string, transaction: any) => emailNotifier.sendEmail({
    to,
    subject: `Transaction Alert: ${transaction.type}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Transaction Alert</h2>
        <p>A transaction has occurred on your account:</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p><strong>Type:</strong> ${transaction.type}</p>
          <p><strong>Amount:</strong> ${transaction.amount}</p>
          <p><strong>Status:</strong> ${transaction.status}</p>
          <p><strong>Time:</strong> ${new Date(transaction.timestamp).toLocaleString()}</p>
        </div>
        <p>If you don't recognize this transaction, please contact support immediately.</p>
      </div>
    `
  })
};
