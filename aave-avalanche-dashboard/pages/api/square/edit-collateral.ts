import { VercelRequest, VercelResponse } from '@vercel/node';
import { editGmxCollateral } from '../../../api/square/webhook';
import { getWalletKey, deleteWalletKey, decryptWalletKeyWithAuth } from '../../../api/wallet/keystore';

/**
 * Handle edit collateral request
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
    const { walletAddress, collateralDeltaUsd, isDeposit, userEmail } = req.body;

    if (!walletAddress || collateralDeltaUsd === undefined || isDeposit === undefined || !userEmail) {
      return res.status(400).json({ success: false, error: 'Missing required parameters (walletAddress, collateralDeltaUsd, isDeposit, userEmail)' });
    }

    // SECURITY: Retrieve encrypted key and decrypt with user authentication
    const encryptedData = await getWalletKey(walletAddress);
    if (!encryptedData) {
      return res.status(404).json({ success: false, error: 'Wallet key not found or expired' });
    }

    // Decrypt with user authentication (verifies email matches)
    const walletData = decryptWalletKeyWithAuth(encryptedData, userEmail, encryptedData.paymentId);
    const { privateKey } = walletData;

    // Execute collateral edit
    const result = await editGmxCollateral(collateralDeltaUsd, isDeposit, privateKey);

    // Delete the encrypted key after execution (security)
    await deleteWalletKey(walletAddress);

    return res.status(200).json(result);
  } catch (error) {
    console.error('[EditCollateral] Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
}
