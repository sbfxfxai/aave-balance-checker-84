import { executeAaveFromHubWallet } from './square/webhook-transfers';

// Test Aave transfer without real payment
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

    console.log('[TestAave] Starting test transfer:', { walletAddress, amount });

    // Execute Aave transfer directly
    const result = await executeAaveFromHubWallet(
      walletAddress, 
      amount, 
      `test_${Date.now()}`
    );

    console.log('[TestAave] Transfer result:', result);

    return res.status(200).json({
      success: result.success,
      txHash: result.success ? result.data.txHash : null,
      error: result.success ? null : result.error,
      details: result
    });

  } catch (error) {
    console.error('[TestAave] Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed'
    });
  }
}
