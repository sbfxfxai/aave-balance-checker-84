import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import crypto from 'crypto';

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

/**
 * Decrypt mnemonic phrase using user authentication
 */
function decryptMnemonic(encryptedData: string, userEmail: string, paymentId: string): {
  mnemonic: string;
  privateKey: string;
  publicKey: string;
} {
  try {
    // Derive encryption key from user email and payment ID
    const keyMaterial = `${userEmail.toLowerCase()}:${paymentId}`;
    const key = crypto.pbkdf2Sync(keyMaterial, 'salt', 10000, 32, 'sha256');
    
    // Parse encrypted data
    const parts = encryptedData.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted data format');
    }
    
    const [ivHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    
    // Decrypt
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    const walletData = JSON.parse(decrypted.toString());
    
    return {
      mnemonic: walletData.mnemonic,
      privateKey: walletData.privateKey,
      publicKey: walletData.publicKey
    };
  } catch (error) {
    throw new Error(`Failed to decrypt mnemonic: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * POST /api/wallet/decrypt-mnemonic
 * Decrypts stored mnemonic phrase for authenticated user
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { walletAddress, userEmail, paymentId } = req.body;

    if (!walletAddress || !userEmail || !paymentId) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['walletAddress', 'userEmail', 'paymentId']
      });
    }

    // Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const redis = getRedis();
    const normalizedWallet = walletAddress.toLowerCase();

    // Retrieve encrypted wallet data
    const encryptedData = await redis.get(`wallet_key:${normalizedWallet}`);
    if (!encryptedData) {
      return res.status(404).json({ error: 'Wallet key not found or expired' });
    }

    // Verify user association
    const associatedUser = await redis.get(`wallet_user:${normalizedWallet}`);
    if (!associatedUser || associatedUser !== userEmail.toLowerCase()) {
      return res.status(403).json({ error: 'User not authorized to access this wallet' });
    }

    // Decrypt mnemonic
    const walletData = decryptMnemonic(encryptedData as string, userEmail, paymentId);

    console.log(`[Wallet Decrypt] Successfully decrypted wallet for ${userEmail}`);

    return res.status(200).json({
      success: true,
      walletAddress: normalizedWallet,
      publicKey: walletData.publicKey,
      // Note: Never return mnemonic or private key in response
      // This would be a security risk - only use server-side
    });

  } catch (error) {
    console.error('[Wallet Decrypt] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
