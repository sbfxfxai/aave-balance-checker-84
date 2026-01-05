import { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';

// Rate limiting: Max 5 verification attempts per email per hour
async function checkRateLimit(email: string, redis: ReturnType<typeof getRedis>): Promise<boolean> {
  const rateLimitKey = `verify_rate_limit:${email.toLowerCase()}`;
  // @ts-expect-error - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
  const attempts = await redis.get(rateLimitKey);
  const attemptCount = attempts ? parseInt(attempts as string, 10) : 0;
  
  if (attemptCount >= 5) {
    return false; // Rate limit exceeded
  }
  
  // Increment counter
  // @ts-expect-error - @upstash/redis types may not include incr method in some TypeScript versions, but it exists at runtime
  await redis.incr(rateLimitKey);
  // @ts-expect-error - @upstash/redis types may not include expire method in some TypeScript versions, but it exists at runtime
  await redis.expire(rateLimitKey, 3600); // 1 hour expiry
  
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Validate request body
    if (!req.body) {
      return res.status(400).json({ error: 'Request body is required' });
    }

    const { email, code, walletAddress } = req.body;

    if (!email || !code) {
      console.error('[Auth] Missing required fields:', { hasEmail: !!email, hasCode: !!code });
      return res.status(400).json({ error: 'Email and code are required' });
    }

    // Normalize email (lowercase and trim)
    const normalizedEmail = email.toLowerCase().trim();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Normalize code (trim whitespace, ensure it's a string)
    const normalizedCode = String(code).trim();

    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(normalizedCode)) {
      return res.status(400).json({ error: 'Code must be 6 digits' });
    }

    const redis = getRedis();

    // SECURITY: Rate limiting - prevent brute force attacks
    const rateLimitOk = await checkRateLimit(normalizedEmail, redis);
    if (!rateLimitOk) {
      console.error(`[Auth] Rate limit exceeded for ${normalizedEmail}`);
      return res.status(429).json({ 
        error: 'Too many verification attempts. Please try again in 1 hour.' 
      });
    }

    // Debug: Check what's stored
    console.log(`[Auth] Verifying code for ${normalizedEmail}`);
    // @ts-expect-error - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
    const storedCodeRaw = await redis.get(`auth_code:${normalizedEmail}`);
    const storedCode = storedCodeRaw ? String(storedCodeRaw).trim() : null;
    console.log(`[Auth] Stored code: ${storedCode}, Provided code: ${normalizedCode}`);
    
    if (!storedCode) {
      console.error(`[Auth] No code found for ${normalizedEmail}`);
      return res.status(400).json({ error: 'Code not found or expired' });
    }

    if (storedCode !== normalizedCode) {
      console.error(`[Auth] Code mismatch for ${normalizedEmail}: stored="${storedCode}", provided="${normalizedCode}"`);
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Delete the code after use
    // @ts-expect-error - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
    await redis.del(`auth_code:${normalizedEmail}`);

    // Validate wallet address if provided (for MetaMask login)
    let validatedWalletAddress: string | null = null;
    if (walletAddress) {
      // Validate Ethereum address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
      }
      validatedWalletAddress = walletAddress.toLowerCase();
    }

    // Store email + wallet mapping (if wallet provided)
    if (validatedWalletAddress) {
      const emailWalletKey = `email_wallet:${normalizedEmail}`;
      // @ts-expect-error - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
      await redis.set(emailWalletKey, validatedWalletAddress, { ex: 365 * 24 * 60 * 60 }); // 1 year
      
      const walletEmailKey = `wallet_email:${validatedWalletAddress}`;
      // @ts-expect-error - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
      await redis.set(walletEmailKey, normalizedEmail, { ex: 365 * 24 * 60 * 60 }); // 1 year
      
      console.log(`[Auth] Linked email ${normalizedEmail} to wallet ${validatedWalletAddress}`);
    }

    // Get existing wallet data if any (for backward compatibility)
    const walletKey = `tiltvault_wallet:${normalizedEmail}`;
    // @ts-expect-error - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
    const walletDataRaw = await redis.get(walletKey);
    
    let walletData = null;
    if (walletDataRaw) {
      try {
        walletData = typeof walletDataRaw === 'string' ? JSON.parse(walletDataRaw) : walletDataRaw;
      } catch (parseError) {
        console.error(`[Auth] Error parsing wallet data:`, parseError);
      }
    }

    // Return user data with connected wallet
    const userData = {
      email: normalizedEmail,
      walletAddress: validatedWalletAddress || walletData?.walletAddress || null,
      hasConnectedWallet: !!validatedWalletAddress,
      createdAt: new Date().toISOString()
    };

    console.log(`[Auth] Successful login for ${normalizedEmail}${validatedWalletAddress ? ` with wallet ${validatedWalletAddress}` : ''}`);

    return res.status(200).json({
      success: true,
      user: userData
    });

  } catch (error) {
    console.error('[Auth] Error verifying code:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to verify code';
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
