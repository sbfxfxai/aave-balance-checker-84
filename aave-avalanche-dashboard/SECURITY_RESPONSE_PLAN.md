# Security Response Plan - Wallet Compromise Investigation

## Immediate Actions (Do Now)

### 1. Check Vercel Function Logs
Go to Vercel Dashboard → Your Project → Functions → `/api/square/webhook`
- Filter logs around transaction time: `Jan-3-2026 11:15:56 PM +UTC`
- Search for: `1.217`, `0x763D460bD420111f1b539ce175f7A769b2cAB39E`, `AVAX`
- Look for any webhook calls that might have triggered this

### 2. Check Vercel Environment Variables Access
- Go to Vercel Dashboard → Settings → Environment Variables
- Check audit logs for `HUB_WALLET_PRIVATE_KEY` access
- Review who has access to production environment variables

### 3. Check GitHub for Exposed Keys
```bash
# Run these commands in your repository
git log --all --full-history -S "HUB_WALLET_PRIVATE_KEY" --source --all
git log --all --full-history -S "0xec80A2cB3652Ec599eFBf7Aac086d07F391A5e55" --source --all
git log --all --full-history --grep="private.*key" -i --source --all
```

### 4. Check Local Development Environment
- Check if `.env` files are committed to git
- Check if private keys are in any local files
- Check if keys were shared via email/messaging

### 5. Analyze Transaction Context
- Check Snowtrace for the recipient address: `0x763D460bD420111f1b539ce175f7A769b2cAB39E`
- See if this address has other transactions
- Check if it's a known exchange or service

## Code Security Status

### ✅ Secure
- **No private keys in code**: All keys use `process.env.HUB_WALLET_PRIVATE_KEY`
- **No key logging**: Keys are validated but never logged
- **Standard amounts only**: Code only sends `0.005`, `0.03`, or `0.06` AVAX

### ⚠️ Test Files (Not Production)
- `execute-gmx-sdk.js` - Contains test private key (different from hub wallet)
- `execute-gmx-sdk-lowgas.js` - Contains test private key (different from hub wallet)
- These are test files and don't affect production

## Transaction Analysis

**Amount**: `1.2173162313 AVAX` is **NOT** a standard amount from the code.

**Standard amounts in code**:
- `AVAX_TO_SEND_FOR_GMX = 0.06 AVAX`
- `AVAX_TO_SEND_FOR_AAVE = 0.005 AVAX`
- ERGC discount: `0.03 AVAX`

**This transaction is 20x larger than the largest standard amount.**

## Recommended Actions

### Option 1: If This Was Legitimate
- Document why this transaction was made
- Add logging for all AVAX transfers
- Add amount validation to prevent non-standard transfers

### Option 2: If Wallet is Compromised (RECOMMENDED)
1. **Immediately rotate the private key**:
   - Generate new wallet
   - Update `HUB_WALLET_PRIVATE_KEY` in Vercel
   - Update `HUB_WALLET_ADDRESS` in code
   - Transfer remaining funds to new wallet

2. **Add security measures**:
   - Transaction amount validation
   - Recipient address whitelist
   - Transaction monitoring/alerts
   - Multi-sig wallet (long-term)

3. **Investigate breach**:
   - Review all Vercel function logs
   - Review environment variable access
   - Review GitHub commit history
   - Check for any exposed credentials

## Next Steps

1. **Check Vercel logs** (highest priority)
2. **Check environment variable access** (high priority)
3. **Decide**: Legitimate transaction or compromise?
4. **If compromised**: Rotate keys immediately
5. **If legitimate**: Document and add safeguards

## Prevention Measures to Add

1. **Amount Validation**:
   ```typescript
   // Add to sendAvaxToUser()
   const ALLOWED_AMOUNTS = [
     AVAX_TO_SEND_FOR_GMX,
     AVAX_TO_SEND_FOR_AAVE,
     ethers.parseEther('0.03') // ERGC discount
   ];
   if (!ALLOWED_AMOUNTS.includes(amount)) {
     throw new Error(`Invalid AVAX amount: ${ethers.formatEther(amount)}`);
   }
   ```

2. **Recipient Validation**:
   ```typescript
   // Add whitelist or validation
   if (toAddress.toLowerCase() === HUB_WALLET_ADDRESS.toLowerCase()) {
     throw new Error('Cannot send to hub wallet');
   }
   ```

3. **Transaction Logging**:
   - Log all AVAX transfers with full context
   - Send alerts for non-standard amounts
   - Monitor for suspicious patterns

