import { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { closeGmxPosition } from './webhook';
import { getWalletKey, deleteWalletKey, decryptWalletKeyWithAuth } from '../wallet/keystore';

function getRedis(): Redis {
  return new Redis({
    url: process.env.KV_REST_API_URL || process.env.REDIS_URL || '',
    token: process.env.KV_REST_API_TOKEN || '',
  });
}

/**
 * Handle close position request
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Square-Signature');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { walletAddress, userEmail, paymentId } = req.body;

    if (!walletAddress || !userEmail || !paymentId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters (walletAddress, userEmail, paymentId)' 
      });
    }

    // SECURITY: Retrieve encrypted key
    const encryptedData = await getWalletKey(walletAddress);
    if (!encryptedData) {
      return res.status(404).json({ success: false, error: 'Wallet key not found or expired' });
    }

    // Decrypt with user authentication (requires email and paymentId for key derivation)
    // Note: paymentId is no longer stored with wallet key - it must be provided
    const walletData = decryptWalletKeyWithAuth(encryptedData, userEmail, paymentId);
    const { privateKey } = walletData;

    if (!privateKey) {
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to decrypt private key' 
      });
    }

    // Execute position close
    const result = await closeGmxPosition(privateKey);

    // Delete the encrypted key after execution (security)
    await deleteWalletKey(walletAddress);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[ClosePosition] Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}
