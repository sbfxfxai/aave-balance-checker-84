// Test the EXACT same code path as real payment processing
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[Test-Real] Testing REAL payment flow code path...');
    
    // Simulate the EXACT same data structure as process-payment.ts
    const paymentId = `test_real_${Date.now()}`;
    const squarePaymentId = `test_square_${Date.now()}`;
    const walletAddress = '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67';
    const userEmail = 'test@example.com';
    const strategyType = 'conservative';
    const amount = 1;
    const paymentStatus = 'COMPLETED'; // Simulate successful payment
    
    console.log('[Test-Real] Simulated payment data (exact same as process-payment.ts):', {
      paymentId,
      squarePaymentId,
      walletAddress,
      userEmail,
      strategyType,
      amount,
      paymentStatus
    });

    // EXACT same code as process-payment.ts lines 408-421
    try {
      // Import the Aave function directly (like manual flow)
      const webhookModule = await import('./square/webhook-transfers');
      const executeAaveFromHubWallet = (webhookModule as any).executeAaveFromHubWallet;
      
      if (!executeAaveFromHubWallet) {
        return res.status(500).json({ 
          success: false, 
          error: 'executeAaveFromHubWallet not found in webhook-transfers module',
          debug: 'Dynamic import failed - same error as real payment would get'
        });
      } else {
        console.log('[Test-Real] ✅ Successfully imported executeAaveFromHubWallet');
        
        // Execute Aave directly (same as manual flow)
        console.log('[Test-Real] Executing Aave directly from hub wallet (same as manual flow)...');
        
        const aaveResult = await executeAaveFromHubWallet(walletAddress, amount, paymentId);
        
        console.log('[Test-Real] Aave execution result:', aaveResult);

        if (aaveResult.success) {
          console.log('[Test-Real] ✅ Aave supply successful:', aaveResult.data.txHash);
          
          return res.status(200).json({
            success: true,
            message: 'REAL payment flow test completed successfully',
            paymentId,
            squarePaymentId,
            walletAddress,
            amount,
            aaveTxHash: aaveResult.data.txHash,
            debug: 'This is the EXACT same code path as real payment'
          });
          
        } else {
          console.error('[Test-Real] ❌ Aave supply failed:', aaveResult.error);
          
          return res.status(500).json({
            success: false,
            message: 'Aave supply failed in REAL payment flow test',
            paymentId,
            walletAddress,
            amount,
            error: aaveResult.error,
            errorType: aaveResult.errorType,
            debug: 'This failure would happen in real payment too'
          });
        }
      }
    } catch (processingError) {
      console.error('[Test-Real] ⚠️ Error triggering immediate processing:', processingError);
      console.error('[Test-Real] Error stack:', processingError instanceof Error ? processingError.stack : 'No stack');
      
      return res.status(500).json({
        success: false,
        error: 'Dynamic import/execution failed',
        details: processingError instanceof Error ? processingError.message : 'Unknown error',
        debug: 'This is the exact error real payments would get'
      });
    }

  } catch (error) {
    console.error('[Test-Real] Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
