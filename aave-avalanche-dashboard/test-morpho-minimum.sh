#!/bin/bash

# Test Morpho Minimum Amount ($2.00)
# Replace YOUR_WALLET_ADDRESS with your actual wallet address

WALLET_ADDRESS="YOUR_WALLET_ADDRESS_HERE"

curl -X POST https://www.tiltvault.com/api/square/test-morpho-minimum \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "'$WALLET_ADDRESS'",
    "paymentId": "test-morpho-min-'$(date +%s)'"
  }'

echo ""
echo "Expected amounts:"
echo "- Total: $2.00"
echo "- GauntletUSDC: $1.40 (70%)"  
echo "- HyperithmUSDC: $0.60 (30%)"
