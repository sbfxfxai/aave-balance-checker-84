# Conservative Strategy Flow Verification

## Complete Flow Mapping Verification ✅

This document verifies the complete conservative strategy flow from test endpoints through production webhook processing.

---

## Flow Components Verified

### ✅ 1. Test Conservative Flow Endpoint

**Location:** `api/square/test-conservative.ts:257`

**Flow:**
```
POST /api/square/test-conservative
  ↓
Validate walletAddress & amount
  ↓
Step 1: sendAvaxTransfer() → AVAX for gas
  ↓
Step 2: executeAaveFromHubWallet() → USDC to Aave
  ↓
Return results with tx hashes
```

**Key Points:**
- ✅ Validates inputs (wallet address format, positive amount)
- ✅ Uses `CONSERVATIVE_AVAX_AMOUNT` (0.005 AVAX)
- ✅ Records USDC flow: "USDC → Aave, not wallet"
- ✅ Returns comprehensive results object

---

### ✅ 2. AVAX Transfer with Gas Price Management

**Location:** `api/square/webhook-transfers.ts:596`

**Flow:**
```
sendAvaxTransfer()
  ↓
getProvider() → RPC connection
  ↓
calculateAvaxAmount() → Dynamic calculation
  ├─ getFeeData() → Current gas price
  ├─ estimatedGas * gasPrice
  └─ Apply 1.5x multiplier
  ↓
Check hub wallet balance
  ↓
Get nonce (pending)
  ↓
Calculate minimum gas price
  ├─ getBlock('latest') → Base fee
  └─ baseFee * 120% (20% priority)
  ↓
Send transaction with calculated gas
  ↓
Wait for confirmation (CONFIRMATION_DEPTH_LOW)
  ↓
Return Result<{txHash}>
```

**Key Features:**
- ✅ Dynamic AVAX calculation based on current gas prices
- ✅ Base fee + 20% priority fee minimum
- ✅ Explicit nonce management
- ✅ Balance check before sending
- ✅ Proper error classification

---

### ✅ 3. Aave Supply Execution from Hub Wallet

**Location:** `api/square/webhook-transfers.ts:714`

**Flow:**
```
executeAaveFromHubWallet()
  ↓
Convert USD → USDC microunits (6 decimals)
  ├─ amountCents = Math.round(amountUsd * 100)
  └─ usdcAmount = BigInt(amountCents * 10000)
  ↓
Check hub wallet USDC balance
  ↓
checkSupplyCap() → Validate cap
  ├─ Query Aave Data Provider
  ├─ Query PoolConfigurator
  ├─ Check reserve status (active/paused/frozen)
  ├─ Calculate projected total
  └─ Apply 1% safety buffer
  ↓
Approve USDC (MaxUint256)
  ↓
aavePool.supply()
  ├─ USDC_CONTRACT (asset)
  ├─ usdcAmount (amount)
  ├─ walletAddress (onBehalfOf) ← User receives aTokens
  └─ 0 (referral code)
  ↓
Wait for confirmation (variable depth)
  ↓
Return Result<{txHash}>
```

**Critical Details:**
- ✅ **onBehalfOf = walletAddress**: User receives aUSDC, not hub wallet
- ✅ **MaxUint256 approval**: One-time efficient approval
- ✅ **Supply cap validation**: Prevents wasted gas
- ✅ **Variable confirmation depth**: Higher for large amounts

---

### ✅ 4. Supply Cap Validation Flow

**Location:** `api/square/webhook-transfers.ts:117`

**Flow:**
```
checkSupplyCap()
  ↓
Retry Loop (3 attempts with fallback RPCs)
  ↓
Fetch Reserve Data (parallel)
  ├─ dataProvider.getReserveData()
  └─ aavePool.getConfiguration()
  ↓
Check Reserve Status (bitmask)
  ├─ Bit 0: isActive
  ├─ Bit 1: isFrozen
  └─ Bit 2: isPaused
  ↓
Get Supply Cap
  ├─ Get PoolConfigurator address
  └─ poolConfigurator.getSupplyCap()
  ↓
Calculate Projected Total
  ├─ currentSupply + usdcAmount
  └─ Apply 1% safety buffer
  ↓
Compare Against Effective Cap
  ├─ If exceeds → Return error
  └─ If safe → Return success
```

**Enhancements:**
- ✅ 3× retry with exponential backoff + jitter
- ✅ Fallback RPC providers
- ✅ Reserve status checks (active/paused/frozen)
- ✅ 1% safety buffer for race conditions
- ✅ Utilization warnings (>90%, >95%)
- ✅ External alerting hooks

---

### ✅ 5. Square Webhook Payment Processing

**Location:** `api/square/webhook.ts:2193, 3045, 3185`

**Flow:**
```
Webhook receives payment.completed
  ↓
Parse payment note → Extract wallet/risk profile
  ↓
Strategy Selection
  ├─ If 'conservative' → Execute flow
  └─ If 'aggressive' → Queue Morpho
  ↓
Build Idempotency Key
  └─ conservative_flow_executed:{paymentId}
  ↓
Atomic Idempotency Check (Redis SET NX)
  ├─ If exists → Return early (already processed)
  └─ If new → Continue processing
  ↓
Acknowledge Square (200 OK) ← Within 10 seconds
  ↓
Async Processing (non-blocking)
  ├─ sendAvaxTransfer() → AVAX for gas
  └─ executeAaveFromHubWallet() → USDC to Aave
  ↓
Update Position Status
  ├─ Success → 'active'
  └─ Failure → 'supply_failed' | 'gas_sent_cap_failed' | 'failed'
```

