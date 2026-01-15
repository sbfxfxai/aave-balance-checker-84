#!/bin/bash

# Test Conservative Flow After Redis Fix
# This script tests if the conservative flow now works properly

echo "🧪 Testing Conservative Flow After Redis Fix"
echo "=========================================="

# Test data
WALLET_ADDRESS="0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67"
AMOUNT="5"
PAYMENT_ID="test-redis-fix-$(date +%s)"
EMAIL="test@example.com"

echo "Test Configuration:"
echo "Wallet: $WALLET_ADDRESS"
echo "Amount: $AMOUNT USD"
echo "Payment ID: $PAYMENT_ID"
echo ""

# Test 1: Check if webhook is working
echo "📋 Test 1: Test Conservative Flow Endpoint"
echo "Testing the conservative flow directly..."

curl -X POST https://www.tiltvault.com/api/square/test-conservative \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TEST_CONSERVATIVE_AUTH_TOKEN" \
  -d "{
    \"walletAddress\": \"$WALLET_ADDRESS\",
    \"amount\": $AMOUNT,
    \"userEmail\": \"$EMAIL\",
    \"paymentId\": \"$PAYMENT_ID\"
  }" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo ""
echo "📋 Test 2: Check Recent Logs"
echo "Check Vercel logs for:"
echo "- [AVAX] Hub AVAX balance: X.XXXX"
echo "- [AVAX] Using nonce: X"
echo "- [AVAX] Transaction submitted: 0x..."
echo "- [AVAX] ✅ AVAX sent successfully: 0x..."
echo "- [AAVE-HUB] Supplying $X USDC to Aave"
echo "- [AAVE-HUB] ✅ Aave supply successful: 0x..."

echo ""
echo "📋 Test 3: Verify On-Chain Transactions"
echo "Check these URLs for transactions:"
echo "AVAX: https://snowtrace.io/address/$WALLET_ADDRESS"
echo "AAVE: https://snowtrace.io/address/0x794a61358D6845594F94dc1DB02A252b5b4814aD"

echo ""
echo "🎯 Expected Flow After Fix:"
echo "1. ✅ Webhook receives payment"
echo "2. ✅ Rate limit check passes (Redis fix)"
echo "3. ✅ AVAX transfer initiated"
echo "4. ✅ AVAX transfer completes"
echo "5. ✅ Aave execution initiated"
echo "6. ✅ Aave execution completes"
echo "7. ✅ Position updated to active"

echo ""
echo "🔍 If Still Failing:"
echo "1. Check if hub wallet has sufficient AVAX/USDC"
echo "2. Check if gas prices are too high"
echo "3. Check if network is congested"
echo "4. Check if there are other Redis issues"

echo ""
echo "📞 Next Steps:"
echo "1. Run this test script"
echo "2. Check Vercel logs for completion"
echo "3. Verify on-chain transactions"
echo "4. Test with real Square payment"
