import type { VercelRequest, VercelResponse } from '@vercel/node';
import { storeWalletKey } from './keystore';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { walletAddress, privateKey, userEmail, riskProfile, amount } = req.body;

    // Validate required fields
    if (!walletAddress || !privateKey || !userEmail || !riskProfile || !amount) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['walletAddress', 'privateKey', 'userEmail', 'riskProfile', 'amount'],
      });
    }

    // Validate wallet address format
    if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    // Store encrypted key
    await storeWalletKey(
      walletAddress,
      privateKey,
      userEmail,
      riskProfile,
      parseFloat(amount)
    );

    console.log(`[StoreKey] Stored key for ${walletAddress}, email: ${userEmail}`);

    return res.status(200).json({
      success: true,
      message: 'Wallet key stored securely',
      walletAddress,
    });

  } catch (error) {
    console.error('[StoreKey] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
