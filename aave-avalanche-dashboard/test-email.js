// Test script for email endpoint
const testEmailEndpoint = async () => {
  try {
    const response = await fetch('http://localhost:3000/api/wallet/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        wallet_address: '0x1234567890123456789012345678901234567890',
        mnemonic: 'test twelve word phrase here for testing',
        name: 'Test User'
      })
    });

    const result = await response.json();
    console.log('Email test result:', result);
  } catch (error) {
    console.error('Email test error:', error);
  }
};

testEmailEndpoint();
