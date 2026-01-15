#!/bin/bash

# Test Conservative Flow Fix
# This script clears idempotency and forces the conservative flow to test the fix

echo "🧪 Testing Conservative Flow Fix"
echo "================================="

# Recent payment details from logs
PAYMENT_ID="payment-1768338603914-zzveu"
SQUARE_ID="737pjFr7koP6U0j7pIKFiMgwWo7YY"
WALLET_ADDRESS="0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67"
AMOUNT="1"
EMAIL="test@example.com"

echo "Payment Details:"
echo "Payment ID: $PAYMENT_ID"
echo "Square ID: $SQUARE_ID"
echo "Wallet: $WALLET_ADDRESS"
echo "Amount: $AMOUNT USD"
echo ""

# Step 1: Clear idempotency keys
echo "📋 Step 1: Clearing idempotency keys..."
curl -X POST https://www.tiltvault.com/api/square/clear-conservative-idempotency \
  -H 'Content-Type: application/json' \
  -d "{
    \"paymentId\": \"$PAYMENT_ID\",
    \"squareId\": \"$SQUARE_ID\"
  }" \
  -w "\nHTTP Status: %{http_code}\n"

echo ""
echo "📋 Step 2: Forcing conservative flow..."
curl -X POST https://www.tiltvault.com/api/square/force-conservative-flow \
  -H 'Content-Type: application/json' \
  -d "{
    \"walletAddress\": \"$WALLET_ADDRESS\",
    \"amount\": $AMOUNT,
    \"paymentId\": \"$PAYMENT_ID\",
    \"userEmail\": \"$EMAIL\"
  }" \
  -w "\nHTTP Status: %{http_code}\nResponse Time: %{time_total}s\n"

echo ""
echo "📋 Step 3: Check results"
echo "Expected results:"
echo "- AVAX Transfer: ✅ Success"
echo "- Aave Supply: ✅ Success"
echo "- Both Successful: ✅ Yes"

echo ""
echo "📋 Step 4: Verify on-chain"
echo "AVAX: https://snowtrace.io/address/$WALLET_ADDRESS"
echo "AAVE: https://snowtrace.io/address/0x794a61358D6845594F94dc1DB02A252b5b4814aD"

echo ""
echo "🔍 If this works, the issue was just idempotency blocking."
echo "If it still fails, there's a deeper issue with the transfers themselves."
