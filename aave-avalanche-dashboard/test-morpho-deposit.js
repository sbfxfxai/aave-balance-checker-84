/**
 * Test Morpho Deposit Script
 * Tests morpho execution without making a real Square payment
 */

const testWallet = '0x4f12A1210dAC40cB7C89cbC1E95B3b5CC20cc986'; // Your test wallet
const testAmount = 1; // $1 per vault (total $2: $1 GauntletUSDC Core + $1 HyperithmUSDC)
const baseUrl = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : 'https://www.tiltvault.com';

async function testMorpho() {
  console.log('🧪 Testing Morpho Execution');
  console.log('==========================');
  console.log(`Wallet: ${testWallet}`);
  console.log(`GauntletUSDC Core Amount: $${testAmount}`);
  console.log(`HyperithmUSDC Amount: $${testAmount}`);
  console.log(`Endpoint: ${baseUrl}/api/square/test-morpho`);
  console.log('');

  const response = await fetch(`${baseUrl}/api/square/test-morpho`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      walletAddress: testWallet,
      gauntletAmount: testAmount.toString(),
      hyperithmAmount: testAmount.toString(),
      paymentId: `test-morpho-${Date.now()}`
    })
  });

  const result = await response.json();
  
  console.log('Response Status:', response.status);
  console.log('Response Body:', JSON.stringify(result, null, 2));
  
  if (result.success) {
    console.log('');
    console.log('✅✅✅ TEST PASSED ✅✅✅');
    console.log(`Transaction Hash: ${result.txHash}`);
    console.log(`Check on Arbiscan: https://arbiscan.io/tx/${result.txHash}`);
  } else {
    console.log('');
    console.log('❌❌❌ TEST FAILED ❌❌❌');
    console.log(`Error: ${result.error || result.message}`);
  }
}

testMorpho().catch(console.error);

