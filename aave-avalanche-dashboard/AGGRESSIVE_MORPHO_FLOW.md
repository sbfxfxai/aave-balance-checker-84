# Aggressive/Morpho Strategy Flow Mapping

## Complete Flow from Square Webhook to Morpho Execution

### Phase 1: Webhook Processing & Strategy Selection

**Entry Point:** `webhook.ts:2193`
```typescript
if (strategyType === 'aggressive' && process.env.ENABLE_MORPHO_STRATEGY === 'true') {
  // Queue Morpho strategy execution
}
```

**Flow:**
1. Webhook receives `payment.completed` event
2. Parse payment note → Extract `riskProfile`
3. If `riskProfile === 'aggressive'` → Queue Morpho strategy
4. Create position with status `'executing'`

### Phase 2: Morpho Strategy Queue Processing

**Queue Entry:** `webhook.ts:2305`
```typescript
await redis.lpush('morpho_strategy_queue', JSON.stringify(strategyRequest));
```

**Queue Processing:** `aggressive-flow.ts:processAggressiveQueue()`
- Dequeues jobs from `morpho_strategy_queue`
- Processes each job sequentially
- Updates position status based on results

### Phase 3: Aggressive Flow Execution

**Entry Point:** `aggressive-flow.ts:executeAggressiveFlow()`

#### Step 3.1: AVAX Gas Transfer
```typescript
const AGGRESSIVE_AVAX_AMOUNT = 0.06 AVAX; // Higher than conservative (0.005)
const avaxResult = await sendAvaxTransfer(walletAddress, AGGRESSIVE_AVAX_AMOUNT, 'aggressive deposit');
```
- Higher AVAX amount for complex Morpho operations
- Updates position to `'avax_sent'` on success

#### Step 3.2: Morpho Execution
```typescript
const morphoResult = await executeMorphoFromHubWallet(walletAddress, amount, paymentId);
```

**Inside `executeMorphoFromHubWallet()` (`webhook-morpho.ts`):**

**3.2a. Amount Splitting**
- Splits deposit between Gauntlet and Hyperithm vaults
- Calculates amounts per vault based on allocation

**3.2b. Vault Deposits**
- Deposits to Morpho Gauntlet USDC Vault
- Deposits to Morpho Hyperithm USDC Vault
- Both use `onBehalfOf` parameter (user receives shares)

**3.2c. Transaction Confirmation**
- Waits for confirmations on both vault deposits
- Returns combined result with both tx hashes

### Phase 4: Position Status Updates

**Success Path:**
```typescript
status: 'active'
morphoTxHash: combinedTxHash
morphoAmount: amount
```

**Failure Path:**
```typescript
status: 'supply_failed' (if AVAX sent) or 'failed'
error: morphoResult.error
errorType: morphoResult.errorType
```

### Phase 5: Error Handling

**Error Types:**
- `'insufficient_balance'` - Hub wallet low on USDC
- `'network_error'` - RPC/timeout issues
- `'transaction_failed'` - On-chain revert
- `'approval_failed'` - USDC approval failed

**Error Classification:**
- Similar to conservative flow
- Extracts revert reasons from Morpho vault contracts
- Updates position with error details

## Key Differences from Conservative Flow

| Aspect | Conservative | Aggressive/Morpho |
|--------|-------------|-------------------|
| AVAX Amount | 0.005 AVAX | 0.06 AVAX |
| Protocol | Aave V3 | Morpho Vaults |
| Chain | Avalanche | Arbitrum |
| Execution | Immediate | Queued (async) |
| Yield | Aave supply APY | Morpho lending APY (higher) |
| Complexity | Single deposit | Split across 2 vaults |

## Flow Diagram

```
Square Webhook
    ↓
Parse Payment → riskProfile === 'aggressive'
    ↓
Queue Morpho Strategy (Redis)
    ↓
[Async Processing]
    ↓
1. Send AVAX (0.06) → Update: 'avax_sent'
    ↓
2. Execute Morpho
    ├─ Split amount (Gauntlet + Hyperithm)
    ├─ Deposit to Gauntlet vault
    ├─ Deposit to Hyperithm vault
    └─ Wait for confirmations
         ├─ Success → Update: 'active'
         └─ Failed → Update: 'supply_failed' | 'failed'
```

## Monitoring Points

- Queue length: `llen('morpho_strategy_queue')`
- Processing rate: Track successful vs failed
- Gas usage: Higher than conservative (more complex)
- Vault balances: Monitor Morpho vault utilization
