import { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import formData from 'form-data';
import Mailgun from 'mailgun.js';

const mailgun = new Mailgun(formData);
const mg = mailgun.client({
  username: 'api',
  key: process.env.MAILGUN_API_KEY || '',
});

// Initialize Redis
function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

// Generate 6-digit code
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Generate 6-digit code
    const code = generateCode();
    const redis = getRedis();

    try {
      // Store code with 10-minute expiry (600 seconds)
      await redis.set(`auth_code:${normalizedEmail}`, code, { ex: 600 });
      console.log(`[Auth] Code stored for ${normalizedEmail}: ${code}`);
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
      if (!process.env.MAILGUN_DOMAIN) {
        throw new Error('MAILGUN_DOMAIN environment variable is not set');
      }
      
      const response = await mg.messages.create(process.env.MAILGUN_DOMAIN, data);
      console.log(`[Auth] Email sent to ${normalizedEmail}`, { messageId: response.id });
    } catch (mailgunError) {
      console.error('[Auth] Mailgun error:', mailgunError);
      const errorDetails = mailgunError instanceof Error ? mailgunError.message : String(mailgunError);
      return res.status(500).json({ 
        error: 'Failed to send email',
        details: errorDetails
      });
    }

    console.log(`[Auth] Code sent to ${normalizedEmail}: ${code}`);

    return res.status(200).json({ 
      success: true,
      message: 'Code sent successfully'
    });

  } catch (error) {
    console.error('[Auth] Error sending code:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to send code';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error('[Auth] Error details:', {
      message: errorMessage,
      stack: errorStack,
      body: req.body
    });
    
    return res.status(500).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? errorStack : undefined
    });
  }
}
