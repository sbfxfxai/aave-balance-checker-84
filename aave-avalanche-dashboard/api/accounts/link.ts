import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyMessage } from 'ethers';

// Validation functions
function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

function validateWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Helper function for safe logging
function hashEmail(email: string): string {
  return Buffer.from(email).toString('base64').substring(0, 8);
}

// Lazy-initialize Redis and Rate Limiter
let _redis: any = null;
let _ratelimit: any = null;

async function getRedis(): Promise<{ redis: any; ratelimit: any }> {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      throw new Error('Redis not configured');
    }
    
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
    
    // Initialize rate limiter
    try {
      const { Ratelimit } = await import('@upstash/ratelimit');
      _ratelimit = new Ratelimit({
        redis: _redis,
        limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute
        analytics: true,
      });
    } catch (error) {
      console.warn('[Account Link] Rate limiting not available:', error);
    }
  }
  return { redis: _redis, ratelimit: _ratelimit };
}

// Email service integration
async function sendVerificationEmail(email: string, code: string, walletAddress: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Email service not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'noreply@yourdomain.com',
      to: email,
      subject: 'Verify Your Email - Account Link',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Email Verification</h2>
          <p>You requested to link your wallet to your email address.</p>
          
          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 18px;"><strong>Your verification code is:</strong></p>
            <p style="font-size: 24px; font-weight: bold; color: #007bff; margin: 10px 0;">${code}</p>
          </div>
          
          <p><strong>Wallet to link:</strong> <code style="background: #eee; padding: 2px 4px;">${walletAddress}</code></p>
          <p><strong>This code expires in 15 minutes.</strong></p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="color: #666; font-size: 14px;">
            If you didn't request this, please ignore this email. 
            This link will expire automatically if not verified.
          </p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to send verification email: ${error}`);
  }
}

// Constants
const LINK_TTL = 365 * 24 * 60 * 60; // 1 year
const VERIFICATION_TTL = 15 * 60; // 15 minutes

/**
 * Account Link API with Two-Factor Verification
 * 
 * POST /api/accounts/link/request - Request verification (email + signature)
 * POST /api/accounts/link/confirm - Confirm with both verifications
 * GET  /api/accounts/link?email=... - Lookup (requires auth in production)
 * GET  /api/accounts/link?wallet=... - Lookup (requires auth in production)
 * DELETE /api/accounts/link - Unlink (requires signature verification)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { redis, ratelimit } = await getRedis();

    // Rate limiting
    if (ratelimit) {
      const identifier = (req.headers['x-forwarded-for'] as string) || 
                        (req.headers['x-real-ip'] as string) || 
                        'anonymous';
      const { success, remaining } = await ratelimit.limit(identifier);
      
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      
      if (!success) {
        return res.status(429).json({ 
          error: 'Too many requests. Please try again later.',
          retryAfter: 60,
        });
      }
    }

    // POST /api/accounts/link/request - Request verification
    if (req.method === 'POST' && req.url?.includes('/request')) {
      const { email, walletAddress } = req.body;

      // Validate inputs
      if (!email || !walletAddress) {
        return res.status(400).json({ 
          error: 'Missing required fields: email and walletAddress' 
        });
      }

      if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }

      if (!validateWalletAddress(walletAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedWallet = walletAddress.toLowerCase();

      // Check if already linked
      const existingWallet = await redis.get(`email:${normalizedEmail}:wallet`);
      if (existingWallet && existingWallet === normalizedWallet) {
        return res.status(200).json({
          success: true,
          message: 'Email already linked to this wallet',
          alreadyLinked: true,
        });
      }

      if (existingWallet && existingWallet !== normalizedWallet) {
        return res.status(409).json({
          error: 'Email already linked to a different wallet',
          existingWallet,
        });
      }

      // Generate verification code for email
      const emailCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      // Create message for wallet to sign
      const timestamp = Date.now();
      const expiresAt = new Date(timestamp + VERIFICATION_TTL * 1000).toISOString();
      const messageToSign = `Link wallet ${normalizedWallet} to ${normalizedEmail}\nCode: ${emailCode}\nExpires: ${expiresAt}`;

      // Store verification data
      const verificationKey = `verify:${normalizedEmail}:${normalizedWallet}`;
      await redis.set(verificationKey, JSON.stringify({
        emailCode,
        messageToSign,
        timestamp,
        email: normalizedEmail,
        wallet: normalizedWallet,
      }), { ex: VERIFICATION_TTL });

      // Send verification email
      try {
        await sendVerificationEmail(normalizedEmail, emailCode, normalizedWallet);
      } catch (emailError) {
        // Clean up verification data if email fails
        await redis.del(verificationKey);
        throw emailError;
      }

      console.log(`[Account Link] Verification requested: ${hashEmail(normalizedEmail)} -> ${normalizedWallet}`);

      return res.status(200).json({
        success: true,
        message: 'Verification email sent. Please sign the message with your wallet.',
        messageToSign,
        expiresAt,
      });
    }

    // POST /api/accounts/link/confirm - Confirm with verifications
    if (req.method === 'POST' && req.url?.includes('/confirm')) {
      const { email, walletAddress, emailCode, signature } = req.body;

      // Validate inputs
      if (!email || !walletAddress || !emailCode || !signature) {
        return res.status(400).json({ 
          error: 'Missing required fields: email, walletAddress, emailCode, signature' 
        });
      }

      if (!validateEmail(email) || !validateWalletAddress(walletAddress)) {
        return res.status(400).json({ error: 'Invalid email or wallet format' });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedWallet = walletAddress.toLowerCase();

      // Retrieve verification data
      const verificationKey = `verify:${normalizedEmail}:${normalizedWallet}`;
      const verificationData = await redis.get(verificationKey);
      if (!verificationData) {
        return res.status(401).json({ 
          error: 'Verification expired or not found. Please request a new verification.' 
        });
      }

      const { emailCode: storedCode, messageToSign } = JSON.parse(verificationData);

      // Verify email code
      if (emailCode !== storedCode) {
        return res.status(401).json({ error: 'Invalid email verification code' });
      }

      // Verify wallet signature
      try {
        const recoveredAddress = verifyMessage(messageToSign, signature);
        if (recoveredAddress.toLowerCase() !== normalizedWallet) {
          return res.status(401).json({ error: 'Invalid wallet signature' });
        }
      } catch (error) {
        return res.status(401).json({ error: 'Signature verification failed' });
      }

      // Check for existing links (double-check)
      const existingWallet = await redis.get(`email:${normalizedEmail}:wallet`);
      if (existingWallet && existingWallet !== normalizedWallet) {
        await redis.del(verificationKey); // Clean up
        return res.status(409).json({
          error: 'Email already linked to a different wallet',
        });
      }

      const existingEmail = await redis.get(`wallet:${normalizedWallet}:email`);
      if (existingEmail && existingEmail !== normalizedEmail) {
        await redis.del(verificationKey); // Clean up
        return res.status(409).json({
          error: 'Wallet already linked to a different email',
        });
      }

      // Create link atomically
      const pipeline = redis.pipeline();
      pipeline.set(`email:${normalizedEmail}:wallet`, normalizedWallet, { ex: LINK_TTL });
      pipeline.set(`wallet:${normalizedWallet}:email`, normalizedEmail, { ex: LINK_TTL });
      pipeline.hset(`link:metadata:${normalizedEmail}`, {
        createdAt: new Date().toISOString(),
        walletAddress: normalizedWallet,
        version: '1.0',
      });
      pipeline.lpush(`audit:${normalizedEmail}`, JSON.stringify({
        action: 'link_created',
        wallet: normalizedWallet,
        ip: req.headers['x-forwarded-for'],
        timestamp: new Date().toISOString(),
      }));
      pipeline.ltrim(`audit:${normalizedEmail}`, 0, 99); // Keep last 100 events
      
      const results = await pipeline.exec();

      // Verify all operations succeeded
      if (results.some((r: any) => r.error)) {
        throw new Error('Failed to create link');
      }

      // Delete verification data
      await redis.del(verificationKey);

      console.log(`[Account Link] Link created: ${hashEmail(normalizedEmail)} -> ${normalizedWallet}`);

      return res.status(200).json({
        success: true,
        email: normalizedEmail,
        walletAddress: normalizedWallet,
        message: 'Account successfully linked!',
      });
    }

    // GET - Lookup (WARNING: Consider adding authentication for production)
    if (req.method === 'GET') {
      const email = req.query.email as string;
      const wallet = req.query.wallet as string;

      if (email) {
        const normalizedEmail = email.toLowerCase().trim();
        
        if (!validateEmail(email)) {
          return res.status(400).json({ error: 'Invalid email format' });
        }
        
        const linkedWallet = await redis.get(`email:${normalizedEmail}:wallet`);
        
        return res.status(200).json({
          success: true,
          email: normalizedEmail,
          walletAddress: linkedWallet || null,
        });
      }

      if (wallet) {
        const normalizedWallet = wallet.toLowerCase();
        
        if (!validateWalletAddress(wallet)) {
          return res.status(400).json({ error: 'Invalid wallet address format' });
        }
        
        const linkedEmail = await redis.get(`wallet:${normalizedWallet}:email`);
        
        return res.status(200).json({
          success: true,
          walletAddress: normalizedWallet,
          email: linkedEmail || null,
        });
      }

      return res.status(400).json({ error: 'Provide email or wallet parameter' });
    }

    // DELETE - Unlink account
    if (req.method === 'DELETE') {
      const { email, walletAddress, signature } = req.body;

      if (!email || !walletAddress || !signature) {
        return res.status(400).json({ 
          error: 'Missing required fields: email, walletAddress, signature' 
        });
      }

      if (!validateEmail(email) || !validateWalletAddress(walletAddress)) {
        return res.status(400).json({ error: 'Invalid email or wallet format' });
      }

      const normalizedEmail = email.toLowerCase().trim();
      const normalizedWallet = walletAddress.toLowerCase();

      // Verify ownership with signature
      const message = `Unlink ${normalizedEmail} from ${normalizedWallet}`;
      try {
        const recoveredAddress = verifyMessage(message, signature);
        if (recoveredAddress.toLowerCase() !== normalizedWallet) {
          return res.status(401).json({ error: 'Unauthorized - invalid signature' });
        }
      } catch (error) {
        return res.status(401).json({ error: 'Signature verification failed' });
      }

      // Verify link exists
      const existingWallet = await redis.get(`email:${normalizedEmail}:wallet`);
      if (existingWallet !== normalizedWallet) {
        return res.status(404).json({ error: 'Link not found' });
      }

      // Delete atomically
      const pipeline = redis.pipeline();
      pipeline.del(`email:${normalizedEmail}:wallet`);
      pipeline.del(`wallet:${normalizedWallet}:email`);
      pipeline.del(`link:metadata:${normalizedEmail}`);
      pipeline.lpush(`audit:${normalizedEmail}`, JSON.stringify({
        action: 'link_deleted',
        wallet: normalizedWallet,
        ip: req.headers['x-forwarded-for'],
        timestamp: new Date().toISOString(),
      }));
      
      await pipeline.exec();

      console.log(`[Account Link] Link deleted: ${hashEmail(normalizedEmail)} -> ${normalizedWallet}`);

      return res.status(200).json({ 
        success: true,
        message: 'Account successfully unlinked',
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Account Link] Error:', {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? message : undefined,
    });
  }
}
