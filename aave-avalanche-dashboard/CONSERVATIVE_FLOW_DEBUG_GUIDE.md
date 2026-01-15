# Conservative Flow Debugging Guide

## 🚨 Issue Summary
The webhook needs to initiate both AVAX and Aave transfers for the conservative strategy, but one or both transfers are not happening.

## 🔍 Debugging Steps

### Step 1: Check Webhook Configuration
```bash
# Verify webhook URL in Square dashboard
# Should be: https://your-app.vercel.app/api/square/webhook

# Check webhook is active and receiving events
# In Square Dashboard: Settings > Webhooks > Your webhook
```

### Step 2: Test Conservative Flow Directly
```bash
# Test the conservative flow endpoint
curl -X POST https://your-app.vercel.app/api/square/test-conservative \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TEST_TOKEN' \
  -d '{
    "walletAddress": "0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67",
    "amount": 10,
    "userEmail": "test@example.com",
    "paymentId": "debug_'$(date +%s)'"
  }'
```

### Step 3: Test with Fix Endpoint
```bash
# Test the fix endpoint (if deployed)
curl -X POST https://your-app.vercel.app/api/square/fix-conservative-flow \
  -H 'Content-Type: application/json' \
  -d '{
    "walletAddress": "0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67",
    "amount": 10,
    "paymentId": "fix_test_'$(date +%s)'",
    "force": true
  }'
```

### Step 4: Check Vercel Logs
```bash
# Check recent webhook logs
vercel logs --follow --limit 100

# Look for these specific log messages:
# - [Webhook] [IMMEDIATE] Processing payment
# - [Webhook] [IMMEDIATE] Sending AVAX for gas
# - [Webhook] [IMMEDIATE] 🏦 Executing Aave directly from hub wallet
# - [AVAX] Transaction submitted
# - [AAVE-HUB] Supplying $X USDC to Aave
```

### Step 5: Check Redis Idempotency
```bash
# Connect to Redis and check for existing keys
# Look for keys like: conservative_transfer:payment_id

# If transfers are being skipped due to idempotency:
# 1. Use a new payment ID
# 2. Or add force processing header
```

### Step 6: Check On-Chain Transactions
```bash
# Check AVAX transfers
# URL: https://snowtrace.io/address/USER_WALLET_ADDRESS
# Look for incoming AVAX transactions from hub wallet

# Check Aave supplies
# URL: https://snowtrace.io/address/AAVE_POOL_ADDRESS
# Look for supply transactions involving USDC and user wallet
```

## 🛠️ Common Issues and Fixes

### Issue 1: Webhook Not Triggered
**Symptoms**: No logs in Vercel, transfers not happening
**Causes**: 
- Webhook URL incorrect in Square
- Webhook disabled in Square
- Network issues

**Fixes**:
1. Verify webhook URL in Square dashboard
2. Ensure webhook is active
3. Test webhook with Square's test feature

### Issue 2: Idempotency Blocking Processing
**Symptoms**: "Transfers already sent" message
**Causes**: Same payment ID used multiple times

**Fixes**:
1. Use unique payment ID
2. Clear Redis key: `del conservative_transfer:payment_id`
3. Add force processing header

### Issue 3: Amount Calculation Failing
**Symptoms**: "Cannot determine deposit amount" error
**Causes**: 
- Missing amount in webhook data
- Incorrect amount parsing

**Fixes**:
1. Check payment note format
2. Verify Square webhook data structure
3. Use default amount for testing

### Issue 4: Insufficient Hub Wallet Balance
**Symptoms**: "Insufficient AVAX/USDC" errors
**Causes**: Hub wallet out of funds

**Fixes**:
1. Check hub wallet balances
2. Add funds to hub wallet
3. Monitor balances regularly

### Issue 5: Transaction Failures
**Symptoms**: Transaction submitted but failed
**Causes**: 
- Gas price issues
- Network congestion
- Contract issues

**Fixes**:
1. Check gas price settings
2. Retry with higher gas
3. Verify contract addresses

## 🧪 Test Payment Format

Make sure your test payments use this note format:
```
payment_id:test_123 wallet:0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67 risk:conservative email:test@example.com
```

## 📊 Expected Conservative Flow

1. **Payment Completed** → Square sends webhook
2. **Webhook Received** → Parse payment note
3. **Conservative Detected** → Process immediately
4. **Send AVAX** → 0.005 AVAX to user wallet
5. **Execute Aave** → USDC from hub wallet to Aave (credited to user)
6. **Position Updated** → Status set to 'active'

## 🔧 Quick Fix Implementation

If the conservative flow is not working, apply this quick fix:

1. **Add force processing header** to bypass idempotency
2. **Use default amount** if amount calculation fails
3. **Continue processing** even if AVAX fails
4. **Add better logging** for debugging

## 📞 Support

If issues persist:
1. Check Vercel logs for specific error messages
2. Verify all environment variables are set
3. Test with the fix endpoint
4. Check on-chain transaction status
