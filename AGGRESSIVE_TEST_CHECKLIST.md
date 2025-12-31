# Aggressive Strategy Test Checklist

## 🧪 Test Case: $5 Aggressive Deposit

### Expected Behavior:
1. **Allocation**: 100% GMX ($5.00), 0% Aave ($0.00)
2. **GMX Execution**: Should execute from hub wallet (or Privy if available)
3. **ERGC Debit**: Should debit 1 ERGC if user has ERGC discount
4. **AVAX Fee**: Should send 0.03 AVAX (reduced with ERGC discount) or 0.06 AVAX (without discount)

### Webhook Logs to Verify:
```
[Webhook] ===== ALLOCATION =====
[Webhook] Deposit amount: $5.00
[Webhook] Split: Aave=$0.00 (0%), GMX=$5.00 (100%)

[Webhook] ===== ERGC DEBIT CHECK =====
[Webhook] hasErgcDiscount (balance check): true/false
[Webhook] profile.gmxPercent: 100%
[Webhook] riskProfile: aggressive
[Webhook] shouldDebitErgc: true/false
[Webhook] ergcDebitAmount: 1 or 0

[Webhook] ===== GMX EXECUTION (HUB WALLET) =====
[Webhook] Executing GMX from hub wallet: $5.00
[Webhook] ✅ GMX executed successfully: 0x...

[Webhook] Skipping Aave: aaveAmount is 0 or negative
```

### On-chain Verification:
1. **GMX Position**: Check hub wallet has opened BTC long position
2. **ERGC Transfer**: Check 1 ERGC transferred to hub wallet (if debited)
3. **AVAX Transfer**: Check correct AVAX amount sent to user wallet

### Test Payment Note Format:
```
payment_id:test_001 wallet:0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67 risk:aggressive email:test@example.com
```

### URLs to Check:
- GMX Position: https://snowtrace.io/address/[HUB_WALLET_ADDRESS]
- ERGC Transfer: https://snowtrace.io/address/[ERGC_CONTRACT]
- AVAX Transfer: https://snowtrace.io/address/[USER_WALLET_ADDRESS]

## 🚨 Failure Points to Check:
1. **Privy Module Error**: Falls back to hub wallet (expected)
2. **GMX Execution Fails**: Check hub wallet USDC balance
3. **ERGC Not Debited**: Check user ERGC balance
4. **Timeout**: Check execution time tracking logs

## ✅ Success Criteria:
- GMX position opened successfully
- No Aave execution (correct for aggressive)
- ERGC debited if user has balance
- Webhook completes without timeout
