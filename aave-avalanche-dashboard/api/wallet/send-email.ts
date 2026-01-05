import { VercelRequest, VercelResponse } from '@vercel/node';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
// @ts-expect-error - crypto is a Node.js built-in module, types may not be available
import crypto from 'crypto';
import { checkRateLimit, RATE_LIMITS } from './rateLimit';
import { withMonitoring } from './monitoring';

// Buffer is available globally in Node.js/Vercel environments
interface Buffer extends ArrayLike<number> {
  from(data: ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  from(data: string, encoding: 'base64' | 'hex' | 'utf8' | 'utf-8'): Buffer;
  toString(encoding?: 'utf-8' | 'utf8' | 'base64' | 'hex'): string;
  length: number;
}

declare const Buffer: {
  from(data: ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  from(data: string, encoding: 'base64' | 'hex' | 'utf8' | 'utf-8'): Buffer;
  isBuffer(obj: any): boolean;
  new (data: string, encoding?: string): Buffer;
  prototype: Buffer;
};

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || '',
});

// Encryption parameters (matches client-side encryption)
const MNEMONIC_ENCRYPTION_SALT = 'tiltvault-mnemonic-salt';
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits for AES-256
const IV_LENGTH = 12; // AES-GCM IV length
const AUTH_TAG_LENGTH = 16; // AES-GCM auth tag length

/**
 * Encrypt mnemonic using user's email as the key material
 * Only the user (who knows their email) can decrypt this
 */
function encryptMnemonic(mnemonic: string, userEmail: string): string {
  // Normalize email (lowercase, trim)
  const normalizedEmail = userEmail.toLowerCase().trim();
  
  // Derive encryption key from email using PBKDF2
  const keyBuffer = crypto.pbkdf2Sync(
    normalizedEmail,
    MNEMONIC_ENCRYPTION_SALT,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256'
  );
  const key = new Uint8Array(keyBuffer);
  
  // Generate random IV
  const ivBuffer = crypto.randomBytes(IV_LENGTH);
  const iv = new Uint8Array(ivBuffer);
  
  // Encrypt mnemonic using AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const updateResult = cipher.update(mnemonic, 'utf8');
  const finalResult = cipher.final();
  const authTag = cipher.getAuthTag();
  
  // Combine update and final results - convert to Uint8Array arrays
  const updateArray = new Uint8Array(updateResult);
  const finalArray = new Uint8Array(finalResult);
  const encryptedLength = updateArray.length + finalArray.length;
  const encryptedArray = new Uint8Array(encryptedLength);
  encryptedArray.set(updateArray, 0);
  encryptedArray.set(finalArray, updateArray.length);
  const encrypted = Buffer.from(encryptedArray.buffer);
  
  // Combine IV + encrypted data + auth tag - convert all to Uint8Array
  const ivArray = new Uint8Array(ivBuffer);
  const encryptedDataArray = new Uint8Array(encrypted);
  const authTagArray = new Uint8Array(authTag);
  const totalLength = ivArray.length + encryptedDataArray.length + authTagArray.length;
  const combinedArray = new Uint8Array(totalLength);
  combinedArray.set(ivArray, 0);
  combinedArray.set(encryptedDataArray, ivArray.length);
  combinedArray.set(authTagArray, ivArray.length + encryptedDataArray.length);
  
  // Return base64 encoded for email transmission
  return Buffer.from(combinedArray.buffer).toString('base64');
}

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

  return withMonitoring(req, res, 'send-email', async (): Promise<void> => {
    const { email, wallet_address, mnemonic, name } = req.body;

    // Rate limiting per email
    const rateLimitResult = await checkRateLimit(req, {
      ...RATE_LIMITS.SEND_EMAIL,
      identifier: email,
    });

    if (!rateLimitResult.allowed) {
      res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Too many requests. Please try again after ${new Date(rateLimitResult.resetAt).toISOString()}`,
        resetAt: rateLimitResult.resetAt,
      });
      return;
    }

    res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
    res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());

    if (!email || !wallet_address || !mnemonic) {
      res.status(400).json({ 
        error: 'Missing required fields: email, wallet_address, mnemonic' 
      });
      return;
    }

    // SECURITY: Encrypt mnemonic before sending via email
    // Only the user (who knows their email) can decrypt it
    const encryptedMnemonic = encryptMnemonic(mnemonic, email);
    
    // Never log the plaintext mnemonic
    console.log('[Send Email] Encrypting mnemonic for secure email transmission');

    const emailContent = `
Hello ${name || 'there'},

Your deposit was successful! Here are your wallet details:

Wallet Address: ${wallet_address}

ENCRYPTED RECOVERY PHRASE:
${encryptedMnemonic}

IMPORTANT SECURITY INFORMATION:
Your recovery phrase is encrypted for your protection. To decrypt it:

1. Visit: https://www.tiltvault.com/recover
2. Enter your email address: ${email}
3. Paste the encrypted recovery phrase above
4. The system will decrypt it using your email address

OR use this direct link:
https://www.tiltvault.com/recover?email=${encodeURIComponent(email)}&encrypted=${encodeURIComponent(encryptedMnemonic)}

SECURITY NOTES:
- Your recovery phrase is encrypted using your email address as the key
- Only you (with access to this email) can decrypt it
- Never share your recovery phrase with anyone
- Save this email securely - you'll need it to recover your wallet

Your funds will be deposited to this wallet shortly. You can check your balance on the dashboard at https://www.tiltvault.com

If you have any questions, please contact support.

Best regards,
TiltVault Team
    `.trim();

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
    .header h1 { color: white; margin: 0; }
    .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
    .wallet-info { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .encrypted-box { background: #f5f5f5; padding: 15px; border-radius: 8px; border: 2px dashed #667eea; margin: 20px 0; word-break: break-all; font-family: monospace; font-size: 12px; }
    .security-note { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .button { display: inline-block; background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>TiltVault</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Secure Banking & Investments</p>
  </div>
  
  <div class="content">
    <h2>Your Wallet Details</h2>
    
    <div class="wallet-info">
      <p><strong>Wallet Address:</strong><br><code style="background: #f5f5f5; padding: 5px 10px; border-radius: 4px;">${wallet_address}</code></p>
    </div>
    
    <div class="security-note">
      <h3>ENCRYPTED RECOVERY PHRASE</h3>
      <p>Your recovery phrase is encrypted for security. Only you can decrypt it using your email address.</p>
      
      <div class="encrypted-box">
        ${encryptedMnemonic}
      </div>
      
      <h4>How to Decrypt:</h4>
      <ol>
        <li>Visit: <a href="https://www.tiltvault.com/recover">https://www.tiltvault.com/recover</a></li>
        <li>Enter your email: <strong>${email}</strong></li>
        <li>Paste the encrypted recovery phrase above</li>
        <li>Click "Decrypt" to reveal your recovery phrase</li>
      </ol>
      
      <a href="https://www.tiltvault.com/recover?email=${encodeURIComponent(email)}&encrypted=${encodeURIComponent(encryptedMnemonic)}" class="button">Decrypt Recovery Phrase</a>
    </div>
    
    <div class="security-note">
      <h4>SECURITY REMINDERS:</h4>
      <ul>
        <li>Your recovery phrase is encrypted using your email address</li>
        <li>Only you (with access to this email) can decrypt it</li>
        <li>Never share your recovery phrase with anyone</li>
        <li>Save this email securely - you'll need it to recover your wallet</li>
      </ul>
    </div>
    
    <p>Your funds will be deposited to this wallet shortly. You can check your balance on the <a href="https://www.tiltvault.com">dashboard</a>.</p>
    
    <p>If you have any questions, please contact support.</p>
    
    <p>Best regards,<br>TiltVault Team</p>
  </div>
  
  <div class="footer">
    <p>TiltVault - Secure Banking & Investments</p>
  </div>
</body>
</html>
    `.trim();

    const data = {
      from: process.env.MAILGUN_FROM || 'TiltVault <no-reply@tiltvault.com>',
      to: email,
      subject: 'Your TiltVault Wallet Details - Encrypted Recovery Phrase',
      text: emailContent,
      html: emailHtml
    };

    const response = await mg.messages.create(process.env.MAILGUN_DOMAIN!, data);
    
    // Never log the mnemonic (plaintext or encrypted) in production logs
    console.log('[Send Email] Email sent successfully:', {
      to: email,
      walletAddress: wallet_address,
      messageId: response.id,
      mnemonicEncrypted: true
    });

    res.status(200).json({ 
      success: true,
      messageId: response.id
    });

  });
}
