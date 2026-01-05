import { VercelRequest, VercelResponse } from '@vercel/node';
// @ts-expect-error - crypto is a Node.js built-in module, types may not be available
import crypto from 'crypto';
import { checkRateLimit, RATE_LIMITS } from './rateLimit';
import { withMonitoring } from './monitoring';

// Buffer is available globally in Node.js/Vercel environments
interface Buffer extends ArrayLike<number> {
  from(data: string, encoding: 'base64' | 'hex' | 'utf8'): Buffer;
  from(data: ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  toString(encoding?: 'utf-8' | 'utf8' | 'base64' | 'hex'): string;
  length: number;
  subarray(start: number, end?: number): Buffer;
}

declare const Buffer: {
  from(data: string, encoding: 'base64' | 'hex' | 'utf8'): Buffer;
  from(data: ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  isBuffer(obj: any): boolean;
  new (data: string, encoding?: string): Buffer;
  prototype: Buffer;
};

// Encryption parameters (must match send-email.ts)
const MNEMONIC_ENCRYPTION_SALT = 'tiltvault-mnemonic-salt';
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits for AES-256
const IV_LENGTH = 12; // AES-GCM IV length
const AUTH_TAG_LENGTH = 16; // AES-GCM auth tag length

/**
 * Decrypt mnemonic using user's email as the key material
 */
function decryptMnemonic(encryptedMnemonic: string, userEmail: string): string {
  // Normalize email (lowercase, trim)
  const normalizedEmail = userEmail.toLowerCase().trim();
  
  // Derive decryption key from email using PBKDF2
  const derivedKeyBuffer = crypto.pbkdf2Sync(
    normalizedEmail,
    MNEMONIC_ENCRYPTION_SALT,
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha256'
  );
  const derivedKey = new Uint8Array(derivedKeyBuffer);
  
  // Decode base64 encrypted data
  const encryptedBuffer = Buffer.from(encryptedMnemonic, 'base64');
  
  if (encryptedBuffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted mnemonic format');
  }
  
  // Extract IV, encrypted data, and auth tag
  // Convert to Uint8Array for TypeScript compatibility with crypto functions
  const iv = new Uint8Array(encryptedBuffer.subarray(0, IV_LENGTH));
  const authTagBuffer = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LENGTH);
  const authTag = new Uint8Array(authTagBuffer);
  const encryptedDataBuffer = encryptedBuffer.subarray(IV_LENGTH, encryptedBuffer.length - AUTH_TAG_LENGTH);
  const encrypted = new Uint8Array(encryptedDataBuffer);
  
  // Decrypt using AES-256-GCM
  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);
  
  // Update and final return Buffer
  const updateResult = decipher.update(encrypted);
  const finalResult = decipher.final();
  
  // Combine results - convert to Uint8Array arrays for TypeScript compatibility
  const updateArray = new Uint8Array(updateResult);
  const finalArray = new Uint8Array(finalResult);
  const totalLength = updateArray.length + finalArray.length;
  const decryptedArray = new Uint8Array(totalLength);
  decryptedArray.set(updateArray, 0);
  decryptedArray.set(finalArray, updateArray.length);
  
  // Convert back to Buffer for toString
  return Buffer.from(decryptedArray.buffer).toString('utf8');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await withMonitoring(req, res, 'decrypt-mnemonic', async (): Promise<void> => {
    // Rate limit per email
    const { encryptedMnemonic, email } = req.body;

    const rateLimitResult = await checkRateLimit(req, {
      ...RATE_LIMITS.DECRYPT_MNEMONIC,
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

    // Decrypt mnemonic
    const mnemonic = decryptMnemonic(encryptedMnemonic, email);

    // Validate mnemonic format (should be 12 or 24 words)
    const words = mnemonic.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      res.status(400).json({ 
        error: 'Invalid mnemonic format - decryption may have failed' 
      });
      return;
    }

    // Never log the decrypted mnemonic
    console.log('[Decrypt Mnemonic] Successfully decrypted mnemonic for:', email);

    res.status(200).json({
      success: true,
      mnemonic: mnemonic
    });

  });
}

