import { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';
import { Ratelimit } from '@upstash/ratelimit';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { randomInt } from 'crypto';

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || '',
});

// Generate secure 6-digit code using crypto
function generateCode(): string {
  return randomInt(100000, 999999).toString();
}

// Hash email for safe logging
function hashEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.substring(0, 2)}***@${domain}`;
}

// Rate limiter (initialized once)
let _ratelimit: any = null;

async function getRatelimit() {
  if (!_ratelimit) {
    const redis = getRedis();
    _ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '1 h'), // 3 emails per hour per IP
      analytics: true,
    });
  }
  return _ratelimit;
}

// Send email with retry logic
async function sendEmailWithRetry(data: any, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await mg.messages.create(process.env.MAILGUN_DOMAIN!, data);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      console.log(`[Auth] Email send failed, retrying (${attempt}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  console.log('[Auth] Send code endpoint called');
  
  if (req.method !== 'POST') {
    console.log('[Auth] Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Log environment variable status (without exposing values)
  console.log('[Auth] Environment check:');
  console.log('- MAILGUN_API_KEY:', process.env.MAILGUN_API_KEY ? 'SET' : 'MISSING');
  console.log('- MAILGUN_DOMAIN:', process.env.MAILGUN_DOMAIN || 'MISSING');
  console.log('- KV_REST_API_URL:', process.env.KV_REST_API_URL ? 'SET' : 'MISSING');
  console.log('- KV_REST_API_TOKEN:', process.env.KV_REST_API_TOKEN ? 'SET' : 'MISSING');

  // Check required environment variables
  const requiredEnvVars = [
    'MAILGUN_API_KEY',
    'MAILGUN_DOMAIN',
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN'
  ];

  const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  if (missingEnvVars.length > 0) {
    console.error('[Auth] Missing environment variables:', missingEnvVars);
    return res.status(500).json({ 
      error: 'Server configuration error',
      details: `Missing: ${missingEnvVars.join(', ')}`
    });
  }

  console.log('[Auth] All environment variables present');

  try {
    // Validate request body
    if (!req.body) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Rate limiting - IP-based
    const ratelimit = await getRatelimit();
    const identifier = (req.headers['x-forwarded-for'] as string) || 
                       (req.headers['x-real-ip'] as string) || 
                       'anonymous';
    
    const ipLimit = await ratelimit.limit(`ip:${identifier}`);
    if (!ipLimit.success) {
      return res.status(429).json({ 
        error: 'Too many requests',
        message: 'Maximum 3 verification emails per hour',
        retryAfter: Math.ceil((ipLimit.reset - Date.now()) / 1000),
      });
    }

    // Rate limiting - Email-based
    const emailLimit = await ratelimit.limit(`email:${normalizedEmail}`);
    if (!emailLimit.success) {
      return res.status(429).json({
        error: 'Too many requests for this email',
        retryAfter: Math.ceil((emailLimit.reset - Date.now()) / 1000),
      });
    }

    // Generate and store code with metadata
    const code = generateCode();
    const redis = getRedis();

    const codeData = {
      code,
      createdAt: Date.now(),
      attempts: 0,
      ipAddress: identifier,
      userAgent: req.headers['user-agent'],
    };

    try {
      // Store code with 10-minute expiry (600 seconds)
      await redis.set(
        `auth_code:${normalizedEmail}`, 
        JSON.stringify(codeData),
        { ex: 600 }
      );
      console.log(`[Auth] Code stored for ${hashEmail(normalizedEmail)}`);
    } catch (redisError) {
      console.error('[Auth] Redis error:', redisError);
      return res.status(500).json({ 
        error: 'Failed to store verification code',
        details: 'Database storage error'
      });
    }

    // Send email with code
    const data = {
      from: `TiltVault <noreply@${process.env.MAILGUN_DOMAIN}>`,
      to: normalizedEmail,
      subject: 'Your TiltVault Login Code',
      text: `Your login code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, please ignore this email.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 32px;">TiltVault</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Secure Banking & Investments</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 40px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin: 0 0 20px 0;">Your Login Code</h2>
            
            <div style="background: white; padding: 30px; border-radius: 8px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <div style="font-size: 48px; font-weight: bold; letter-spacing: 8px; color: #667eea; margin: 0;">
                ${code}
              </div>
            </div>
            
            <p style="color: #666; margin: 30px 0 0 0; text-align: center;">
              This code expires in <strong>10 minutes</strong>
            </p>
            
            <p style="color: #999; margin: 30px 0 0 0; font-size: 14px; text-align: center;">
              If you didn't request this, please ignore this email.
            </p>
          </div>
        </div>
      `
    };

    try {
      const response = await sendEmailWithRetry(data);
      console.log(`[Auth] Email sent to ${hashEmail(normalizedEmail)}`, { messageId: response.id });
    } catch (mailgunError) {
      console.error('[Auth] Mailgun error:', mailgunError);
      const errorDetails = mailgunError instanceof Error ? mailgunError.message : String(mailgunError);
      
      // Clean up stored code if email fails
      await redis.del(`auth_code:${normalizedEmail}`);
      
      return res.status(500).json({ 
        error: 'Failed to send email',
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
      });
    }

    // Ensure consistent timing (prevent timing attacks)
    const elapsed = Date.now() - startTime;
    if (elapsed < 200) {
      await new Promise(resolve => setTimeout(resolve, 200 - elapsed));
    }

    console.log(`[Auth] Code sent successfully to ${hashEmail(normalizedEmail)}`);

    return res.status(200).json({ 
      success: true,
      message: 'If that email is registered, a code has been sent'
    });

  } catch (error) {
    console.error('[Auth] Error sending code:', error);
    
    // Ensure consistent timing even on error (prevent timing attacks)
    const elapsed = Date.now() - startTime;
    if (elapsed < 200) {
      await new Promise(resolve => setTimeout(resolve, 200 - elapsed));
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to send code';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error('[Auth] Error details:', {
      message: errorMessage,
      stack: errorStack,
    });
    
    return res.status(500).json({ 
      error: 'Failed to send verification code',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
}
