#!/bin/bash

# Conservative Flow Debug Script
# This script helps debug why the conservative flow isn't working properly

echo "🔍 Conservative Flow Debug Script"
echo "=================================="
echo ""

# Check environment variables
echo "📋 Checking Environment Variables..."
echo "AVALANCHE_RPC_URL: ${AVALANCHE_RPC_URL:0:50}..."
echo "HUB_WALLET_PRIVATE_KEY: ${HUB_WALLET_PRIVATE_KEY:0:10}..."
echo "KV_REST_API_URL: ${KV_REST_API_URL:0:50}..."
echo ""

# Test 1: Check hub wallet balance
echo "📋 Test 1: Hub Wallet Balance"
if command -v cast &> /dev/null; then
    echo "Using cast to check balances..."
    
    # Get hub wallet address
    HUB_ADDRESS=$(cast wallet address --private-key $HUB_WALLET_PRIVATE_KEY)
    echo "Hub Wallet Address: $HUB_ADDRESS"
    
    # Check AVAX balance
    AVAX_BALANCE=$(cast balance $HUB_ADDRESS --rpc-url $AVALANCHE_RPC_URL)
    echo "AVAX Balance: $AVAX_BALANCE"
    
    # Check USDC balance
    USDC_BALANCE=$(cast call 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E "balanceOf(address)" $HUB_ADDRESS --rpc-url $AVALANCHE_RPC_URL)
    USDC_BALANCE_ETH=$(echo "scale=6; $USDC_BALANCE / 1000000" | bc 2>/dev/null || echo "$USDC_BALANCE")
    echo "USDC Balance: $USDC_BALANCE_ETH USDC"
else
    echo "❌ cast not found. Please install foundry or use Node.js script instead."
fi
echo ""

# Test 2: Check recent webhook logs
echo "📋 Test 2: Recent Webhook Logs"
echo "To check recent webhook logs, run:"
echo "vercel logs --follow --limit 50"
echo ""

# Test 3: Test webhook endpoint directly
echo "📋 Test 3: Test Webhook Endpoint"
echo "To test the webhook endpoint directly, run:"
echo "curl -X POST https://your-app.vercel.app/api/square/webhook \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'Square-Signature: test' \\"
echo "  -d '{"
echo "    \"type\": \"payment.completed\","
echo "    \"data\": {"
echo "      \"object\": {"
echo "        \"payment\": {"
echo "          \"id\": \"test_payment_123\","
echo "          \"amount_money\": {"
echo "            \"amount\": 10500,"
echo "            \"currency\": \"USD\""
echo "          },"
echo "          \"note\": \"payment_id:test_123 wallet:0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67 risk:conservative email:test@example.com\""
echo "        }"
echo "      }"
echo "    }"
echo "  }'"
echo ""

# Test 4: Check test-conservative endpoint
echo "📋 Test 4: Test Conservative Endpoint"
echo "To test the conservative flow directly, run:"
echo "curl -X POST https://your-app.vercel.app/api/square/test-conservative \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'Authorization: Bearer YOUR_TEST_TOKEN' \\"
echo "  -d '{"
echo "    \"walletAddress\": \"0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67\","
echo "    \"amount\": 10,"
echo "    \"userEmail\": \"test@example.com\","
echo "    \"paymentId\": \"test_$(date +%s)\""
echo "  }'"
echo ""

# Test 5: Check Redis for recent transfers
echo "📋 Test 5: Check Redis for Recent Transfers"
echo "To check if transfers were already processed, check Redis keys:"
echo "conservative_transfer:*"
echo ""

echo "🎯 Debugging Complete!"
echo "===================="
echo ""
echo "Common Issues:"
echo "1. ❌ Insufficient hub wallet balance"
echo "2. ❌ Webhook not being triggered by Square"
echo "3. ❌ Transfers already processed (idempotency)"
echo "4. ❌ Invalid wallet address in payment note"
echo "5. ❌ Amount calculation issues"
echo ""
echo "Next Steps:"
echo "1. Check Vercel logs for webhook errors"
echo "2. Verify Square is sending webhooks to correct URL"
echo "3. Test with test-conservative endpoint"
echo "4. Check on-chain transactions if transfers are happening"
