/**
 * CAPTCHA Verification Utilities
 * 
 * Supports multiple CAPTCHA providers:
 * - hCaptcha (default)
 * - reCAPTCHA v3
 * - Cloudflare Turnstile
 * 
 * SECURITY:
 * - Server-side verification (never trust client)
 * - Rate limiting on verification attempts
 * - Logging for security monitoring
 */

import { logger, LogCategory } from './logger';

// Configuration
const CAPTCHA_ENABLED = process.env.CAPTCHA_ENABLED !== 'false';
const CAPTCHA_PROVIDER = process.env.CAPTCHA_PROVIDER || 'hcaptcha';
const HCAPTCHA_SECRET_KEY = process.env.HCAPTCHA_SECRET_KEY;
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;

export interface CaptchaVerificationResult {
  success: boolean;
  score?: number; // For reCAPTCHA v3 (0.0-1.0)
  error?: string;
}

/**
 * Verify CAPTCHA token with configured provider
 * 
 * @param token CAPTCHA token from client
 * @param remoteIp Client IP address (for verification)
 * @returns Verification result
 */
export async function verifyCaptcha(
  token: string,
  remoteIp?: string
): Promise<CaptchaVerificationResult> {
  if (!CAPTCHA_ENABLED) {
    return { success: true }; // Bypass if disabled
  }

  if (!token) {
    return { success: false, error: 'CAPTCHA token required' };
  }

  try {
    switch (CAPTCHA_PROVIDER) {
      case 'hcaptcha':
        return await verifyHCaptcha(token, remoteIp);
      case 'recaptcha':
        return await verifyReCaptcha(token, remoteIp);
      case 'turnstile':
        return await verifyTurnstile(token, remoteIp);
      default:
        return { success: false, error: `Unknown CAPTCHA provider: ${CAPTCHA_PROVIDER}` };
    }
  } catch (error) {
    logger.error('CAPTCHA verification failed', LogCategory.AUTH, {
      provider: CAPTCHA_PROVIDER,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));

    return {
      success: false,
      error: error instanceof Error ? error.message : 'CAPTCHA verification failed'
    };
  }
}

/**
 * Verify hCaptcha token
 */
async function verifyHCaptcha(token: string, remoteIp?: string): Promise<CaptchaVerificationResult> {
  if (!HCAPTCHA_SECRET_KEY) {
    return { success: false, error: 'HCAPTCHA_SECRET_KEY not configured' };
  }

  try {
    const response = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        secret: HCAPTCHA_SECRET_KEY,
        response: token,
        ...(remoteIp && { remoteip: remoteIp })
      })
    });

    const data = await response.json();

    if (data.success) {
      return { success: true };
    } else {
      return {
        success: false,
        error: data['error-codes']?.join(', ') || 'hCaptcha verification failed'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'hCaptcha API error'
    };
  }
}

/**
 * Verify reCAPTCHA v3 token
 */
async function verifyReCaptcha(token: string, remoteIp?: string): Promise<CaptchaVerificationResult> {
  if (!RECAPTCHA_SECRET_KEY) {
    return { success: false, error: 'RECAPTCHA_SECRET_KEY not configured' };
  }

  try {
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        secret: RECAPTCHA_SECRET_KEY,
        response: token,
        ...(remoteIp && { remoteip: remoteIp })
      })
    });

    const data = await response.json();

    if (data.success) {
      // reCAPTCHA v3 returns a score (0.0-1.0)
      // Typically, scores > 0.5 are considered legitimate
      const score = data.score || 0;
      const threshold = parseFloat(process.env.RECAPTCHA_SCORE_THRESHOLD || '0.5');

      if (score >= threshold) {
        return { success: true, score };
      } else {
        return {
          success: false,
          score,
          error: `reCAPTCHA score too low: ${score} (threshold: ${threshold})`
        };
      }
    } else {
      return {
        success: false,
        error: data['error-codes']?.join(', ') || 'reCAPTCHA verification failed'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'reCAPTCHA API error'
    };
  }
}

/**
 * Verify Cloudflare Turnstile token
 */
async function verifyTurnstile(token: string, remoteIp?: string): Promise<CaptchaVerificationResult> {
  if (!TURNSTILE_SECRET_KEY) {
    return { success: false, error: 'TURNSTILE_SECRET_KEY not configured' };
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        secret: TURNSTILE_SECRET_KEY,
        response: token,
        ...(remoteIp && { remoteip: remoteIp })
      })
    });

    const data = await response.json();

    if (data.success) {
      return { success: true };
    } else {
      return {
        success: false,
        error: data['error-codes']?.join(', ') || 'Turnstile verification failed'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Turnstile API error'
    };
  }
}

/**
 * Check if CAPTCHA is required for a client
 * 
 * @param clientId Hashed client identifier
 * @returns true if CAPTCHA is required
 */
export async function isCaptchaRequired(clientId: string): Promise<boolean> {
  if (!CAPTCHA_ENABLED) {
    return false;
  }

  try {
    const { getRedis } = await import('./redis');
    const redis = await getRedis();
    const captchaRequired = await redis.get(`captcha_required:${clientId}`);
    return captchaRequired === '1';
  } catch (error) {
    logger.warn('Failed to check CAPTCHA requirement', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    });
    return false; // Fail open
  }
}
