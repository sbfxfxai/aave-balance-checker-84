import { executeAaveFromHubWallet } from './square/webhook-transfers';

// Test with static import (same as fixed process-payment.ts)
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[Test-Static] Testing static import (same as fixed process-payment.ts)...');
    
    const paymentId = `test_static_${Date.now()}`;
    const walletAddress = '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67';
    const amount = 1;
    
    console.log('[Test-Static] Using static import - no dynamic import issues');
    
    // This is the exact same call as in the fixed process-payment.ts
    const aaveResult = await executeAaveFromHubWallet(walletAddress, amount, paymentId);
    
    console.log('[Test-Static] Aave execution result:', aaveResult);

    if (aaveResult.success) {
      console.log('[Test-Static] ✅ Static import works! Aave supply successful:', aaveResult.data.txHash);
      
      return res.status(200).json({
        success: true,
        message: 'STATIC IMPORT TEST SUCCESSFUL - Real payments will work!',
        paymentId,
        walletAddress,
        amount,
        aaveTxHash: aaveResult.data.txHash,
        confidence: 'HIGH - Static import eliminates module resolution issues'
      });
      
    } else {
      console.error('[Test-Static] ❌ Aave supply failed:', aaveResult.error);
      
      return res.status(500).json({
        success: false,
        message: 'Aave supply failed with static import',
        paymentId,
        walletAddress,
        amount,
        error: aaveResult.error,
        errorType: aaveResult.errorType
      });
    }

  } catch (error) {
    console.error('[Test-Static] Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
