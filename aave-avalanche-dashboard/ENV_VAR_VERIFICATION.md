# Environment Variables Verification for Conservative Flow

## Required Environment Variables

### 1. SQUARE_WEBHOOK_SIGNATURE_KEY ✅
- **Code Location**: `webhook.ts` line 9
- **Required For**: Webhook signature validation
- **Vercel Value**: `hbHTFSJpfXzTSbce975dog`
- **Status**: ✅ Set
- **Usage**: Validates Square webhook signatures
- **Critical**: YES - Without this, webhooks will fail (currently using workaround)

### 2. HUB_WALLET_PRIVATE_KEY ✅
- **Code Location**: `webhook.ts` line 15, `test-conservative.ts` line 28
- **Required For**: 
  - Sending AVAX to user wallets
  - Executing Aave supply from hub wallet
- **Vercel Value**: `d3cbc111acbf8a8b795784d544b9838...` (truncated)
- **Status**: ✅ Set
- **Usage**: 
  - Conservative flow: Sends AVAX for gas, executes Aave supply
  - Must be 32-byte hex string (66 chars with 0x prefix)
- **Critical**: YES - Required for all blockchain transactions

### 3. AVALANCHE_RPC_URL ✅
- **Code Location**: `webhook.ts` line 14, `test-conservative.ts` line 27
- **Required For**: Connecting to Avalanche blockchain
- **Vercel Value**: `https://api.avax.network/ext/bc/...`
- **Default**: `https://api.avax.network/ext/bc/C/rpc`
- **Status**: ✅ Set
- **Usage**: All blockchain interactions (AVAX transfers, Aave, USDC)
- **Critical**: YES - Required for all blockchain operations

### 4. KV_REST_API_URL ✅
- **Code Location**: `webhook.ts` line 494
- **Required For**: Redis operations (rate limiting, idempotency)
- **Vercel Value**: `https://romantic-satyr-40573.upstas...`
- **Fallback**: `process.env.REDIS_URL`
- **Status**: ✅ Set
- **Usage**: 
  - Webhook rate limiting
  - Idempotency tracking
  - Payment info storage
- **Critical**: YES - Webhooks will fail without Redis

### 5. KV_REST_API_TOKEN ✅
- **Code Location**: `webhook.ts` line 495
- **Required For**: Redis authentication
- **Vercel Value**: `AcGIAAIncDFJMDLCY2IzNjVIZTYUNGZ1OTg...` (truncated)
- **Status**: ✅ Set
- **Usage**: Authenticates Redis API calls
- **Critical**: YES - Required for Redis operations

### 6. HUB_WALLET_ADDRESS
- **Code Location**: `webhook.ts` line 16
- **Required For**: Validation and logging
- **Vercel Value**: Not shown in images (check if set)
- **Default**: `0x34c11928868d14bdD7Be55A0D9f9e02257240c24`
- **Status**: ⚠️ Check if set in Vercel
- **Usage**: Used for validation and logging
- **Critical**: NO - Has default value

## Optional Environment Variables

### 7. SQUARE_LOCATION_ID
- **Code Location**: `webhook.ts` line 10
- **Required For**: Square API operations (not used in conservative flow)
- **Vercel Value**: `LABGSTPΩΜΗΟΣ`
- **Status**: ✅ Set
- **Usage**: Square payment processing
- **Critical**: NO - Not used in conservative webhook flow

### 8. NODE_ENV
- **Code Location**: `webhook.ts` lines 717, 1256
- **Required For**: Production/development checks
- **Vercel Value**: `production`
- **Status**: ✅ Set
- **Usage**: 
  - Enables temporary webhook workaround in production
  - Error message formatting
- **Critical**: NO - Optional, but should be `production` in production

### 9. ALLOWED_ORIGINS
- **Code Location**: `webhook.ts` line 545
- **Required For**: CORS headers
- **Vercel Value**: Not shown (check if set)
- **Default**: `['*']`
- **Status**: ⚠️ Check if set
- **Usage**: CORS configuration
- **Critical**: NO - Has default

### 10. ALLOW_CRITICAL_WEBHOOKS
- **Code Location**: `webhook.ts` line 561
- **Required For**: Temporary workaround for signature validation
- **Vercel Value**: Not shown (should be `true` if needed)
- **Status**: ⚠️ Optional - only if signature validation needs bypass
- **Usage**: Allows webhooks through despite signature mismatch
- **Critical**: NO - Temporary workaround only

### 11. ENABLE_MORPHO_STRATEGY
- **Code Location**: `webhook.ts` line 861
- **Required For**: Morpho strategy execution
- **Vercel Value**: Not shown
- **Status**: ⚠️ Check if set
- **Usage**: Enables Morpho strategy queue processing
- **Critical**: NO - Only for aggressive/Morpho strategies

### 12. TEST_CONSERVATIVE_AUTH_TOKEN
- **Code Location**: `test-conservative.ts` line 266
- **Required For**: Test endpoint security
- **Vercel Value**: Not shown
- **Status**: ⚠️ Optional - only for test endpoint
- **Usage**: Protects test-conservative endpoint
- **Critical**: NO - Only for test endpoint

