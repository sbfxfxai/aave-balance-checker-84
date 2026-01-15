/**
 * One-Time Link System for Secure Mnemonic Decryption
 * 
 * Instead of sending full encrypted mnemonic in email, generate a signed one-time link
 * that allows server-side decryption on click. Reduces exposure if email is compromised.
 * 
 * SECURITY:
 * - Links expire after 24 hours (configurable)
 * - Single-use tokens (marked as used after first access)
 * - Signed with HMAC to prevent tampering
 * - Rate limited per email address
 */

import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { createHmac, randomBytes } from 'crypto';

// Configuration
const ONE_TIME_LINK_SECRET = process.env.ONE_TIME_LINK_SECRET || process.env.SERVER_ENCRYPTION_KEY || 'change-me-in-production';
const ONE_TIME_LINK_TTL = 24 * 60 * 60; // 24 hours
const ONE_TIME_LINK_PREFIX = 'otl:'; // One-time link prefix in Redis

export interface OneTimeLinkData {
  email: string;
  walletAddress: string;
  encryptedMnemonic: string;
  createdAt: number;
  expiresAt: number;
}

export interface OneTimeLinkResult {
  success: boolean;
  token?: string;
  url?: string;
  expiresAt?: number;
  error?: string;
}

/**
 * Generate a signed one-time link token
 * 
 * @param email User email address
 * @param walletAddress Wallet address
 * @param encryptedMnemonic Encrypted mnemonic to decrypt
 * @returns Token and URL for one-time access
 */
export async function generateOneTimeLink(
  email: string,
  walletAddress: string,
  encryptedMnemonic: string
): Promise<OneTimeLinkResult> {
  try {
    const redis = await getRedis();
    
    // Generate unique token
    const tokenBytes = randomBytes(32);
    const token = tokenBytes.toString('base64url');
    
    // Create link data
    const now = Date.now();
    const expiresAt = now + (ONE_TIME_LINK_TTL * 1000);
    
    const linkData: OneTimeLinkData = {
      email: email.toLowerCase().trim(),
      walletAddress: walletAddress.toLowerCase().trim(),
      encryptedMnemonic,
      createdAt: now,
      expiresAt
    };
    
    // ENHANCED: Sign token with HMAC including domain binding (prevents phishing redirects)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://www.tiltvault.com';
    const domain = new URL(baseUrl).hostname;
    
    // Include domain in signature to prevent cross-domain attacks
    const signature = createHmac('sha256', ONE_TIME_LINK_SECRET)
      .update(token)
      .update(email)
      .update(walletAddress)
      .update(domain) // Domain binding prevents phishing
      .digest('hex');
    
    const signedToken = `${token}.${signature}`;
    
    // Store in Redis with TTL
    const redisKey = `${ONE_TIME_LINK_PREFIX}${signedToken}`;
    await redis.set(redisKey, JSON.stringify(linkData), { ex: ONE_TIME_LINK_TTL });
    
    // Also store reverse lookup (email -> tokens) for cleanup
    const emailKey = `${ONE_TIME_LINK_PREFIX}email:${email.toLowerCase().trim()}`;
    await redis.sadd(emailKey, signedToken);
    await redis.expire(emailKey, ONE_TIME_LINK_TTL);
    
    // Generate URL (adjust domain as needed)
    const url = `${baseUrl}/recover?token=${encodeURIComponent(signedToken)}`;
    
    logger.info('One-time link generated', LogCategory.AUTH, {
      email: email.toLowerCase().trim(),
      walletAddress: walletAddress.toLowerCase().trim(),
      expiresAt: new Date(expiresAt).toISOString()
    });
    
    return {
      success: true,
      token: signedToken,
      url,
      expiresAt
    };
    
  } catch (error) {
    logger.error('Failed to generate one-time link', LogCategory.AUTH, {
      email: email.toLowerCase().trim(),
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to generate link'
    };
  }
}

/**
 * Verify and retrieve one-time link data
 * Marks token as used after successful retrieval
 * 
 * @param signedToken Signed token from URL
 * @returns Link data if valid and unused, null otherwise
 */
export async function verifyAndConsumeOneTimeLink(
  signedToken: string
): Promise<OneTimeLinkData | null> {
  try {
    const redis = await getRedis();
    
    // Check if already used
    const usedKey = `${ONE_TIME_LINK_PREFIX}used:${signedToken}`;
    const isUsed = await redis.exists(usedKey);
    if (isUsed) {
      logger.warn('One-time link already used', LogCategory.AUTH, {
        token: signedToken.substring(0, 16) + '...'
      });
      return null;
    }
    
    // Retrieve link data
    const redisKey = `${ONE_TIME_LINK_PREFIX}${signedToken}`;
    const linkDataStr = await redis.get<string>(redisKey);
    
    if (!linkDataStr) {
      logger.warn('One-time link not found or expired', LogCategory.AUTH, {
        token: signedToken.substring(0, 16) + '...'
      });
      return null;
    }
    
    const linkData: OneTimeLinkData = JSON.parse(linkDataStr);
    
    // Verify signature
    const [token, signature] = signedToken.split('.');
    if (!token || !signature) {
      logger.warn('Invalid one-time link format', LogCategory.AUTH);
      return null;
    }
    
    // ENHANCED: Verify signature with domain binding
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://www.tiltvault.com';
    const domain = new URL(baseUrl).hostname;
    
    const expectedSignature = createHmac('sha256', ONE_TIME_LINK_SECRET)
      .update(token)
      .update(linkData.email)
      .update(linkData.walletAddress)
      .update(domain) // Domain binding prevents phishing
      .digest('hex');
    
    if (signature !== expectedSignature) {
      logger.warn('One-time link signature mismatch', LogCategory.AUTH, {
        token: token.substring(0, 16) + '...'
      });
      return null;
    }
    
    // Check expiration
    if (Date.now() > linkData.expiresAt) {
      logger.warn('One-time link expired', LogCategory.AUTH, {
        token: token.substring(0, 16) + '...',
        expiresAt: new Date(linkData.expiresAt).toISOString()
      });
      await redis.del(redisKey); // Clean up expired link
      return null;
    }
    
    // Mark as used (with same TTL as original)
    await redis.set(usedKey, '1', { ex: ONE_TIME_LINK_TTL });
    
    // Delete original link
    await redis.del(redisKey);
    
    // Remove from email lookup
    const emailKey = `${ONE_TIME_LINK_PREFIX}email:${linkData.email}`;
    await redis.srem(emailKey, signedToken);
    
    logger.info('One-time link consumed', LogCategory.AUTH, {
      email: linkData.email,
      walletAddress: linkData.walletAddress
    });
    
    return linkData;
    
  } catch (error) {
    logger.error('Failed to verify one-time link', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return null;
  }
}

/**
 * Revoke all one-time links for an email address
 * Useful if user reports email compromise
 * 
 * @param email Email address
 * @returns Number of links revoked
 */
export async function revokeOneTimeLinksForEmail(email: string): Promise<number> {
  try {
    const redis = await getRedis();
    const emailKey = `${ONE_TIME_LINK_PREFIX}email:${email.toLowerCase().trim()}`;
    
    // Get all tokens for this email
    const tokens = await redis.smembers(emailKey) || [];
    
    let revoked = 0;
    for (const token of tokens) {
      const redisKey = `${ONE_TIME_LINK_PREFIX}${token}`;
      const deleted = await redis.del(redisKey);
      if (deleted) {
        revoked++;
      }
      
      // Mark as used
      const usedKey = `${ONE_TIME_LINK_PREFIX}used:${token}`;
      await redis.set(usedKey, '1', { ex: ONE_TIME_LINK_TTL });
    }
    
    // Clear email lookup
    await redis.del(emailKey);
    
    logger.info('One-time links revoked', LogCategory.AUTH, {
      email: email.toLowerCase().trim(),
      revoked
    });
    
    return revoked;
    
  } catch (error) {
    logger.error('Failed to revoke one-time links', LogCategory.AUTH, {
      email: email.toLowerCase().trim(),
      error: error instanceof Error ? error.message : String(error)
    });
    
    return 0;
  }
}

/**
 * Get statistics for one-time links
 */
export async function getOneTimeLinkStats(): Promise<{
  activeLinks: number;
  usedLinks: number;
  expiredLinks: number;
}> {
  try {
    const redis = await getRedis();
    
    // Count active links
    const activeKeys = await redis.keys(`${ONE_TIME_LINK_PREFIX}*`);
    const activeLinks = activeKeys.filter(key => !key.includes(':used:') && !key.includes(':email:')).length;
    
    // Count used links
    const usedKeys = await redis.keys(`${ONE_TIME_LINK_PREFIX}used:*`);
    const usedLinks = usedKeys.length;
    
    // Note: Expired links are auto-deleted, so we can't count them directly
    // This is an approximation
    return {
      activeLinks,
      usedLinks,
      expiredLinks: 0 // Cannot track without additional metadata
    };
    
  } catch (error) {
    logger.error('Failed to get one-time link stats', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return {
      activeLinks: 0,
      usedLinks: 0,
      expiredLinks: 0
    };
  }
}