**Key Features:**
- ✅ Immediate Square acknowledgment
- ✅ Atomic idempotency (SET NX)
- ✅ Async processing after acknowledgment
- ✅ Position status tracking

---

### ✅ 6. Force Conservative Flow (Debugging)

**Location:** `api/square/force-conservative-flow.ts:191`

**Flow:**
```
POST /api/square/force-conservative-flow
  ↓
Validate inputs (walletAddress, amount, paymentId)
  ↓
Bypass idempotency (force mode)
  ↓
Step 1: sendAvaxTransfer()
  ├─ Fetch feeData
  ├─ Get latest block
  ├─ Calculate 120% of base fee
  └─ Cap at 100 gwei
  ↓
Step 2: executeAaveFromHubWallet()
  ├─ Convert to microunits
  ├─ Check supply cap
  ├─ Approve USDC
  └─ Call supply()
  ↓
Return tx hashes
```

**Use Case:** Testing/debugging without idempotency checks

---

### ✅ 7. Idempotency Management

**Location:** `api/square/clear-conservative-idempotency.ts:11`

**Flow:**
```
POST /api/square/clear-conservative-idempotency
  ↓
Validate paymentId or squareId
  ↓
Build Keys to Delete
  ├─ conservative_flow_executed:{paymentId}
  └─ processed_payment:{paymentId}
  ↓
Delete Redis Keys
  └─ redis.del(key) for each
  ↓
Return Deletion Results
```

**Use Case:** Clear idempotency to allow reprocessing for testing

---

### ✅ 8. Redis Client Initialization

**Location:** `api/utils/redis.ts:34`

**Flow:**
```
getRedis()
  ↓
Check for cached error (stale)
  ├─ If error exists & recent → Throw
  └─ If error stale → Reset
  ↓
Return Cached Client (if exists)
  ↓
Wait for In-Progress Init (if exists)
  ↓
Start New Initialization
  ├─ Validate env vars (KV_REST_API_URL, KV_REST_API_TOKEN)
  ├─ Create Redis instance
  └─ Validate Connection
      ├─ redis.ping()
      └─ Promise.race with 5s timeout
  ↓
Return Initialized Client
```

**Features:**
- ✅ Race condition prevention
- ✅ Connection validation with timeout
- ✅ Error caching (prevents spam)
- ✅ Automatic error reset after timeout

---

## Flow Verification Summary

| Component | Status | Key Features |
|-----------|--------|--------------|
| Test Endpoint | ✅ Verified | Input validation, comprehensive results |
| AVAX Transfer | ✅ Verified | Dynamic gas, base fee + priority, nonce management |
| Aave Supply | ✅ Verified | onBehalfOf correct, MaxUint256, cap validation |
| Supply Cap Check | ✅ Verified | Retry logic, reserve status, safety buffer |
| Webhook Processing | ✅ Verified | Atomic idempotency, async processing |
| Force Flow | ✅ Verified | Bypass idempotency, gas price fixes |
| Idempotency Clear | ✅ Verified | Multi-key deletion, error handling |
| Redis Client | ✅ Verified | Race prevention, connection validation |

---

## Critical Flow Points

### 1. Idempotency Key Format
```
conservative_flow_executed:{paymentId}
```
- ✅ Consistent across all endpoints
- ✅ Uses payment ID (Square or internal)
- ✅ TTL: 24 hours (IDEMPOTENCY_TTL_SECONDS)

### 2. onBehalfOf Parameter
```typescript
aavePool.supply(USDC_CONTRACT, usdcAmount, walletAddress, 0)
//                                 ↑
//                         User receives aTokens
```
- ✅ **Critical**: User wallet receives aUSDC, not hub wallet
- ✅ Hub wallet pays for transaction
- ✅ User earns yield

### 3. USDC Flow Path
```
Hub Wallet → Aave Pool → User Wallet (aTokens)
NOT: Hub Wallet → User Wallet → Aave Pool
```
- ✅ USDC never touches user's regular wallet balance
- ✅ Goes directly to Aave savings
- ✅ User receives interest-bearing aUSDC tokens

### 4. Gas Price Management
```typescript
minGasPrice = (baseFee * 120n) / 100n; // 20% priority
```
- ✅ Ensures transaction inclusion
- ✅ Prevents "transaction underpriced" errors
- ✅ Caps at reasonable maximum (100 gwei)

---

## Production Readiness Checklist

- [x] Test endpoint with authentication
- [x] AVAX transfer with dynamic gas calculation
- [x] Aave supply with cap validation
- [x] Idempotency protection (atomic SET NX)
- [x] Error classification and handling
- [x] Position status tracking
- [x] Debug endpoints (force flow, clear idempotency)
- [x] Redis client with connection validation
- [x] Comprehensive logging
- [x] Webhook acknowledgment within 10 seconds

---

## Flow is Production-Ready ✅

All components verified and working correctly. The conservative strategy flow is fully functional and production-ready.
