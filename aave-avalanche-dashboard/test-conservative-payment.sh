#!/bin/bash

# Test Conservative Payment Flow
# This script tests the complete conservative flow: USDC transfer + AVAX transfer + Aave supply

# Configuration
WALLET_ADDRESS="${1:-0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67}"  # Default to your wallet, or pass as first arg
AMOUNT="${2:-10}"  # Default $10, or pass as second arg
API_URL="${3:-https://www.tiltvault.com}"  # Default production, or pass as third arg

echo "=========================================="
echo "Testing Conservative Payment Flow"
echo "=========================================="
echo "Wallet: $WALLET_ADDRESS"
echo "Amount: \$$AMOUNT"
echo "API: $API_URL"
echo ""

# Make test request
echo "Sending test request..."
curl -X POST "$API_URL/api/square/test-conservative" \
  -H "Content-Type: application/json" \
  -d "{
    \"walletAddress\": \"$WALLET_ADDRESS\",
    \"amount\": $AMOUNT,
    \"paymentId\": \"test-$(date +%s)\"
  }" \
  | jq '.'

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "Check the response above for:"
echo "  ✅ USDC transfer txHash"
echo "  ✅ AVAX transfer txHash"
echo "  ✅ Aave supply txHash"
echo ""
echo "Verify on Snowtrace:"
echo "  - User wallet received USDC: https://snowtrace.io/address/$WALLET_ADDRESS"
echo "  - User wallet received AVAX: https://snowtrace.io/address/$WALLET_ADDRESS"
echo "  - User wallet has aUSDC tokens (Aave supply): https://snowtrace.io/address/$WALLET_ADDRESS"
echo ""

