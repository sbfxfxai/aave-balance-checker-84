import { editGmxCollateral } from '../../../api/square/webhook';
import { getWalletKey, deleteWalletKey, decryptWalletKeyWithAuth } from '../../../api/wallet/keystore';

// Type definitions for Vercel API routes
type VercelRequest = {
  method?: string;
  body?: any;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string | string[] | undefined>;
};

type VercelResponse = {
  status: (code: number) => VercelResponse;
  json: (data: any) => void;
  setHeader: (name: string, value: string) => void;
};

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
    const { walletAddress, collateralDeltaUsd, isDeposit, userEmail, paymentId } = req.body;

    if (!walletAddress || collateralDeltaUsd === undefined || isDeposit === undefined || !userEmail || !paymentId) {
      return res.status(400).json({ success: false, error: 'Missing required parameters (walletAddress, collateralDeltaUsd, isDeposit, userEmail, paymentId)' });
    }

    // SECURITY: Retrieve encrypted key and decrypt with user authentication
    const encryptedData = await getWalletKey(walletAddress);
    if (!encryptedData) {
      return res.status(404).json({ success: false, error: 'Wallet key not found or expired' });
    }

    // Decrypt with user authentication (verifies email and paymentId match)
    const walletData = decryptWalletKeyWithAuth(encryptedData, userEmail, paymentId);
    const { privateKey } = walletData;

    if (!privateKey) {
      return res.status(400).json({ success: false, error: 'Private key not available - wallet may be connected (not generated)' });
    }

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
