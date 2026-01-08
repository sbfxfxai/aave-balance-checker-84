// @ts-ignore - crypto is a Node.js built-in module, types may not be available
import crypto from 'crypto';

// Buffer is available globally in Node.js/Vercel environments
interface Buffer extends ArrayLike<number> {
  from(data: string, encoding: 'base64' | 'hex' | 'utf8' | 'utf-8'): Buffer;
  from(data: ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  toString(encoding?: 'utf-8' | 'utf8' | 'base64' | 'hex'): string;
  length: number;
  subarray(start: number, end?: number): Buffer;
}

declare const Buffer: {
  from(data: string, encoding: 'base64' | 'hex' | 'utf8' | 'utf-8'): Buffer;
  from(data: ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  isBuffer(obj: any): boolean;
  new (data: string, encoding?: string): Buffer;
  prototype: Buffer;
};

// Lazy-initialize Upstash Redis client
let _redis: any = null;
async function getRedis(): Promise<any> {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      throw new Error('Redis not configured: KV_REST_API_URL and KV_REST_API_TOKEN required');
    }
    
    // Dynamic import to avoid module load issues
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
  }
  return _redis;
}

// Encryption key from environment (32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.WALLET_ENCRYPTION_KEY || '';
const KEY_TTL_SECONDS = 24 * 60 * 60; // 24 hours - keys auto-expire

// Client-side encryption parameters (mirrors frontend DepositModal.tsx)
const CLIENT_SIDE_SALT = 'tiltvault-salt';
const CLIENT_SIDE_PBKDF2_ITERATIONS = 100_000;
const CLIENT_SIDE_KEY_LENGTH = 32; // 256 bits
const CLIENT_SIDE_IV_LENGTH = 12; // AES-GCM default IV
const CLIENT_SIDE_AUTH_TAG_LENGTH = 16; // AES-GCM default auth tag

interface StoredWalletData {
  encryptedPrivateKey: string; // Already encrypted client-side using userEmail + paymentId
  walletAddress: string;
  riskProfile: string;
  amount: number;
  createdAt: string;
  // Note: userEmail and paymentId are NOT stored here - they're in payment_info and auth tokens
  // This prevents redundant storage and reduces attack surface
}

/**
 * Encrypt a private key using AES-256-GCM
 */
function encryptPrivateKey(privateKey: string): { encrypted: string; iv: string; authTag: string } {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error('WALLET_ENCRYPTION_KEY must be at least 32 characters');
  }

  // Use first 32 bytes of key for AES-256
  const key = new Uint8Array(Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf-8'));
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, new Uint8Array(iv));
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt a private key using AES-256-GCM
 */
function decryptPrivateKey(encrypted: string, iv: string, authTag: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error('WALLET_ENCRYPTION_KEY must be at least 32 characters');
  }

  const key = new Uint8Array(Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf-8'));
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    new Uint8Array(Buffer.from(iv, 'hex'))
  );
  decipher.setAuthTag(new Uint8Array(Buffer.from(authTag, 'hex')));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Store client-side encrypted wallet data in Vercel KV (non-custodial)
 * Key format: wallet:{walletAddress}
 * 
 * @returns Authorization token for one-time decryption (for webhook flows)
 */
export async function storeWalletKey(
  walletAddress: string,
  encryptedPrivateKey: string, // Already encrypted client-side using userEmail + paymentId
  userEmail: string,
  riskProfile: string,
  amount: number,
  paymentId: string
): Promise<string> {
  console.log(`[Keystore] Storing client-side encrypted key for wallet ${walletAddress}`);

  // SECURITY: Don't store userEmail and paymentId with encrypted key
  // They're already stored in payment_info and auth tokens
  // This reduces redundant storage and attack surface
  const data: StoredWalletData = {
    encryptedPrivateKey, // Store as-is (already encrypted using userEmail + paymentId)
    walletAddress,
    riskProfile,
    amount,
    createdAt: new Date().toISOString(),
  };

  // Store with TTL - key auto-deletes after 24 hours
  const redis = await getRedis();
  await redis.set(`wallet:${walletAddress.toLowerCase()}`, JSON.stringify(data), {
    ex: KEY_TTL_SECONDS,
  });

  // Create authorization token for webhook decryption (one-time use, 1 hour expiry)
  // Token stores userEmail and paymentId for decryption
  const authToken = await createDecryptionAuthToken(walletAddress, userEmail, paymentId);
  
  // Also store token indexed by paymentId for webhook lookup
  await redis.set(`payment_auth:${paymentId}`, authToken, { ex: 3600 });

  console.log(`[Keystore] Client-encrypted key stored (without email/paymentId) with ${KEY_TTL_SECONDS}s TTL, auth token created`);
  
  return authToken;
}

