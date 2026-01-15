// Test the exact payment processing flow to trace where fees get added
import { executeAaveFromHubWallet } from './square/webhook-transfers';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[DEBUG-FLOW] Testing payment processing flow with fees...');
    
    // Simulate the exact scenario:
    // User inputs: 1.00
    // Square processes: 1.10 (includes fees)
    // We want: 1.00 (exact user input)
    
    const userAmount = 1.00; // What user actually wants to supply
    const squareProcessedAmount = 1.10; // What Square returns (includes fees)
    
    console.log('[DEBUG-FLOW] User input amount:', userAmount);
    console.log('[DEBUG-FLOW] Square processed amount:', squareProcessedAmount);
    
    // Test 1: Direct call with user amount (should work)
    console.log('[DEBUG-FLOW] Test 1: Direct call with user amount');
    
    const result1 = await executeAaveFromHubWallet(
      '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67',
      userAmount,
      'test_user_amount'
    );
    
    console.log('[DEBUG-FLOW] Result 1 (user amount):', result1.success ? 'SUCCESS' : 'FAILED');
    
    // Test 2: Direct call with Square amount (should show the problem)
    console.log('[DEBUG-FLOW] Test 2: Direct call with Square processed amount');
    const result2 = await executeAaveFromHubWallet(
      '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67',
      squareProcessedAmount,
      'test_square_amount'
    );
    
    console.log('[DEBUG-FLOW] Result 2 (Square amount):', result2.success ? 'SUCCESS' : 'FAILED');
    
    // Test 3: Simulate process-payment.ts logic
    console.log('[DEBUG-FLOW] Test 3: Simulating process-payment.ts logic');
    
    // This simulates what happens in process-payment.ts
    const body = { amount: userAmount }; // Original user input
    const amount = userAmount; // Validated amount
    const exactAmount = body.amount || amount; // The fix we implemented
    
    console.log('[DEBUG-FLOW] body.amount:', body.amount);
    console.log('[DEBUG-FLOW] amount:', amount);
    console.log('[DEBUG-FLOW] exactAmount (body.amount || amount):', exactAmount);
    
    const result3 = await executeAaveFromHubWallet(
      '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67',
      exactAmount,
      'test_process_payment'
    );
    
    console.log('[DEBUG-FLOW] Result 3 (process-payment logic):', result3.success ? 'SUCCESS' : 'FAILED');
    
    return res.status(200).json({
      success: true,
      message: 'Payment flow debug completed',
      tests: {
        test1: {
          description: 'Direct call with user amount (1.00)',
          amount: userAmount,
          success: result1.success,
          txHash: result1.success ? result1.data.txHash : null
        },
        test2: {
          description: 'Direct call with Square amount (1.10)',
          amount: squareProcessedAmount,
          success: result2.success,
          txHash: result2.success ? result2.data.txHash : null
        },
        test3: {
          description: 'Process-payment logic (should use user amount)',
          amount: exactAmount,
          success: result3.success,
          txHash: result3.success ? result3.data.txHash : null
        }
      },
      conclusion: 'If Test 2 transfers 1.10 USDC, that proves the Aave function works correctly. The issue is in payment processing passing wrong amount.'
    });

  } catch (error) {
    console.error('[DEBUG-FLOW] Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
