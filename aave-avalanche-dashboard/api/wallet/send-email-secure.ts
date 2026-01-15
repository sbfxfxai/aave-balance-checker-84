import { VercelRequest, VercelResponse } from '@vercel/node';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { checkRateLimit, RATE_LIMITS } from './rateLimit';
import { generatePerUserSalt } from '../utils/crypto-utils';

// Helper to access Node.js crypto module (available at runtime in Vercel)
function getCrypto() {
  // Use Function constructor to access require in a way TypeScript accepts
  const requireFunc = new Function('return require')();
  return requireFunc('crypto') as {
    pbkdf2Sync: (
      password: string,
      salt: string,
      iterations: number,
      keylen: number,
      digest: string
    ) => Buffer;
    randomBytes: (size: number) => Buffer;
    createCipheriv: (algorithm: string, key: Uint8Array, iv: Uint8Array) => {
      update: (data: string, encoding: string) => Buffer;
      final: () => Buffer;
      getAuthTag: () => Buffer;
    };
  };
}
import { withMonitoring } from './monitoring';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { getRedis } from '../utils/redis';

// ============================================================================
// CONFIGURATION & VALIDATION
// ============================================================================

// Validate required environment variables
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const MAILGUN_FROM = process.env.MAILGUN_FROM || 'TiltVault <no-reply@tiltvault.com>';

if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
  throw new Error('Missing required Mailgun configuration: MAILGUN_API_KEY and MAILGUN_DOMAIN must be set');
}

// Encryption parameters (matches client-side encryption)
const MNEMONIC_ENCRYPTION_SALT = process.env.MNEMONIC_SALT || 'tiltvault-mnemonic-salt';
// ENHANCED: Configurable PBKDF2 iterations (default 600k for 2026 security standards)
const PBKDF2_ITERATIONS = parseInt(
  process.env.PBKDF2_ITERATIONS || process.env.MNEMONIC_PBKDF2_ITERATIONS || '600000',
  10
);
const MIN_PBKDF2_ITERATIONS = 100_000;
const EFFECTIVE_PBKDF2_ITERATIONS = Math.max(PBKDF2_ITERATIONS, MIN_PBKDF2_ITERATIONS);

// ENHANCED: Per-user salt support
const USE_PER_USER_SALT = process.env.USE_PER_USER_SALT === 'true';
const KEY_LENGTH = 32; // 256 bits for AES-256
const IV_LENGTH = 12; // AES-GCM IV length
const AUTH_TAG_LENGTH = 16; // AES-GCM auth tag length

// Email validation regex
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const WALLET_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface EmailRequest {
  email: string;
  wallet_address: string;
  mnemonic: string;
  name?: string;
}

interface EmailResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface EmailLogEntry {
  timestamp: number;
  email: string;
  walletAddress: string;
  messageId?: string;
  success: boolean;
  error?: string;
  ip?: string;
  userAgent?: string;
}

// ============================================================================
// MAILGUN CLIENT INITIALIZATION
// ============================================================================

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: MAILGUN_API_KEY,
});

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate email address format
 */
function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.toLowerCase().trim());
}

/**
 * Validate Ethereum wallet address format
 */
function validateWalletAddress(address: string): boolean {
  return WALLET_ADDRESS_REGEX.test(address.toLowerCase());
}

/**
 * Validate BIP39 mnemonic format
 */
function validateMnemonic(mnemonic: string): boolean {
  const words = mnemonic.trim().split(/\s+/);
  const validWordCounts = [12, 15, 18, 21, 24];
  return validWordCounts.includes(words.length) && words.length >= 12;
}

/**
 * Sanitize input to prevent injection attacks
 */
function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/[\r\n]/g, ' ') // Replace newlines with spaces
    .trim()
    .substring(0, 1000); // Limit length
}

/**
 * Validate and sanitize request body
 */
