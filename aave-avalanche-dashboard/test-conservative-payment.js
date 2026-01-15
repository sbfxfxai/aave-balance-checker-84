/**
 * Test Conservative Payment Flow
 * 
 * Run this script to test the complete conservative flow:
 * 1. USDC transfer to user wallet
 * 2. AVAX transfer for gas
 * 3. Aave supply execution
 * 
 * Usage:
 *   node test-conservative-payment.js <walletAddress> <amount>
 * 
 * Example:
 *   node test-conservative-payment.js 0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67 10
 */

const walletAddress = process.argv[2] || '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67';
const amount = parseFloat(process.argv[3]) || 10;
const apiUrl = process.env.API_URL || 'https://www.tiltvault.com';

console.log('==========================================');
console.log('Testing Conservative Payment Flow');
console.log('==========================================');
console.log('Wallet:', walletAddress);
console.log('Amount: $' + amount);
console.log('API:', apiUrl);
console.log('');

const testData = {
  walletAddress,
  amount,
  paymentId: `test-${Date.now()}`
};

console.log('Sending test request...');
console.log('Request:', JSON.stringify(testData, null, 2));
console.log('');

fetch(`${apiUrl}/api/square/test-conservative`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(testData)
})
  .then(res => res.json())
  .then(data => {
    console.log('==========================================');
    console.log('Test Results:');
    console.log('==========================================');
    console.log(JSON.stringify(data, null, 2));
    console.log('');
    
    if (data.results) {
      console.log('Summary:');
      console.log('  USDC Transfer:', data.results.transfers?.usdc?.success ? '✅' : '❌', data.results.transfers?.usdc?.txHash || data.results.transfers?.usdc?.error);
      console.log('  AVAX Transfer:', data.results.transfers?.avax?.success ? '✅' : '❌', data.results.transfers?.avax?.txHash || data.results.transfers?.avax?.error);
      console.log('  Aave Supply:', data.results.aave?.success || data.results.aave?.retry?.success ? '✅' : '❌', data.results.aave?.txHash || data.results.aave?.retry?.txHash || data.results.aave?.error);
      console.log('');
      
      if (data.results.summary?.allStepsCompleted) {
        console.log('✅ All steps completed successfully!');
      } else {
        console.log('⚠️ Some steps failed. Check the results above.');
      }
    }
    
    console.log('');
    console.log('Verify on Snowtrace:');
    console.log(`  - User wallet: https://snowtrace.io/address/${walletAddress}`);
    if (data.results?.transfers?.usdc?.txHash) {
      console.log(`  - USDC transfer: https://snowtrace.io/tx/${data.results.transfers.usdc.txHash}`);
    }
    if (data.results?.transfers?.avax?.txHash) {
      console.log(`  - AVAX transfer: https://snowtrace.io/tx/${data.results.transfers.avax.txHash}`);
    }
    if (data.results?.aave?.txHash || data.results?.aave?.retry?.txHash) {
      const aaveTx = data.results.aave.txHash || data.results.aave.retry.txHash;
      console.log(`  - Aave supply: https://snowtrace.io/tx/${aaveTx}`);
    }
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });

