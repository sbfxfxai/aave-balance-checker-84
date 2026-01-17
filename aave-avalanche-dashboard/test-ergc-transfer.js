const http = require('http');

const data = JSON.stringify({
  walletAddress: "0x34c11928868d14bdD7Be55A0D9f9e02257240c24"
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/test-transfer-to-user',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers)}`);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', responseData);
    try {
      const parsed = JSON.parse(responseData);
      console.log('\n=== TRANSFER RESULT ===');
      console.log('Success:', parsed.success);
      if (parsed.success) {
        console.log('TX Hash:', parsed.transferDetails?.txHash);
        console.log('Explorer:', parsed.transferDetails?.explorerUrl);
        console.log('Hub Balance:', parsed.transferDetails?.balances?.hub?.before, '→', parsed.transferDetails?.balances?.hub?.after);
        console.log('User Balance:', parsed.transferDetails?.balances?.user?.before, '→', parsed.transferDetails?.balances?.user?.after);
        console.log('Amount Transferred:', parsed.transferDetails?.balances?.user?.received, 'ERGC');
      } else {
        console.log('Error:', parsed.error);
      }
    } catch (e) {
      console.log('Raw response:', responseData);
    }
  });
});

req.on('error', (error) => {
  console.error(`Error: ${error.message}`);
});

req.write(data);
req.end();

console.log('🚀 Testing ERGC transfer to hub wallet (self-transfer for testing)...');
console.log('📍 Sending request to http://localhost:3001/api/test-transfer-to-user');