function validateRequestBody(req: VercelRequest): EmailRequest {
  const { email, wallet_address, mnemonic, name } = req.body;

  // Validate required fields
  if (!email || !wallet_address || !mnemonic) {
    throw new Error('Missing required fields: email, wallet_address, mnemonic');
  }

  // Validate formats
  if (!validateEmail(email)) {
    throw new Error('Invalid email address format');
  }

  if (!validateWalletAddress(wallet_address)) {
    throw new Error('Invalid wallet address format');
  }

  if (!validateMnemonic(mnemonic)) {
    throw new Error('Invalid mnemonic format');
  }

  // Sanitize inputs
  return {
    email: sanitizeInput(email.toLowerCase().trim()),
    wallet_address: sanitizeInput(wallet_address.toLowerCase().trim()),
    mnemonic: mnemonic.trim(), // Don't sanitize mnemonic - it needs to be exact
    name: name ? sanitizeInput(name) : undefined
  };
}

/**
 * Get client IP for logging
 */
function getClientIP(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : String(forwarded))
    : req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  return typeof ip === 'string' ? ip : (Array.isArray(ip) ? ip[0] : 'unknown');
}

// ============================================================================
// ENCRYPTION FUNCTIONS
// ============================================================================

/**
 * Encrypt mnemonic using user's email as the key material
 * Uses PBKDF2 for key derivation and AES-256-GCM for encryption
 */
