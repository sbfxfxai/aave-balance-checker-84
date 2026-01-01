import type { VercelRequest, VercelResponse } from '@vercel/node';
import formData from 'form-data';
import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || '',
});

/**
 * POST /api/wallet/send-email
 * Sends transaction and wallet-related emails
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, to, data } = req.body;

    if (!type || !to || !data) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['type', 'to', 'data']
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    let emailData: any = {};

    switch (type) {
      case 'wallet_created':
        emailData = {
          subject: 'Your TiltVault Wallet Has Been Created',
          html: createWalletCreatedEmail(data),
          text: createWalletCreatedTextEmail(data)
        };
        break;

      case 'transaction_confirmation':
        emailData = {
          subject: 'Transaction Confirmation - TiltVault',
          html: createTransactionEmail(data),
          text: createTransactionTextEmail(data)
        };
        break;

      case 'security_alert':
        emailData = {
          subject: 'Security Alert - TiltVault',
          html: createSecurityAlertEmail(data),
          text: createSecurityAlertTextEmail(data)
        };
        break;

      case 'password_reset':
        emailData = {
          subject: 'Reset Your TiltVault Password',
          html: createPasswordResetEmail(data),
          text: createPasswordResetTextEmail(data)
        };
        break;

      default:
        return res.status(400).json({ 
          error: 'Invalid email type',
          available: ['wallet_created', 'transaction_confirmation', 'security_alert', 'password_reset']
        });
    }

    // Send email
    const messageData = {
      from: `TiltVault <noreply@${process.env.MAILGUN_DOMAIN}>`,
      to: to.toLowerCase().trim(),
      ...emailData
    };

    if (!process.env.MAILGUN_DOMAIN) {
      throw new Error('MAILGUN_DOMAIN environment variable is not set');
    }

    const response = await mg.messages.create(process.env.MAILGUN_DOMAIN, messageData);
    console.log(`[Wallet Email] Sent ${type} email to ${to}`, { messageId: response.id });

    return res.status(200).json({
      success: true,
      messageId: response.id,
      type,
      to
    });

  } catch (error) {
    console.error('[Wallet Email] Error:', error);
    return res.status(500).json({ 
      error: 'Failed to send email',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function createWalletCreatedEmail(data: any): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 32px;">TiltVault</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Secure Banking & Investments</p>
      </div>
      
      <div style="background: #f8f9fa; padding: 40px; border-radius: 0 0 10px 10px;">
        <h2 style="color: #333; margin: 0 0 20px 0;">Your Wallet Has Been Created!</h2>
        
        <p style="color: #666; margin: 0 0 20px 0;">
          Congratulations! Your TiltVault wallet has been successfully created and secured.
        </p>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin: 0 0 15px 0;">Wallet Details:</h3>
          <p style="margin: 5px 0;"><strong>Address:</strong> ${data.walletAddress}</p>
          <p style="margin: 5px 0;"><strong>Created:</strong> ${new Date(data.createdAt).toLocaleString()}</p>
        </div>
        
        <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #2d5a2d;">
            <strong>Important:</strong> Your private keys are encrypted and stored securely. 
            Never share your private keys or recovery phrase with anyone.
          </p>
        </div>
        
        <p style="color: #666; margin: 30px 0 0 0;">
          You can now start using your wallet for secure transactions and investments.
        </p>
      </div>
    </div>
  `;
}

function createTransactionEmail(data: any): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 32px;">TiltVault</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Transaction Confirmation</p>
      </div>
      
      <div style="background: #f8f9fa; padding: 40px; border-radius: 0 0 10px 10px;">
        <h2 style="color: #333; margin: 0 0 20px 0;">Transaction Confirmed</h2>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin: 0 0 15px 0;">Transaction Details:</h3>
          <p style="margin: 5px 0;"><strong>Type:</strong> ${data.type}</p>
          <p style="margin: 5px 0;"><strong>Amount:</strong> ${data.amount} ${data.currency}</p>
          <p style="margin: 5px 0;"><strong>Status:</strong> <span style="color: #28a745;">${data.status}</span></p>
          <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${data.transactionId}</p>
          <p style="margin: 5px 0;"><strong>Time:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
        </div>
        
        <p style="color: #666; margin: 30px 0 0 0;">
          Your transaction has been processed and confirmed on the blockchain.
        </p>
      </div>
    </div>
  `;
}

function createSecurityAlertEmail(data: any): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #dc3545 0%, #c82333 100%); padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 32px;">TiltVault</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Security Alert</p>
      </div>
      
      <div style="background: #f8f9fa; padding: 40px; border-radius: 0 0 10px 10px;">
        <h2 style="color: #333; margin: 0 0 20px 0;">Security Activity Detected</h2>
        
        <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
          <p style="margin: 0; color: #856404;">
            <strong>Alert:</strong> ${data.alertType}
          </p>
        </div>
        
        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin: 0 0 15px 0;">Activity Details:</h3>
          <p style="margin: 5px 0;"><strong>Action:</strong> ${data.action}</p>
          <p style="margin: 5px 0;"><strong>IP Address:</strong> ${data.ipAddress}</p>
          <p style="margin: 5px 0;"><strong>Time:</strong> ${new Date(data.timestamp).toLocaleString()}</p>
          <p style="margin: 5px 0;"><strong>Location:</strong> ${data.location || 'Unknown'}</p>
        </div>
        
        <div style="background: #d1ecf1; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #0c5460;">
            If this was you, no action is needed. If you don't recognize this activity, 
            please secure your account immediately.
          </p>
        </div>
      </div>
    </div>
  `;
}

function createPasswordResetEmail(data: any): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 32px;">TiltVault</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Password Reset</p>
      </div>
      
      <div style="background: #f8f9fa; padding: 40px; border-radius: 0 0 10px 10px;">
        <h2 style="color: #333; margin: 0 0 20px 0;">Reset Your Password</h2>
        
        <p style="color: #666; margin: 0 0 30px 0;">
          Click the button below to reset your password. This link will expire in 1 hour.
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${data.resetLink}" style="background: #007bff; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Reset Password</a>
        </div>
        
        <div style="background: #f8d7da; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #721c24;">
            If you didn't request this password reset, please ignore this email and ensure your account is secure.
          </p>
        </div>
      </div>
    </div>
  `;
}

// Text versions for email clients that don't support HTML
function createWalletCreatedTextEmail(data: any): string {
  return `
Your TiltVault Wallet Has Been Created!

Wallet Details:
- Address: ${data.walletAddress}
- Created: ${new Date(data.createdAt).toLocaleString()}

Important: Your private keys are encrypted and stored securely. Never share your private keys or recovery phrase with anyone.

You can now start using your wallet for secure transactions and investments.
  `;
}

function createTransactionTextEmail(data: any): string {
  return `
Transaction Confirmed

Transaction Details:
- Type: ${data.type}
- Amount: ${data.amount} ${data.currency}
- Status: ${data.status}
- Transaction ID: ${data.transactionId}
- Time: ${new Date(data.timestamp).toLocaleString()}

Your transaction has been processed and confirmed on the blockchain.
  `;
}

function createSecurityAlertTextEmail(data: any): string {
  return `
Security Activity Detected

Alert: ${data.alertType}

Activity Details:
- Action: ${data.action}
- IP Address: ${data.ipAddress}
- Time: ${new Date(data.timestamp).toLocaleString()}
- Location: ${data.location || 'Unknown'}

If this was you, no action is needed. If you don't recognize this activity, please secure your account immediately.
  `;
}

function createPasswordResetTextEmail(data: any): string {
  return `
Reset Your Password

Click the link below to reset your password. This link will expire in 1 hour:

${data.resetLink}

If you didn't request this password reset, please ignore this email and ensure your account is secure.
  `;
}
