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
    const { walletAddress, encryptedPrivateKey, userEmail, riskProfile, amount, paymentId } = req.body;

    // Validate required fields
    if (!walletAddress || !encryptedPrivateKey || !userEmail || !riskProfile || !amount || !paymentId) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['walletAddress', 'encryptedPrivateKey', 'userEmail', 'riskProfile', 'amount', 'paymentId'],
      });
    }

    // Validate wallet address format
    if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    // Store encrypted key only (non-custodial)
    await storeWalletKey(
      walletAddress,
      encryptedPrivateKey,
      userEmail,
      riskProfile,
      parseFloat(amount),
      paymentId
    );

    console.log(`[StoreKey] Stored encrypted key for ${walletAddress}, email: ${userEmail}, paymentId: ${paymentId}`);

    return res.status(200).json({
      success: true,
      message: 'Encrypted wallet stored securely (non-custodial)',
      walletAddress,
      paymentId,
    });

  } catch (error) {
    console.error('[StoreKey] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