export interface RetrievedWalletKeyData {
  walletAddress: string;
  encryptedPrivateKey: string;
  privateKey?: string; // Only set if explicitly decrypted with authentication
  riskProfile: string;
  amount: number;
  // Note: userEmail and paymentId are provided during decryption but not stored in wallet data
}

export interface EncryptedWalletData {
  walletAddress: string;
  encryptedPrivateKey: string;
  riskProfile: string;
  amount: number;
  createdAt: string;
  // Note: userEmail and paymentId are NOT stored here - get them from payment_info or auth token
}

function decryptClientEncryptedKey(
  encryptedBase64: string,
  userEmail: string,
  paymentId: string
): string {
  if (!userEmail || !paymentId) {
    throw new Error('Missing email or paymentId for client-side key decryption');
  }

  const combined = Buffer.from(encryptedBase64, 'base64');
  if (combined.length <= CLIENT_SIDE_IV_LENGTH + CLIENT_SIDE_AUTH_TAG_LENGTH) {
    throw new Error('Encrypted private key payload is malformed');
  }

  const iv = new Uint8Array(combined.subarray(0, CLIENT_SIDE_IV_LENGTH));
  const cipherWithTag = combined.subarray(CLIENT_SIDE_IV_LENGTH);
  const authTag = new Uint8Array(
    cipherWithTag.subarray(cipherWithTag.length - CLIENT_SIDE_AUTH_TAG_LENGTH)
  );
  const ciphertext = new Uint8Array(
    cipherWithTag.subarray(0, cipherWithTag.length - CLIENT_SIDE_AUTH_TAG_LENGTH)
  );

  const keyMaterial = `${userEmail}${paymentId}`;
  const derivedKey = crypto.pbkdf2Sync(
    keyMaterial,
    CLIENT_SIDE_SALT,
    CLIENT_SIDE_PBKDF2_ITERATIONS,
    CLIENT_SIDE_KEY_LENGTH,
    'sha256'
  );
  const derivedKeyBytes = new Uint8Array(derivedKey);

  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKeyBytes, iv);
  decipher.setAuthTag(authTag);

  const decryptedParts = [new Uint8Array(decipher.update(ciphertext)), new Uint8Array(decipher.final())];
  const totalLength = decryptedParts.reduce((sum, part) => sum + part.length, 0);
  const decrypted = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of decryptedParts) {
    decrypted.set(part, offset);
    offset += part.length;
  }
  return Buffer.from(decrypted).toString('utf8');
}

/**
 * Retrieve client-side encrypted wallet data from Vercel KV (non-custodial)
 * Returns encrypted data only - does NOT decrypt automatically for security.
 * Use decryptWalletKeyWithAuth() to decrypt with proper authentication.
 */
export async function getWalletKey(walletAddress: string): Promise<EncryptedWalletData | null> {
  console.log(`[Keystore] Retrieving encrypted key for wallet ${walletAddress}`);

  const redis = await getRedis();
  const dataStr = await redis.get(`wallet:${walletAddress.toLowerCase()}`);
  if (!dataStr) {
    console.log(`[Keystore] No key found for wallet ${walletAddress}`);
    return null;
  }

  const data: StoredWalletData = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;

  console.log(`[Keystore] Encrypted key retrieved (non-custodial, not decrypted)`);

  return {
    walletAddress: data.walletAddress,
    encryptedPrivateKey: data.encryptedPrivateKey,
    riskProfile: data.riskProfile,
    amount: data.amount,
    createdAt: data.createdAt,
  };
}

/**
 * Decrypt wallet key with authentication.
 * SECURITY: Requires userEmail and paymentId to be provided explicitly.
 * These are used to derive the decryption key (same as encryption).
 * 
 * @param encryptedData - Encrypted wallet data from getWalletKey()
 * @param userEmail - User's email (used for key derivation)
 * @param paymentId - Payment ID (used for key derivation)
 * @returns Decrypted wallet data with private key
 */
export function decryptWalletKeyWithAuth(
  encryptedData: EncryptedWalletData,
  userEmail: string,
  paymentId: string
): RetrievedWalletKeyData {
  console.log(`[Keystore] Decrypting key for ${userEmail} with authentication`);

  // Decrypt using provided email and paymentId (same as encryption)
  const privateKey = decryptClientEncryptedKey(
    encryptedData.encryptedPrivateKey,
    userEmail,
    paymentId
  );

  return {
    walletAddress: encryptedData.walletAddress,
    encryptedPrivateKey: encryptedData.encryptedPrivateKey,
    privateKey,
    riskProfile: encryptedData.riskProfile,
    amount: encryptedData.amount,
  };
}

