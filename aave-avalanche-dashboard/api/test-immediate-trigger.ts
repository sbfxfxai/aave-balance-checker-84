import { executeAaveFromHubWallet } from './square/webhook-transfers';

// Test the exact same code path as the immediate trigger
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { walletAddress, amount } = req.body;

    if (!walletAddress || !amount) {
      return res.status(400).json({ 
        error: 'Missing required fields: walletAddress, amount' 
      });
    }

    console.log('[Test-Immediate] Testing immediate trigger with same params as payment flow...');
    
    // Test the exact same call as process-payment.ts line 421
    const paymentId = `test_${Date.now()}`;
    const aaveResult = await executeAaveFromHubWallet(walletAddress, amount, paymentId);
    
    console.log('[Test-Immediate] Result:', aaveResult);

    return res.status(200).json({
      success: aaveResult.success,
      txHash: aaveResult.success ? aaveResult.data.txHash : null,
      error: aaveResult.success ? null : aaveResult.error,
      errorType: aaveResult.success ? null : aaveResult.errorType,
      paymentId,
      details: aaveResult
    });

  } catch (error) {
    console.error('[Test-Immediate] Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed'
    });
  }
}
