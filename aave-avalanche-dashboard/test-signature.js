/**
 * Test Square Webhook Signature Verification
 * 
 * This script tests the signature verification logic without needing a real payment.
 * Run: node test-signature.js
 */

const crypto = require('crypto');

// Your Square webhook signature key
const SQUARE_WEBHOOK_SIGNATURE_KEY = 'zvJH0S1JpI2TtwPGwyv1KQ';

// Test payload (simulating a Square webhook)
const testPayload = JSON.stringify({
  merchant_id: "X0F2ZVNVX1ZED",
  type: "payment.updated",
  event_id: "test-event-id",
  created_at: new Date().toISOString(),
  data: {
    object: {
      payment: {
        id: "TEST_PAYMENT_ID",
        status: "COMPLETED",
        amount_money: {
          amount: 200,
          currency: "USD"
        }
      }
    }
  }
});

console.log('🧪 Testing Square Webhook Signature Verification\n');
console.log('Signature Key:', SQUARE_WEBHOOK_SIGNATURE_KEY);
console.log('Key Length:', SQUARE_WEBHOOK_SIGNATURE_KEY.length);
console.log('\nTest Payload:', testPayload);
console.log('Payload Length:', testPayload.length);

// Generate signature the same way Square does
const hmac = crypto.createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY);
hmac.update(testPayload);
const generatedSignature = hmac.digest('base64');

console.log('\n✅ Generated Signature (base64):', generatedSignature);
console.log('Signature with sha256= prefix:', 'sha256=' + generatedSignature);

// Test verification function
function verifySignature(payload, signature) {
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
    console.log('❌ No signature key configured');
    return false;
  }

  if (!signature) {
    console.log('❌ No signature provided');
    return false;
  }

  try {
    // Extract base64 signature
    let signatureBase64 = signature;
    if (signature.startsWith('sha256=')) {
      signatureBase64 = signature.substring(7);
      console.log('📝 Extracted signature from sha256= prefix');
    } else {
      console.log('📝 Using signature as-is (no prefix)');
    }

    // Calculate expected signature
    const hmac = crypto.createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY);
    hmac.update(payload);
    const expectedSignature = hmac.digest('base64');

    console.log('📊 Comparison:');
    console.log('  Received:', signatureBase64);
    console.log('  Expected:', expectedSignature);
    console.log('  Match:', signatureBase64 === expectedSignature);

    // Convert to buffers for comparison
    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64');

    console.log('📏 Buffer lengths:');
    console.log('  Received:', signatureBuffer.length);
    console.log('  Expected:', expectedBuffer.length);

    if (signatureBuffer.length !== expectedBuffer.length) {
      console.log('❌ Length mismatch!');
      return false;
    }

    // Use timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      new Uint8Array(signatureBuffer),
      new Uint8Array(expectedBuffer)
    );

    return isValid;
  } catch (error) {
    console.error('❌ Verification error:', error.message);
    return false;
  }
}

// Test 1: Without prefix
console.log('\n' + '='.repeat(60));
console.log('TEST 1: Signature WITHOUT sha256= prefix');
console.log('='.repeat(60));
const test1 = verifySignature(testPayload, generatedSignature);
console.log('Result:', test1 ? '✅ PASSED' : '❌ FAILED');

// Test 2: With prefix
console.log('\n' + '='.repeat(60));
console.log('TEST 2: Signature WITH sha256= prefix');
console.log('='.repeat(60));
const test2 = verifySignature(testPayload, 'sha256=' + generatedSignature);
console.log('Result:', test2 ? '✅ PASSED' : '❌ FAILED');

// Final result
console.log('\n' + '='.repeat(60));
console.log('FINAL RESULT');
console.log('='.repeat(60));
if (test1 || test2) {
  console.log('✅ Signature verification is WORKING!');
  console.log('The issue is likely the body format mismatch in Vercel.');
} else {
  console.log('❌ Signature verification FAILED');
  console.log('Check the signature key and verification logic.');
}