/**
 * Create a time-limited authorization token for automated decryption.
 * Used for webhook flows where user has already authorized the transaction.
 * Token expires after 1 hour.
 * 
 * @param walletAddress - Wallet address
 * @param userEmail - User's email
 * @param paymentId - Payment ID
 * @returns Authorization token
 */
export async function createDecryptionAuthToken(
  walletAddress: string,
  userEmail: string,
  paymentId: string
): Promise<string> {
  const redis = await getRedis();
  const token = crypto.randomBytes(32).toString('hex');
  const tokenKey = `decrypt_auth:${token}`;
  
  // Store token with 1 hour expiry
  await redis.set(tokenKey, JSON.stringify({
    walletAddress: walletAddress.toLowerCase(),
    userEmail: userEmail.toLowerCase(),
    paymentId,
    createdAt: new Date().toISOString(),
  }), { ex: 3600 }); // 1 hour
  
  console.log(`[Keystore] Created decryption auth token for ${walletAddress}`);
  return token;
}

/**
 * Decrypt wallet key using an authorization token.
 * Used for automated flows (webhooks) where user has pre-authorized.
 * 
 * @param walletAddress - Wallet address
 * @param authToken - Authorization token from createDecryptionAuthToken() or paymentId
 * @returns Decrypted wallet data
 */
export async function decryptWalletKeyWithToken(
  walletAddress: string,
  authToken: string
): Promise<RetrievedWalletKeyData | null> {
  const redis = await getRedis();
  
  // Try to get token from paymentId if authToken looks like a paymentId
  let actualToken = authToken;
  const paymentToken = await redis.get(`payment_auth:${authToken}`);
  if (paymentToken) {
    actualToken = paymentToken as string;
  }
  
  const tokenKey = `decrypt_auth:${actualToken}`;
  const tokenDataStr = await redis.get(tokenKey);
  
  if (!tokenDataStr) {
    console.error(`[Keystore] Invalid or expired auth token`);
    return null;
  }

  const tokenData = typeof tokenDataStr === 'string' ? JSON.parse(tokenDataStr) : tokenDataStr;
  
  // Verify wallet address matches
  if (tokenData.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    console.error(`[Keystore] Wallet address mismatch in auth token`);
    return null;
  }

  // Get encrypted wallet data
  const encryptedData = await getWalletKey(walletAddress);
  if (!encryptedData) {
    console.error(`[Keystore] Wallet data not found`);
    return null;
  }

  // Decrypt using token data
  const decrypted = decryptWalletKeyWithAuth(
    encryptedData,
    tokenData.userEmail,
    tokenData.paymentId
  );

  // Delete token after use (one-time use)
  await redis.del(tokenKey);
  if (paymentToken) {
    await redis.del(`payment_auth:${authToken}`);
  }
  console.log(`[Keystore] Decrypted key using auth token (token deleted)`);

  return decrypted;
}

/**
 * Delete wallet key from Vercel KV (after strategy execution)
 */
export async function deleteWalletKey(walletAddress: string): Promise<boolean> {
  console.log(`[Keystore] Deleting key for wallet ${walletAddress}`);

  const redis = await getRedis();
  const result = await redis.del(`wallet:${walletAddress.toLowerCase()}`);
  const deleted = result > 0;

  if (deleted) {
    console.log(`[Keystore] Key deleted successfully`);
  } else {
    console.log(`[Keystore] No key found to delete`);
  }

  return deleted;
}

/**
 * Check if a wallet key exists (without decrypting)
 */
export async function hasWalletKey(walletAddress: string): Promise<boolean> {
  const redis = await getRedis();
  const exists = await redis.exists(`wallet:${walletAddress.toLowerCase()}`);
  return exists > 0;
}

/**
 * Update wallet data with payment ID when payment is initiated
 * NOTE: This function is deprecated - paymentId is now stored in payment_info, not with wallet key
 * Keeping for backward compatibility but it's a no-op now
 */
export async function updateWalletPaymentId(
  walletAddress: string,
  paymentId: string
): Promise<boolean> {
  // No-op: paymentId is stored in payment_info, not with wallet key
  // This function is kept for backward compatibility
  console.log(`[Keystore] updateWalletPaymentId called (deprecated - paymentId stored in payment_info)`);
  return true;
}
