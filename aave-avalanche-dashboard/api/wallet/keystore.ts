import crypto from 'crypto';

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

interface StoredWalletData {
  encryptedPrivateKey: string;
  iv: string;
  authTag: string;
  walletAddress: string;
  userEmail: string;
  riskProfile: string;
  amount: number;
  createdAt: string;
  paymentId?: string;
}

/**
 * Encrypt a private key using AES-256-GCM
 */
function encryptPrivateKey(privateKey: string): { encrypted: string; iv: string; authTag: string } {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error('WALLET_ENCRYPTION_KEY must be at least 32 characters');
  }

  // Use first 32 bytes of key for AES-256
  const keyBuffer = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf-8') as Uint8Array;
  const key = crypto.createSecretKey(keyBuffer);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv as Uint8Array);
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

  const keyBuffer = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf-8') as Uint8Array;
  const key = crypto.createSecretKey(keyBuffer);
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'hex') as Uint8Array
  );
  decipher.setAuthTag(Buffer.from(authTag, 'hex') as Uint8Array);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Store encrypted wallet data in Vercel KV
 * Key format: wallet:{walletAddress}
 */
export async function storeWalletKey(
  walletAddress: string,
  privateKey: string,
  userEmail: string,
  riskProfile: string,
  amount: number,
  paymentId?: string
): Promise<void> {
  console.log(`[Keystore] Storing encrypted key for wallet ${walletAddress}`);

  const { encrypted, iv, authTag } = encryptPrivateKey(privateKey);

  const data: StoredWalletData = {
    encryptedPrivateKey: encrypted,
    iv,
    authTag,
    walletAddress,
    userEmail,
    riskProfile,
    amount,
    createdAt: new Date().toISOString(),
    paymentId,
  };

  // Store with TTL - key auto-deletes after 24 hours
  const redis = await getRedis();
  await redis.set(`wallet:${walletAddress.toLowerCase()}`, JSON.stringify(data), {
    ex: KEY_TTL_SECONDS,
  });

  console.log(`[Keystore] Key stored with ${KEY_TTL_SECONDS}s TTL`);
}

/**
 * Retrieve and decrypt wallet private key from Vercel KV
 */
export async function getWalletKey(walletAddress: string): Promise<{
  privateKey: string;
  userEmail: string;
  riskProfile: string;
  amount: number;
  paymentId?: string;
} | null> {
  console.log(`[Keystore] Retrieving key for wallet ${walletAddress}`);

  const redis = await getRedis();
  const dataStr = await redis.get(`wallet:${walletAddress.toLowerCase()}`);
  if (!dataStr) {
    console.log(`[Keystore] No key found for wallet ${walletAddress}`);
    return null;
  }

  const data: StoredWalletData = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;

  try {
    const privateKey = decryptPrivateKey(data.encryptedPrivateKey, data.iv, data.authTag);
    console.log(`[Keystore] Key decrypted successfully`);

    return {
      privateKey,
      userEmail: data.userEmail,
      riskProfile: data.riskProfile,
      amount: data.amount,
      paymentId: data.paymentId,
    };
  } catch (error) {
    console.error(`[Keystore] Decryption failed:`, error);
    return null;
  }
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
 */
export async function updateWalletPaymentId(
  walletAddress: string,
  paymentId: string
): Promise<boolean> {
  const redis = await getRedis();
  const dataStr = await redis.get(`wallet:${walletAddress.toLowerCase()}`);
  if (!dataStr) return false;

  const data: StoredWalletData = typeof dataStr === 'string' ? JSON.parse(dataStr) : dataStr;
  data.paymentId = paymentId;

  // Get remaining TTL and preserve it
  const ttl = await redis.ttl(`wallet:${walletAddress.toLowerCase()}`);
  await redis.set(`wallet:${walletAddress.toLowerCase()}`, JSON.stringify(data), {
    ex: ttl > 0 ? ttl : KEY_TTL_SECONDS,
  });

  return true;
}
