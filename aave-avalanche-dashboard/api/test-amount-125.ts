import { executeAaveFromHubWallet } from './square/webhook-transfers';

// Test with 1.25 to confirm exact amount preservation
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[Test-1.25] Testing exact amount preservation with 1.25...');
    
    const paymentId = `test_125_${Date.now()}`;
    const walletAddress = '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67';
    const amount = 1.25; // Test with 1.25 specifically
    
    console.log('[Test-1.25] Testing amount:', amount);
    
    // This should supply exactly 1.25 USDC, not 1.33 or any other amount
    const aaveResult = await executeAaveFromHubWallet(walletAddress, amount, paymentId);
    
    console.log('[Test-1.25] Aave execution result:', aaveResult);

    if (aaveResult.success) {
      console.log('[Test-1.25] ✅ SUCCESS! Check transaction for exactly 1.25 USDC:', aaveResult.data.txHash);
      
      return res.status(200).json({
        success: true,
        message: '1.25 AMOUNT TEST SUCCESSFUL - Should show exactly 1.25 USDC in transaction',
        paymentId,
        walletAddress,
        amount,
        aaveTxHash: aaveResult.data.txHash,
        note: 'Check the transaction - it should show Transfer of 1.25 USDC (not 1.33 or 1.08)'
      });
      
    } else {
      console.error('[Test-1.25] ❌ Aave supply failed:', aaveResult.error);
      
      return res.status(500).json({
        success: false,
        message: 'Aave supply failed with 1.25 amount',
        paymentId,
        walletAddress,
        amount,
        error: aaveResult.error,
        errorType: aaveResult.errorType
      });
    }

  } catch (error) {
    console.error('[Test-1.25] Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
