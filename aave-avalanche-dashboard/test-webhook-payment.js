/**
 * Test Square Webhook Payment
 * 
 * Sends a test payment webhook to the Square webhook endpoint
 * This simulates a real Square payment webhook event
 * 
 * Usage:
 *   node test-webhook-payment.js <walletAddress> <amount> <email> <riskProfile>
 * 
 * Example:
 *   node test-webhook-payment.js 0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67 10 test@example.com conservative
 */

const crypto = require('crypto');

const walletAddress = process.argv[2] || '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67';
const amount = parseFloat(process.argv[3]) || 10;
const email = process.argv[4] || 'test@example.com';
const riskProfile = process.argv[5] || 'conservative';
const apiUrl = process.env.API_URL || 'https://www.tiltvault.com';

// Square webhook signature key (MUST match production environment variable)
const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
  console.error('❌ ERROR: SQUARE_WEBHOOK_SIGNATURE_KEY environment variable is required!');
  console.error('   Set it to match your production Square webhook signature key.');
  console.error('   Get it from: Square Dashboard → Webhooks → Show Signature Key');
  process.exit(1);
}

console.log('==========================================');
console.log('Testing Square Webhook Payment');
console.log('==========================================');
console.log('Wallet:', walletAddress);
console.log('Amount: $' + amount);
console.log('Email:', email);
console.log('Risk Profile:', riskProfile);
console.log('API:', apiUrl);
console.log('Signature Key:', SQUARE_WEBHOOK_SIGNATURE_KEY ? `${SQUARE_WEBHOOK_SIGNATURE_KEY.substring(0, 10)}...` : 'NOT SET');
console.log('');

// Create test webhook payload
const paymentId = `test-payment-${Date.now()}`;
const webhookPayload = {
  merchant_id: "X0F2ZVNVX1ZED",
  type: "payment.completed",
  event_id: `test-event-${Date.now()}`,
  created_at: new Date().toISOString(),
  data: {
    object: {
      id: paymentId,
      amount_money: {
        amount: Math.floor(amount * 100), // Convert to cents
        currency: "USD"
      },
      status: "COMPLETED",
      note: `payment_id:${paymentId} wallet:${walletAddress} email:${email} risk:${riskProfile}`
    }
  }
};

// Convert to JSON string (compact format like Square sends)
const payloadString = JSON.stringify(webhookPayload);

// Generate signature (Square's method: HMAC-SHA256 of URL + payload, truncated to 20 bytes)
// Square signs: notificationUrl + payload, then truncates to 20 bytes before base64 encoding
const notificationUrl = `${apiUrl}/api/square/webhook`;
const hmac = crypto.createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY);
hmac.update(notificationUrl + payloadString, 'utf8');
const hash = hmac.digest(); // 32-byte buffer
// Square truncates to 20 bytes before base64 encoding
const signature = Buffer.from(hash.subarray(0, 20)).toString('base64');

console.log('Generated webhook payload:');
console.log(JSON.stringify(webhookPayload, null, 2));
console.log('');
console.log('Generated signature:', signature);
console.log('');

console.log('Sending webhook request...');

fetch(`${apiUrl}/api/square/webhook`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Square-Signature': signature
  },
  body: payloadString
})
  .then(async res => {
    const data = await res.json();
    console.log('==========================================');
    console.log('Webhook Response:');
    console.log('==========================================');
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    console.log('');
    
    if (res.status === 200) {
      console.log('✅ Webhook accepted successfully!');
      console.log('');
      console.log('Check the logs for:');
      console.log('  - AVAX transfer transaction');
      console.log('  - Aave supply transaction');
      console.log('');
      console.log('Verify on Snowtrace:');
      console.log(`  - User wallet: https://snowtrace.io/address/${walletAddress}`);
    } else {
      console.log('❌ Webhook rejected:', data.error || 'Unknown error');
    }
  })
  .catch(error => {
    console.error('❌ Request failed:', error);
    process.exit(1);
  });

