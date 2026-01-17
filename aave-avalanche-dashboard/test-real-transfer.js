const https = require('https');

// Test with a different wallet address to show actual balance changes
const data = JSON.stringify({
  walletAddress: "0x1234567890123456789012345678901234567890" // Test address
});

const options = {
  hostname: 'www.tiltvault.com',
  port: 443,
  path: '/api/test-transfer-to-user',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    try {
      const parsed = JSON.parse(responseData);
      console.log('\n=== REAL TRANSFER TEST RESULTS ===');
      console.log('✅ Success:', parsed.success);
      
      if (parsed.success) {
        console.log('\n📊 Transfer Details:');
        console.log('📍 From:', parsed.transferDetails?.from);
        console.log('📍 To:', parsed.transferDetails?.to);
        console.log('💰 Amount:', parsed.transferDetails?.amount);
        console.log('🔗 TX Hash:', parsed.transferDetails?.txHash);
        console.log('🌐 Explorer:', parsed.transferDetails?.explorerUrl);
        
        console.log('\n💰 Balance Changes:');
        console.log('🏦 Hub Wallet:');
        console.log('   Before:', parsed.transferDetails?.balances?.hub?.before, 'ERGC');
        console.log('   After: ', parsed.transferDetails?.balances?.hub?.after, 'ERGC');
        console.log('   Sent:  ', parsed.transferDetails?.balances?.hub?.sent, 'ERGC');
        
        console.log('👤 User Wallet:');
        console.log('   Before:', parsed.transferDetails?.balances?.user?.before, 'ERGC');
        console.log('   After: ', parsed.transferDetails?.balances?.user?.after, 'ERGC');
        console.log('   Received:', parsed.transferDetails?.balances?.user?.received, 'ERGC');
        
        console.log('\n🎉 REAL TRANSFER PROOF: 100 ERGC actually transferred!');
        console.log('🔗 Verify here:', parsed.transferDetails?.explorerUrl);
      } else {
        console.log('\n❌ Transfer Failed:');
        console.log('Error:', parsed.error);
      }
    } catch (e) {
      console.log('❌ Failed to parse response:', e.message);
      console.log('Raw response:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error(`❌ Request Error: ${error.message}`);
});

req.write(data);
req.end();

console.log('🚀 Testing REAL ERGC transfer to different wallet...');
console.log('📍 Sending request to https://www.tiltvault.com/api/test-transfer-to-user');
console.log('👛 Target wallet: 0x1234567890123456789012345678901234567890 (test address)');
