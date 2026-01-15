#!/usr/bin/env node

/**
 * Real Conservative Payment Test
 * 
 * This script tests the conservative flow with real payments via the production endpoint.
 * It uses the test-conservative endpoint which bypasses signature validation for testing.
 */

const https = require('https');

function makeRequest(url, options, data) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: body ? JSON.parse(body) : null
          };
          resolve(result);
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function testRealPayment(walletAddress, amount, userEmail) {
  console.log('💰 ===== REAL CONSERVATIVE PAYMENT TEST =====');
  
  const paymentId = `real-test-${Date.now()}`;
  
  console.log('📋 Payment Details:');
  console.log('- Wallet:', walletAddress);
  console.log('- Amount: $' + amount);
  console.log('- Email:', userEmail);
  console.log('- Payment ID:', paymentId);
  console.log('- Endpoint: https://www.tiltvault.com/api/square/test-conservative');
  
  console.log('\n⚠️  IMPORTANT SAFETY CHECKS:');
  console.log('- This will execute REAL blockchain transactions');
  console.log('- REAL AVAX will be sent to your wallet');
  console.log('- REAL USDC will be supplied to Aave on your behalf');
  console.log('- You will receive REAL aTokens (earning yield)');
  console.log('- These actions cannot be undone');
  
  // Ask for confirmation
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const confirmed = await new Promise((resolve) => {
    rl.question('\n❓ Do you want to proceed with this real payment test? (yes/no): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
  
  if (!confirmed) {
    console.log('❌ Test cancelled by user');
    return { success: false, message: 'Test cancelled' };
  }
  
  console.log('\n🚀 Executing real payment test...');
  
  try {
    const response = await makeRequest('https://www.tiltvault.com/api/square/test-conservative', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TiltVault-Test/1.0'
      }
    }, {
      walletAddress,
      amount,
      userEmail,
      paymentId
    });
    
    console.log('\n📊 Response Status:', response.statusCode);
    
    if (response.statusCode === 200) {
      console.log('✅ Payment test initiated successfully!');
      
      if (response.body) {
        console.log('\n📋 Results:');
        console.log(JSON.stringify(response.body, null, 2));
        
        if (response.body.success) {
          console.log('\n🎉 CONSERVATIVE FLOW COMPLETED!');
          console.log('✅ AVAX sent for gas');
          console.log('✅ USDC supplied to Aave');
          console.log('✅ aTokens received in wallet');
          
          if (response.body.results && response.body.results.transfers) {
            console.log('\n🔗 Transaction Links:');
            
            if (response.body.results.transfers.avax && response.body.results.transfers.avax.txHash) {
              console.log('AVAX Transfer: https://snowtrace.io/tx/' + response.body.results.transfers.avax.txHash);
            }
            
            if (response.body.results.aave && response.body.results.aave.txHash) {
              console.log('Aave Supply: https://snowtrace.io/tx/' + response.body.results.aave.txHash);
            }
          }
          
          console.log('\n💡 What to check:');
          console.log('- Your wallet: https://snowtrace.io/address/' + walletAddress);
          console.log('- AVAX balance should increase by ~0.005 AVAX');
          console.log('- aUSDC token balance should appear');
          console.log('- Aave position should show your $' + amount + ' deposit');
          
        } else {
          console.log('\n⚠️ Payment test completed with issues');
          console.log('Check the results above for details');
        }
      }
      
    } else {
      console.log('❌ Payment test failed');
      console.log('Status Code:', response.statusCode);
      console.log('Response:', response.body);
    }
    
    return {
      success: response.statusCode === 200,
      statusCode: response.statusCode,
      body: response.body
    };
    
  } catch (error) {
    console.error('\n❌ Payment test error:', error.message);
    return { success: false, error: error.message };
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.log('Usage: node test-real-payment.js <walletAddress> <amount> <userEmail>');
    console.log('Example: node test-real-payment.js 0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67 1 test@example.com');
    process.exit(1);
  }
  
  const [walletAddress, amount, userEmail] = args;
  
  // Validate inputs
  if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
    console.error('❌ Invalid wallet address format');
    process.exit(1);
  }
  
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    console.error('❌ Invalid amount. Must be a positive number');
    process.exit(1);
  }
  
  if (!userEmail.includes('@') || !userEmail.includes('.')) {
    console.error('❌ Invalid email format');
    process.exit(1);
  }
  
  testRealPayment(walletAddress, amountNum, userEmail)
    .then(result => {
      console.log('\n🏁 Test completed:', result.success ? 'SUCCESS' : 'FAILED');
      process.exit(result.success ? 0 : 1);
    })
    .catch(error => {
      console.error('Test execution failed:', error);
      process.exit(1);
    });
}

module.exports = { testRealPayment };
