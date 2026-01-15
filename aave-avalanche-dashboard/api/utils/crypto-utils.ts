/**
 * Cryptographic Utilities for Security Operations
 * 
 * Provides constant-time comparison and secure random generation
 * to prevent timing attacks and ensure cryptographic security.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * Constant-time string comparison to prevent timing attacks
 * Uses Node.js timingSafeEqual for secure comparison
 * 
 * @param a First string to compare
 * @param b Second string to compare
 * @returns true if strings are equal, false otherwise
 */
export function constantTimeCompare(a: string, b: string): boolean {
  try {
    // Convert strings to buffers for timing-safe comparison
    const aBuffer = Buffer.from(a, 'utf8');
    const bBuffer = Buffer.from(b, 'utf8');
    
    // If lengths differ, use timing-safe comparison anyway to prevent timing leaks
    if (aBuffer.length !== bBuffer.length) {
      // Still do comparison to maintain constant time
      timingSafeEqual(aBuffer, Buffer.alloc(aBuffer.length));
      return false;
    }
    
    return timingSafeEqual(aBuffer, bBuffer);
  } catch (error) {
    // On error, return false (fail secure)
    return false;
  }
}

/**
 * Constant-time buffer comparison
 * 
 * @param a First buffer to compare
 * @param b Second buffer to compare
 * @returns true if buffers are equal, false otherwise
 */
export function constantTimeBufferCompare(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  try {
    const aBuffer = Buffer.isBuffer(a) ? a : Buffer.from(a);
    const bBuffer = Buffer.isBuffer(b) ? b : Buffer.from(b);
    
    if (aBuffer.length !== bBuffer.length) {
      // Still do comparison to maintain constant time
      timingSafeEqual(aBuffer, Buffer.alloc(aBuffer.length));
      return false;
    }
    
    return timingSafeEqual(aBuffer, bBuffer);
  } catch (error) {
    return false;
  }
}

/**
 * Generate cryptographically secure random salt
 * 
 * @param length Salt length in bytes (default: 32)
 * @returns Random salt as base64 string
 */
export function generateSecureSalt(length: number = 32): string {
  return randomBytes(length).toString('base64');
}

/**
 * Generate per-user salt from user identifier
 * Uses HMAC to derive deterministic but unique salt per user
 * 
 * @param userIdentifier User email or wallet address
 * @param masterSalt Master salt for HMAC (from environment)
 * @returns Per-user salt as base64 string
 */
export function generatePerUserSalt(
  userIdentifier: string,
  masterSalt: string = process.env.USER_SALT_MASTER || 'tiltvault-user-salt-master'
): string {
  const normalized = userIdentifier.toLowerCase().trim();
  const hmac = createHmac('sha256', masterSalt);
  hmac.update(normalized);
  return hmac.digest('base64');
}

/**
 * Secure random token generation
 * 
 * @param length Token length in bytes (default: 32)
 * @returns Random token as base64url string (URL-safe)
 */
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('base64url');
}

/**
 * Hash identifier for privacy-compliant storage
 * 
 * @param identifier Original identifier (email, wallet, etc.)
 * @param truncateLength Length to truncate hash (default: 16)
 * @returns Hashed and truncated identifier
 */
export function hashIdentifier(identifier: string, truncateLength: number = 16): string {
  const crypto = require('crypto');
  return crypto
    .createHash('sha256')
    .update(identifier.toLowerCase().trim())
    .digest('hex')
    .substring(0, truncateLength);
}
