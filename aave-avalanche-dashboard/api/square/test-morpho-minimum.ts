/**
 * Test Endpoint for Morpho Minimum Amount ($2)
 * 
 * Tests the minimum viable amount for Morpho vault deposits:
 * - Total: $2.00
 * - GauntletUSDC: $1.40 (70%)
 * - HyperithmUSDC: $0.60 (30%)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeMorphoFromHubWallet } from './webhook-morpho';

async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Parse request body
  const { walletAddress, paymentId } = req.body;

  // Validate wallet address
  if (!walletAddress) {
    return res.status(400).json({ error: 'walletAddress is required' });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return res.status(400).json({ 
      error: 'Invalid wallet address format. Must be 0x followed by 40 hex characters.' 
    });
  }

  // MINIMUM TEST AMOUNTS - Total $2.00 (adjusted for vault minimums)
  const gauntletAmount = 1.00; // Minimum for GauntletUSDC
  const hyperithmAmount = 1.00; // Minimum for HyperithmUSDC  
  const totalAmount = gauntletAmount + hyperithmAmount;

  console.log('[Test-Morpho-Min] ===== TESTING MINIMUM MORPHO AMOUNT =====');
  console.log('[Test-Morpho-Min] Wallet:', walletAddress);
  console.log('[Test-Morpho-Min] Total Amount: $' + totalAmount.toFixed(2));
  console.log('[Test-Morpho-Min] GauntletUSDC: $' + gauntletAmount.toFixed(2));
  console.log('[Test-Morpho-Min] HyperithmUSDC: $' + hyperithmAmount.toFixed(2));
  console.log('[Test-Morpho-Min] Payment ID:', paymentId || 'test-min-' + Date.now());

  try {
    // Execute Morpho deposit with minimum amounts
    const result = await executeMorphoFromHubWallet(
      walletAddress,
      gauntletAmount,
      hyperithmAmount,
      paymentId || 'test-min-' + Date.now()
    );

    console.log('[Test-Morpho-Min] Result:', JSON.stringify(result, null, 2));

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Minimum Morpho execution successful',
        totalAmount: `$${totalAmount.toFixed(2)}`,
        gauntletAmount: `$${gauntletAmount.toFixed(2)}`,
        hyperithmAmount: `$${hyperithmAmount.toFixed(2)}`,
        gauntletTxHash: result.gauntletTxHash,
        hyperithmTxHash: result.hyperithmTxHash,
        result
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Minimum Morpho execution failed',
        totalAmount: `$${totalAmount.toFixed(2)}`,
        gauntletAmount: `$${gauntletAmount.toFixed(2)}`,
        hyperithmAmount: `$${hyperithmAmount.toFixed(2)}`,
        error: result.error,
        result
      });
    }
  } catch (error) {
    console.error('[Test-Morpho-Min] Exception:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default handler;
