# Complete End-to-End Flow Verification

## Current Flow Blockers

### 1. Signature Verification (CRITICAL BLOCKER)
- **Location**: `api/square/webhook.ts` line 5221-5245
- **Issue**: If signature verification fails → returns 401 → **ENTIRE FLOW STOPS**
- **Impact**: Morpho execution never happens, no deposits, no positions
- **Status**: ❌ **BLOCKING ALL PAYMENTS**

### 2. Flow Path After Signature Passes

```
Square Payment → Webhook (POST /api/square/webhook)
  ↓
Signature Verification (line 5221)
  ↓ [IF PASSES]
Parse Event (line 5252)
  ↓
processPaymentEvent (line 5295)
  ↓
handlePaymentCleared (line 3285)
  ↓
Extract wallet address, risk profile, amounts (line 3600-3900)
  ↓
Calculate Morpho allocation (line 3868-3877)
  ↓
Check if morphoAmount > 0 (line 4492)
  ↓
executeMorphoFromHubWallet (line 2509)
  ↓
Connect to Arbitrum RPC (line 2533)
  ↓
Check hub wallet USDC balance (line 2580)
  ↓
Deposit to EURC vault (line 2641)
  ↓
Deposit to DAI vault (line 2680)
  ↓
Save position to Redis (line 4594)
  ↓
Dashboard reads via useMorphoPositions hook
```

## Verification Checklist

### ✅ Code Path Verification
- [x] Signature verification function exists (line 525)
- [x] Morpho execution function exists (line 2509)
- [x] Morpho execution is called when morphoAmount > 0 (line 4492)
- [x] Position is saved with morphoResult (line 4592)
- [x] Dashboard hook reads from Arbitrum (useMorphoPositions.ts)

### ❌ Runtime Verification (BLOCKED BY SIGNATURE)
- [ ] Signature verification passes on real Square webhook
- [ ] Payment processing reaches handlePaymentCleared
- [ ] Morpho allocation calculation works
- [ ] executeMorphoFromHubWallet is called
- [ ] Arbitrum RPC connection succeeds
- [ ] Hub wallet has sufficient USDC
- [ ] EURC vault deposit succeeds
- [ ] DAI vault deposit succeeds
- [ ] Position saved to Redis
- [ ] Dashboard displays position

## Critical Issues to Fix

### Issue 1: Signature Verification Blocking Flow
**Problem**: If signature fails, entire payment is rejected
**Solution Options**:
1. **Fix signature verification** (preferred) - ensure body format matches Square's
2. **Temporary bypass for testing** - add environment variable to skip verification in dev
3. **Better error handling** - log signature mismatch but allow processing with warning

### Issue 2: Body Format Mismatch
**Problem**: Vercel parses JSON automatically, `JSON.stringify()` may not match Square's format
**Current Code**: Line 5167 - `rawBody = JSON.stringify(req.body)`
**Square Expects**: Exact raw JSON string they sent
**Solution**: Need to get raw body before Vercel parses it (may require middleware)

## Test Plan

### Test 1: Signature Verification (Local)
```bash
node test-signature.js
```
**Expected**: ✅ PASSED (already confirmed)

### Test 2: Signature Verification (Deployed)
```bash
curl https://www.tiltvault.com/api/square/webhook?test-signature
```
**Expected**: ✅ PASSED (if deployed with fixes)

### Test 3: Complete Flow (Requires Real Payment)
1. Make $2 Square payment with Morpho profile
2. Check Vercel logs for:
   - `[Webhook] Signature verification: VALID`
   - `[Webhook] ===== MORPHO EXECUTION =====`
   - `[MORPHO] Executing Morpho strategy...`
   - `[MORPHO] ✅ EURC vault deposit confirmed`
   - `[MORPHO] ✅ DAI vault deposit confirmed`
3. Check Arbitrum explorer for transactions
4. Check dashboard for Morpho position

## Next Steps

1. **Deploy signature verification fixes**
2. **Test signature endpoint**: `GET /api/square/webhook?test-signature`
3. **Make test payment** ($2 minimum)
4. **Monitor Vercel logs** for complete flow
5. **Verify on-chain** transactions on Arbitrum
6. **Verify dashboard** shows Morpho position

