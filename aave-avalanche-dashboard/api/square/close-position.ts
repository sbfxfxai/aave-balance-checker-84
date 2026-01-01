import { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import { closeGmxPosition } from './webhook';
import { getWalletKey, deleteWalletKey } from '../wallet/keystore';

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

    // SECURITY: Retrieve and decrypt wallet key
    const walletData = await getWalletKey(walletAddress);
    if (!walletData) {
      return res.status(404).json({ success: false, error: 'Wallet key not found or expired' });
    }

    // Validate user authentication (email and paymentId must match stored data)
    if (walletData.userEmail !== userEmail) {
      return res.status(401).json({ success: false, error: 'User email mismatch' });
    }

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