function encryptMnemonic(mnemonic: string, userEmail: string): string {
  try {
    const crypto = getCrypto();
    const Buffer = (globalThis as any).Buffer;
    
    // Normalize email (lowercase, trim)
    const normalizedEmail = userEmail.toLowerCase().trim();
    
    // ENHANCED: Use per-user salt if enabled, otherwise use static salt
    const salt = USE_PER_USER_SALT 
      ? generatePerUserSalt(normalizedEmail)
      : MNEMONIC_ENCRYPTION_SALT;
    
    // Derive encryption key from email using PBKDF2
    const keyBuffer = crypto.pbkdf2Sync(
      normalizedEmail,
      salt,
      EFFECTIVE_PBKDF2_ITERATIONS,
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
    
    // Combine update and final results
    const updateArray = new Uint8Array(updateResult);
    const finalArray = new Uint8Array(finalResult);
    const encryptedLength = updateArray.length + finalArray.length;
    const encryptedArray = new Uint8Array(encryptedLength);
    encryptedArray.set(updateArray, 0);
    encryptedArray.set(finalArray, updateArray.length);
    const encrypted = Buffer.from(encryptedArray.buffer);
    
    // ENHANCED: Include salt in output if per-user salt is enabled
    // Format: salt(44 base64 chars):iv:encrypted:authTag (if per-user salt)
    // Format: iv:encrypted:authTag (legacy, if static salt)
    let combinedArray: Uint8Array;
    
    if (USE_PER_USER_SALT) {
      // New format with per-user salt
      const saltBase64 = Buffer.from(salt, 'utf8').toString('base64');
      const saltArray = new Uint8Array(Buffer.from(saltBase64, 'utf8'));
      const ivArray = new Uint8Array(ivBuffer);
      const encryptedDataArray = new Uint8Array(encrypted);
      const authTagArray = new Uint8Array(authTag);
      const totalLength = saltArray.length + ivArray.length + encryptedDataArray.length + authTagArray.length;
      combinedArray = new Uint8Array(totalLength);
      combinedArray.set(saltArray, 0);
      combinedArray.set(ivArray, saltArray.length);
      combinedArray.set(encryptedDataArray, saltArray.length + ivArray.length);
      combinedArray.set(authTagArray, saltArray.length + ivArray.length + encryptedDataArray.length);
    } else {
      // Legacy format: IV + encrypted + auth tag
      const ivArray = new Uint8Array(ivBuffer);
      const encryptedDataArray = new Uint8Array(encrypted);
      const authTagArray = new Uint8Array(authTag);
      const totalLength = ivArray.length + encryptedDataArray.length + authTagArray.length;
      combinedArray = new Uint8Array(totalLength);
      combinedArray.set(ivArray, 0);
      combinedArray.set(encryptedDataArray, ivArray.length);
      combinedArray.set(authTagArray, ivArray.length + encryptedDataArray.length);
    }
    
    // Return base64 encoded for email transmission
    return Buffer.from(combinedArray.buffer).toString('base64');
    
  } catch (error) {
    logger.error('Failed to encrypt mnemonic', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    throw new Error('Failed to encrypt mnemonic');
  }
}

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

/**
 * Generate email content with security information
 * Supports both traditional encrypted blob and one-time link methods
 */
function generateEmailContent(
  email: string,
  walletAddress: string,
  encryptedMnemonic: string,
  name?: string,
  oneTimeLinkUrl?: string,
  expiresAt?: number
): { text: string; html: string } {
  const sanitizedName = name || 'there';
  const expiresInHours = expiresAt ? Math.ceil((expiresAt - Date.now()) / (1000 * 60 * 60)) : 24;
  const expiresDate = expiresAt ? new Date(expiresAt).toLocaleString() : '24 hours from now';
  
  // Use one-time link if provided (more secure)
  const useOneTimeLink = !!oneTimeLinkUrl;
  
  const textContent = `
Hello ${sanitizedName},

Your deposit was successful! Here are your wallet details:

Wallet Address: ${walletAddress}

${useOneTimeLink ? `
SECURE RECOVERY LINK:
${oneTimeLinkUrl}

⚠️ IMPORTANT: This link will expire in ${expiresInHours} hours (${expiresDate}).
⚠️ This link can only be used ONCE. After clicking, it will be permanently disabled.
⚠️ If you don't decrypt within 24 hours, you'll need to request a new recovery link.

To decrypt your recovery phrase:
1. Click the secure link above (or copy and paste it into your browser)
2. The system will automatically decrypt your recovery phrase
3. Save your recovery phrase securely - you'll need it to access your wallet

SECURITY NOTES:
- This link is single-use and expires in ${expiresInHours} hours
- Only you (with access to this email) can use this link
- Never share this link or your recovery phrase with anyone
- If the link expires, contact support to request a new one
` : `
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

⚠️ SELF-DESTRUCT TIMER: Decrypt within 24 hours or request a new recovery email.

SECURITY NOTES:
- Your recovery phrase is encrypted using your email address as the key
- Only you (with access to this email) can decrypt it
- Never share your recovery phrase with anyone
- Save this email securely - you'll need it to recover your wallet
`}

Your funds will be deposited to this wallet shortly. You can check your balance on the dashboard at https://www.tiltvault.com

If you have any questions, please contact support.

Best regards,
TiltVault Team
  `.trim();

  const htmlContent = `
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
      <p><strong>Wallet Address:</strong><br><code style="background: #f5f5f5; padding: 5px 10px; border-radius: 4px;">${walletAddress}</code></p>
    </div>
    
    ${useOneTimeLink ? `
    <div class="security-note" style="background: #d1ecf1; border-left: 4px solid #0c5460;">
      <h3>🔒 SECURE RECOVERY LINK</h3>
      <p><strong>Click the button below to decrypt your recovery phrase securely:</strong></p>
      
      <a href="${oneTimeLinkUrl}" class="button" style="display: block; text-align: center; margin: 20px 0;">Decrypt Recovery Phrase (One-Time Link)</a>
      
      <div style="background: #fff3cd; padding: 15px; border-radius: 4px; margin: 15px 0;">
        <h4>⚠️ IMPORTANT:</h4>
        <ul style="margin: 10px 0; padding-left: 20px;">
          <li>This link expires in <strong>${expiresInHours} hours</strong> (${expiresDate})</li>
          <li>This link can only be used <strong>ONCE</strong>. After clicking, it will be permanently disabled.</li>
          <li>If you don't decrypt within 24 hours, contact support to request a new recovery link.</li>
        </ul>
      </div>
      
      <h4>How It Works:</h4>
      <ol>
        <li>Click the secure link above</li>
        <li>The system will automatically decrypt your recovery phrase</li>
        <li>Save your recovery phrase securely - you'll need it to access your wallet</li>
      </ol>
    </div>
    ` : `
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
      
      <div style="background: #fff3cd; padding: 15px; border-radius: 4px; margin: 15px 0;">
        <h4>⚠️ SELF-DESTRUCT TIMER:</h4>
        <p>Decrypt within <strong>24 hours</strong> or request a new recovery email.</p>
      </div>
    </div>
    `}
    
    <div class="security-note">
      <h4>SECURITY REMINDERS:</h4>
      <ul>
        <li>Your recovery phrase is encrypted using your email address</li>
        <li>Only you (with access to this email) can decrypt it</li>
        <li>Never share your recovery phrase or ${useOneTimeLink ? 'link' : 'encrypted data'} with anyone</li>
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

  return { text: textContent, html: htmlContent };
}

// ============================================================================
// LOGGING FUNCTIONS
// ============================================================================

/**
 * Log email sending attempt for audit trail
 */
async function logEmailAttempt(
  email: string,
  walletAddress: string,
  success: boolean,
  messageId?: string,
  error?: string,
  req?: VercelRequest
): Promise<void> {
  try {
    const redis = await getRedis();
    const logEntry: EmailLogEntry = {
      timestamp: Date.now(),
      email: email.toLowerCase().trim(),
      walletAddress: walletAddress.toLowerCase().trim(),
      messageId,
      success,
      error,
      ip: req ? getClientIP(req) : undefined,
      userAgent: req?.headers['user-agent']
    };
    
    const logKey = 'email_send_log';
    await redis.lpush(logKey, JSON.stringify(logEntry));
    await redis.ltrim(logKey, 0, 999); // Keep last 1000 entries
    await redis.expire(logKey, 30 * 24 * 60 * 60); // 30 days
    
    logger.info('Email attempt logged', LogCategory.API, {
      email: email.toLowerCase().trim(),
      walletAddress: walletAddress.toLowerCase().trim(),
      success,
      messageId,
      error: error?.substring(0, 100) // Limit error length
    });
    
  } catch (logError) {
    logger.error('Failed to log email attempt', LogCategory.API, {
      email: email.toLowerCase().trim(),
      error: logError instanceof Error ? logError.message : String(logError)
    }, logError instanceof Error ? logError : new Error(String(logError)));
  }
}

/**
 * Get email sending statistics
 */
export async function getEmailStats(
  days: number = 7
): Promise<{
  totalSent: number;
  totalFailed: number;
  successRate: number;
  topEmails: Array<{ email: string; count: number }>;
  recentFailures: Array<{ timestamp: number; email: string; error: string }>;
}> {
  try {
    const redis = await getRedis();
    const logs = (await redis.lrange('email_send_log', 0, -1)) as string[];
    
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recentLogs = logs
      .map(log => JSON.parse(log) as EmailLogEntry)
      .filter(log => log.timestamp >= cutoff);
    
    const totalSent = recentLogs.filter(log => log.success).length;
    const totalFailed = recentLogs.filter(log => !log.success).length;
    const successRate = recentLogs.length > 0 ? totalSent / recentLogs.length : 0;
    
    // Count emails by address
    const emailCounts: Record<string, number> = {};
    recentLogs.forEach(log => {
      emailCounts[log.email] = (emailCounts[log.email] || 0) + 1;
    });
    
    const topEmails = Object.entries(emailCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([email, count]) => ({ email, count }));
    
    // Get recent failures
    const recentFailures = recentLogs
      .filter(log => !log.success && log.error)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10)
      .map(log => ({
        timestamp: log.timestamp,
        email: log.email,
        error: log.error!
      }));
    
    return {
      totalSent,
      totalFailed,
      successRate,
      topEmails,
      recentFailures
    };
    
  } catch (error) {
    logger.error('Failed to get email statistics', LogCategory.API, {
      days,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return {
      totalSent: 0,
      totalFailed: 0,
      successRate: 0,
      topEmails: [],
      recentFailures: []
    };
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS headers (restrictive for production)
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['https://www.tiltvault.com'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin || '')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  return withMonitoring(req, res, 'send-email', async (): Promise<void> => {
    const startTime = Date.now();
    
    try {
      // Validate and sanitize request body
      const { email, wallet_address, mnemonic, name } = validateRequestBody(req);
      
      logger.info('Email request validated', LogCategory.API, {
        email: email.toLowerCase().trim(),
        walletAddress: wallet_address.toLowerCase().trim(),
        hasName: !!name
      });

      // Rate limiting per email
      const rateLimitResult = await checkRateLimit(req, {
        ...RATE_LIMITS.SEND_EMAIL,
        identifier: email,
      });

      if (!rateLimitResult.allowed) {
        res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());
        
        await logEmailAttempt(email, wallet_address, false, undefined, 'Rate limit exceeded', req);
        
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

      // SECURITY: Encrypt mnemonic before sending via email
      const encryptedMnemonic = encryptMnemonic(mnemonic, email);
      
      logger.debug('Mnemonic encrypted successfully', LogCategory.AUTH, {
        email: email.toLowerCase().trim(),
        encryptionLength: encryptedMnemonic.length
      });

      // Optionally use one-time link (more secure, reduces email exposure)
      const useOneTimeLink = process.env.USE_ONE_TIME_LINKS === 'true';
      let oneTimeLinkUrl: string | undefined;
      let expiresAt: number | undefined;
      
      if (useOneTimeLink) {
        try {
          const { generateOneTimeLink } = await import('./one-time-link');
          const linkResult = await generateOneTimeLink(email, wallet_address, encryptedMnemonic);
          
          if (linkResult.success && linkResult.token && linkResult.url) {
            oneTimeLinkUrl = linkResult.url;
            expiresAt = linkResult.expiresAt;
            
            logger.info('One-time link generated for email', LogCategory.AUTH, {
              email: email.toLowerCase().trim(),
              expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined
            });
          } else {
            logger.warn('Failed to generate one-time link, falling back to encrypted blob', LogCategory.AUTH, {
              email: email.toLowerCase().trim(),
              error: linkResult.error
            });
          }
        } catch (linkError) {
          logger.warn('One-time link generation failed, falling back to encrypted blob', LogCategory.AUTH, {
            email: email.toLowerCase().trim(),
            error: linkError instanceof Error ? linkError.message : String(linkError)
          });
        }
      }

      // Generate email content (with one-time link if available)
      const { text, html } = generateEmailContent(
        email, 
        wallet_address, 
        encryptedMnemonic, 
        name,
        oneTimeLinkUrl,
        expiresAt
      );

      // Send email via Mailgun
      const emailData = {
        from: MAILGUN_FROM,
        to: email,
        subject: 'Your TiltVault Wallet Details - Encrypted Recovery Phrase',
        text,
        html
      };

      const response = await mg.messages.create(MAILGUN_DOMAIN!, emailData);
      
      // Log successful email send
      await logEmailAttempt(email, wallet_address, true, response.id, undefined, req);
      
      logger.info('Email sent successfully', LogCategory.API, {
        email: email.toLowerCase().trim(),
        walletAddress: wallet_address.toLowerCase().trim(),
        messageId: response.id,
        duration: Date.now() - startTime
      });

      // Never log the mnemonic (plaintext or encrypted) in production logs
      res.status(200).json({ 
        success: true,
        messageId: response.id
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Log failed email attempt
      await logEmailAttempt(
        req.body?.email || 'unknown',
        req.body?.wallet_address || 'unknown',
        false,
        undefined,
        errorMessage,
        req
      );
      
      logger.error('Email send failed', LogCategory.API, {
        email: req.body?.email || 'unknown',
        walletAddress: req.body?.wallet_address || 'unknown',
        error: errorMessage,
        duration: Date.now() - startTime
      }, error instanceof Error ? error : new Error(errorMessage));
      
      errorTracker.trackError(error instanceof Error ? error : new Error(errorMessage), {
        category: 'email',
        context: {
          email: req.body?.email || 'unknown',
          walletAddress: req.body?.wallet_address || 'unknown',
          endpoint: 'send-email'
        }
      });
      
      // Don't expose internal errors to client
      const userMessage = errorMessage.includes('Invalid') || errorMessage.includes('Missing')
        ? errorMessage
        : 'Failed to send email. Please try again later.';
      
      res.status(500).json({ 
        success: false,
        error: userMessage
      });
    }
  });
}
