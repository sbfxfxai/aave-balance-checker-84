import { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';
import { verifyMessage } from 'ethers';

// Hash email for safe logging
function hashEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local.substring(0, 2)}***@${domain}`;
}

// Rate limiting with proper atomic operations
async function checkRateLimit(
  email: string, 
  redis: ReturnType<typeof getRedis>
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const key = `verify_rate_limit:${email.toLowerCase()}`;
  const data = await redis.get(key);
  
  let attempts = 0;
  let firstAttempt = Date.now();
  
  if (data) {
    const parsed = JSON.parse(data as string);
    attempts = parsed.attempts;
    firstAttempt = parsed.firstAttempt;
    
    // Check if hour has passed
    if (Date.now() - firstAttempt > 3600000) {
      // Reset counter
      attempts = 0;
      firstAttempt = Date.now();
    }
  }
  
  if (attempts >= 5) {
    const retryAfter = Math.ceil((3600000 - (Date.now() - firstAttempt)) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  
  // Increment attempts
  await redis.set(key, JSON.stringify({
    attempts: attempts + 1,
    firstAttempt,
  }), { ex: 3600 });
  
  return { allowed: true, remaining: 4 - attempts };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, code, walletAddress, signature, message } = req.body || {};

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    // Normalize and validate email
    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(normalizedEmail) || normalizedEmail.length > 254) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate code format
    const normalizedCode = String(code).trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      return res.status(400).json({ error: 'Code must be 6 digits' });
    }

    const redis = getRedis();

    // Rate limiting
    const rateLimit = await checkRateLimit(normalizedEmail, redis);
    if (!rateLimit.allowed) {
      return res.status(429).json({ 
        error: 'Too many verification attempts',
        retryAfter: rateLimit.retryAfter,
      });
    }

    // Retrieve and parse stored code data
    console.log(`[Auth] Verifying code for ${hashEmail(normalizedEmail)}`);
    const storedDataRaw = await redis.get(`auth_code:${normalizedEmail}`);
    
    if (!storedDataRaw) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    let storedData;
    try {
      storedData = JSON.parse(storedDataRaw as string);
    } catch (error) {
      console.error('[Auth] Failed to parse stored code data');
      await redis.del(`auth_code:${normalizedEmail}`);
      return res.status(500).json({ error: 'Internal server error' });
    }

    const { code: storedCode, attempts, createdAt } = storedData;

    // Check attempt limit
    if (attempts >= 5) {
      await redis.del(`auth_code:${normalizedEmail}`);
      return res.status(429).json({ 
        error: 'Maximum attempts exceeded. Please request a new code.' 
      });
    }

    // Verify code
    if (storedCode !== normalizedCode) {
      console.error(`[Auth] Invalid code attempt for ${hashEmail(normalizedEmail)}`);
      
      // Increment attempts
      storedData.attempts += 1;
      
      // Calculate remaining TTL
      const elapsed = Date.now() - createdAt;
      const remainingTTL = Math.max(0, Math.ceil((600000 - elapsed) / 1000));
      
      if (remainingTTL > 0) {
        await redis.set(
          `auth_code:${normalizedEmail}`, 
          JSON.stringify(storedData),
          { ex: remainingTTL }
        );
      }
      
      // Ensure consistent timing
      const responseTime = Date.now() - startTime;
      if (responseTime < 100) {
        await new Promise(resolve => setTimeout(resolve, 100 - responseTime));
      }
      
      return res.status(400).json({ 
        error: 'Invalid or expired code',
        attemptsRemaining: Math.max(0, 5 - storedData.attempts)
      });
    }

    // Code is valid - clear rate limit and code
    await redis.del(`verify_rate_limit:${normalizedEmail}`);
    await redis.del(`auth_code:${normalizedEmail}`);

    // Handle wallet linking (if provided)
    let validatedWalletAddress: string | null = null;
    
    if (walletAddress) {
      // Validate wallet address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
      }

      // Require signature to prove wallet ownership
      if (!signature || !message) {
        return res.status(400).json({ 
          error: 'Wallet signature required to link wallet' 
        });
      }

      try {
        // Verify signature
        const recoveredAddress = verifyMessage(message, signature);
        if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          return res.status(401).json({ 
            error: 'Invalid wallet signature' 
          });
        }

        // Verify message format
        const expectedMessage = `Link wallet ${walletAddress.toLowerCase()} to ${normalizedEmail}`;
        if (!message.includes(normalizedEmail) || !message.includes(walletAddress.toLowerCase())) {
          return res.status(401).json({ 
            error: 'Invalid signature message' 
          });
        }

        validatedWalletAddress = walletAddress.toLowerCase();

        // Check for existing links
        const existingWallet = await redis.get(`email_wallet:${normalizedEmail}`);
        if (existingWallet && existingWallet !== validatedWalletAddress) {
          return res.status(409).json({
            error: 'Email already linked to a different wallet',
          });
        }

        const existingEmail = await redis.get(`wallet_email:${validatedWalletAddress}`);
        if (existingEmail && existingEmail !== normalizedEmail) {
          return res.status(409).json({
            error: 'Wallet already linked to a different email',
          });
        }

        // Create bidirectional link
        const linkTTL = 365 * 24 * 60 * 60; // 1 year
        await redis.set(`email_wallet:${normalizedEmail}`, validatedWalletAddress, { ex: linkTTL });
        await redis.set(`wallet_email:${validatedWalletAddress}`, normalizedEmail, { ex: linkTTL });

        console.log(`[Auth] Linked ${hashEmail(normalizedEmail)} to wallet ${validatedWalletAddress}`);
      } catch (error) {
        console.error('[Auth] Wallet signature verification failed:', error);
        return res.status(401).json({ 
          error: 'Signature verification failed' 
        });
      }
    } else {
      // Check for existing linked wallet
      const linkedWallet = await redis.get(`email_wallet:${normalizedEmail}`);
      if (linkedWallet) {
        validatedWalletAddress = linkedWallet as string;
      }
    }

    // Create session metadata
    const sessionData = {
      email: normalizedEmail,
      walletAddress: validatedWalletAddress,
      verifiedAt: new Date().toISOString(),
      ipAddress: (req.headers['x-forwarded-for'] as string) || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    };

    // Store session (24 hour expiry)
    await redis.set(
      `auth_session:${normalizedEmail}:${Date.now()}`,
      JSON.stringify(sessionData),
      { ex: 24 * 60 * 60 }
    );

    const userData = {
      email: normalizedEmail,
      walletAddress: validatedWalletAddress,
      hasConnectedWallet: !!validatedWalletAddress,
      verifiedAt: sessionData.verifiedAt,
    };

    console.log(`[Auth] Successful verification for ${hashEmail(normalizedEmail)}`);

    // Ensure consistent timing
    const responseTime = Date.now() - startTime;
    if (responseTime < 100) {
      await new Promise(resolve => setTimeout(resolve, 100 - responseTime));
    }

    return res.status(200).json({
      success: true,
      user: userData,
    });

  } catch (error) {
    console.error('[Auth] Error verifying code:', error);
    
    // Ensure consistent timing even on error
    const responseTime = Date.now() - startTime;
    if (responseTime < 100) {
      await new Promise(resolve => setTimeout(resolve, 100 - responseTime));
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to verify code';
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    });
  }
}