## Conservative Flow Specific Requirements

### What the Conservative Flow Needs:
1. ✅ **HUB_WALLET_PRIVATE_KEY** - To send AVAX and execute Aave
2. ✅ **AVALANCHE_RPC_URL** - To connect to blockchain
3. ✅ **KV_REST_API_URL** - For Redis operations
4. ✅ **KV_REST_API_TOKEN** - For Redis authentication
5. ✅ **SQUARE_WEBHOOK_SIGNATURE_KEY** - For webhook validation (currently using workaround)

### What the Conservative Flow Does NOT Need:
- SQUARE_LOCATION_ID (not used in webhook processing)
- SQUARE_ACCESS_TOKEN (not used in webhook processing)
- PRIVY_APP_ID / PRIVY_APP_SECRET (uses hub wallet fallback)

## Verification Checklist

### Critical (Required for Conservative Flow)
- [x] SQUARE_WEBHOOK_SIGNATURE_KEY is set (`hbHTFSJpfXzTSbce975dog`)
- [x] HUB_WALLET_PRIVATE_KEY is set (truncated: `d3cbc111acbf8a8b795784d544b9838...`)
- [x] AVALANCHE_RPC_URL is set (`https://api.avax.network/ext/bc/...`)
- [x] KV_REST_API_URL is set (`https://romantic-satyr-40573.upstas...`)
- [x] KV_REST_API_TOKEN is set (truncated: `AcGIAAIncDFJMDLCY2IzNjVIZTYUNGZ1OTg...`)

### Important (Should Verify)
- [ ] HUB_WALLET_ADDRESS matches address derived from HUB_WALLET_PRIVATE_KEY
- [x] NODE_ENV is set to `production`
- [ ] ALLOWED_ORIGINS is set (optional, has default `['*']`)

### Optional (Not Required for Conservative Flow)
- [x] SQUARE_LOCATION_ID is set (not used in webhook processing)
- [x] SQUARE_ACCESS_TOKEN is set (not used in webhook processing)
- [ ] ALLOW_CRITICAL_WEBHOOKS (optional, temporary workaround)
- [ ] ENABLE_MORPHO_STRATEGY (only for Morpho strategies)
- [ ] TEST_CONSERVATIVE_AUTH_TOKEN (only for test endpoint)

## Code Verification

### Conservative Flow Execution Path
1. **Webhook receives payment** → `webhook.ts` handler
2. **Signature validation** → Uses `SQUARE_WEBHOOK_SIGNATURE_KEY` (currently using workaround)
3. **Parse payment note** → Gets wallet address and risk profile
4. **If conservative** → Lines 991-1035 in `webhook.ts`:
   - Sends AVAX using `HUB_WALLET_PRIVATE_KEY` + `AVALANCHE_RPC_URL`
   - Executes Aave using `executeAaveFromHubWallet()` which uses:
     - `HUB_WALLET_PRIVATE_KEY`
     - `AVALANCHE_RPC_URL`
     - `USDC_CONTRACT` (hardcoded: `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`)
     - `AAVE_POOL` (hardcoded: `0x794a61358D6845594F94dc1DB02A252b5b4814aD`)
5. **Redis operations** → Uses `KV_REST_API_URL` + `KV_REST_API_TOKEN`

### Environment Variables Used in Conservative Flow

| Variable | Used In | Purpose | Status |
|----------|---------|---------|--------|
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | `webhook.ts:9` | Webhook signature validation | ✅ Set |
| `HUB_WALLET_PRIVATE_KEY` | `webhook.ts:15` | Send AVAX, execute Aave | ✅ Set |
| `AVALANCHE_RPC_URL` | `webhook.ts:14` | Blockchain connection | ✅ Set |
| `KV_REST_API_URL` | `webhook.ts:494` | Redis connection | ✅ Set |
| `KV_REST_API_TOKEN` | `webhook.ts:495` | Redis authentication | ✅ Set |
| `HUB_WALLET_ADDRESS` | `webhook.ts:16` | Validation (has default) | ⚠️ Verify |
| `NODE_ENV` | `webhook.ts:717,1256` | Production checks | ✅ Set to `production` |
| `ALLOWED_ORIGINS` | `webhook.ts:545` | CORS (has default) | ⚠️ Optional |
| `ALLOW_CRITICAL_WEBHOOKS` | `webhook.ts:561` | Temporary workaround | ⚠️ Optional |

## Issues to Address

1. **Signature Validation**: Currently using temporary workaround - needs proper fix
2. **HUB_WALLET_ADDRESS**: Verify it matches the address derived from HUB_WALLET_PRIVATE_KEY
3. **Redis Configuration**: Verify both URL and TOKEN are correct

## Next Steps

1. Verify HUB_WALLET_ADDRESS matches the wallet derived from HUB_WALLET_PRIVATE_KEY
2. Fix signature validation to properly match Square's format
3. Test conservative flow end-to-end with real payment
4. Remove temporary workaround once signature validation is fixed

