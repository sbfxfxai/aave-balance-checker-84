/**
 * Test Endpoint for Morpho Execution
 * 
 * This endpoint allows you to test executeMorphoFromHubWallet() directly
 * without going through the webhook signature verification.
 * 
 * Usage:
 * POST /api/square/test-morpho
 * Body: {
 *   "walletAddress": "0x...",
 *   "gauntletAmount": "1",  // GauntletUSDC Core vault amount
 *   "hyperithmAmount": "1", // HyperithmUSDC vault amount
 *   "paymentId": "test-123"
 * }
 * 
 * SECURITY: This should be disabled in production or protected with authentication
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeMorphoFromHubWallet } from './webhook-morpho';

async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Security check: Only allow in development or with auth token
  const authToken = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.TEST_MORPHO_AUTH_TOKEN;
  
  if (expectedToken && authToken !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized. Provide valid auth token.' });
  }

  // Parse request body
  const { walletAddress, gauntletAmount, hyperithmAmount, paymentId } = req.body;

  // Validate required fields
  if (!walletAddress || !gauntletAmount || !hyperithmAmount) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: ['walletAddress', 'gauntletAmount', 'hyperithmAmount'],
      received: {
        walletAddress: !!walletAddress,
        gauntletAmount: !!gauntletAmount,
        hyperithmAmount: !!hyperithmAmount,
        paymentId: paymentId || 'auto-generated'
      }
    });
  }

  // Validate wallet address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return res.status(400).json({ 
      error: 'Invalid wallet address format. Must be 0x followed by 40 hex characters.' 
    });
  }

  // Validate amounts are positive numbers
  const gauntletNum = parseFloat(gauntletAmount);
  const hyperithmNum = parseFloat(hyperithmAmount);
  
  if (isNaN(gauntletNum) || gauntletNum <= 0) {
    return res.status(400).json({ error: 'gauntletAmount must be a positive number' });
  }
  
  if (isNaN(hyperithmNum) || hyperithmNum <= 0) {
    return res.status(400).json({ error: 'hyperithmAmount must be a positive number' });
  }

  console.log('[Test-Morpho] ===== TESTING MORPHO EXECUTION =====');
  console.log('[Test-Morpho] Wallet:', walletAddress);
  console.log('[Test-Morpho] GauntletUSDC Core Amount: $' + gauntletNum);
  console.log('[Test-Morpho] HyperithmUSDC Amount: $' + hyperithmNum);
  console.log('[Test-Morpho] Payment ID:', paymentId || 'test-' + Date.now());

  try {
    // Execute Morpho deposit using the exported function from webhook.ts
    const result = await executeMorphoFromHubWallet(
      walletAddress,
      gauntletNum,
      hyperithmNum,
      paymentId || 'test-' + Date.now()
    );

    console.log('[Test-Morpho] Result:', JSON.stringify(result, null, 2));

    if (result.success) {
      return res.status(200).json({
        success: true,
        message: 'Morpho execution successful',
        gauntletTxHash: result.gauntletTxHash,
        hyperithmTxHash: result.hyperithmTxHash,
        result
      });
    } else {
      return res.status(500).json({
        success: false,
        message: 'Morpho execution failed',
        error: result.error,
        result
      });
    }
  } catch (error) {
    console.error('[Test-Morpho] Exception:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default handler;

