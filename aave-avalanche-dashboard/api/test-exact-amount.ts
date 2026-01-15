import { executeAaveFromHubWallet } from './square/webhook-transfers';

// Test the exact amount that should be supplied
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[Test-Exact] Testing exact amount bypassing all logic...');
    
    const paymentId = `test_exact_${Date.now()}`;
    const walletAddress = '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67';
    
    // Test with exactly 1.00 - this should transfer exactly 1.00 USDC
    const exactAmount = 1.00;
    
    console.log('[Test-Exact] Amount being tested:', exactAmount);
    console.log('[Test-Exact] Expected USDC transfer: exactly 1.00 USDC');
    
    // Call the Aave function directly - no Square, no webhook, no processing
    const aaveResult = await executeAaveFromHubWallet(walletAddress, exactAmount, paymentId);
    
    console.log('[Test-Exact] Aave result:', aaveResult);

    if (aaveResult.success) {
      console.log('[Test-Exact] ✅ SUCCESS! Transaction:', aaveResult.data.txHash);
      console.log('[Test-Exact] Check this transaction - it should show exactly 1.00 USDC transfer');
      
      return res.status(200).json({
        success: true,
        message: 'EXACT AMOUNT TEST - Should be exactly 1.00 USDC',
        paymentId,
        walletAddress,
        amount: exactAmount,
        aaveTxHash: aaveResult.data.txHash,
        instruction: 'Check the transaction - it must show Transfer of exactly 1.00 USDC'
      });
      
    } else {
      console.error('[Test-Exact] ❌ Aave failed:', aaveResult.error);
      
      return res.status(500).json({
        success: false,
        message: 'Aave supply failed',
        paymentId,
        walletAddress,
        amount: exactAmount,
        error: aaveResult.error,
        errorType: aaveResult.errorType
      });
    }

  } catch (error) {
    console.error('[Test-Exact] Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
