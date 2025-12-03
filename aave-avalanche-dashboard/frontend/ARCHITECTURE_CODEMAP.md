# Aave V3 DeFi Dashboard: Complete Architecture Codemap

**Created:** December 3, 2025  
**Last Updated:** December 3, 2025  
**Tech Stack:** React, TypeScript, Wagmi v2.19.5, Viem v2.40.3, React Query

This codemap traces the complete architecture of the Aave V3 DeFi Dashboard on Avalanche C-Chain, from Web3 provider initialization through balance tracking, position monitoring, and transaction execution. Key locations include the Wagmi configuration, balance fetching logic, Aave contract interactions, and the ActionModal transaction flow.

---

## 1. React App Bootstrap

### 1a. App Initialization

**File:** `main.tsx:39`

```typescript
createRoot(document.getElementById("root")!).render(
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);
```

- React 18 `createRoot()` initializes application
- `WagmiProvider` wraps app with blockchain context
- `QueryClientProvider` provides React Query context
- Config imported from `wagmi.ts`

### 1b. Wagmi Provider Setup

**File:** `main.tsx:40-44`

- `<WagmiProvider config={config}>` - Provides blockchain context
- `<QueryClientProvider client={queryClient}>` - Provides data fetching context
- `<App />` - Main application component
- Error suppression for WalletConnect warnings (lines 9-19)

### 1c. Configuration Creation

**File:** `wagmi.ts:8`

```typescript
export const config = createConfig({
  chains: [avalanche],
  connectors: [injected, walletConnect],
  transports: {
    [avalanche.id]: http('https://api.avax.network/ext/bc/C/rpc'),
  },
  ssr: false,
})
```

- `createConfig()` initializes Wagmi configuration
- Single chain: Avalanche C-Chain (43114)
- Connectors: Injected (MetaMask) + WalletConnect
- RPC endpoint: Avalanche public RPC

### 1d. Chain Configuration

**File:** `wagmi.ts:9`

- `chains: [avalanche]` - Avalanche C-Chain configured
- Imported from `wagmi/chains`
- Chain ID: 43114

### 1e. RPC Transport Setup

**File:** `wagmi.ts:26`

- `[avalanche.id]: http('https://api.avax.network/ext/bc/C/rpc')`
- Avalanche public RPC endpoint
- HTTP transport for blockchain communication

### 1f. QueryClient Configuration

**File:** `main.tsx:22-37`

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,        // Data fresh for 30 seconds
      gcTime: 5 * 60 * 1000,   // Cache for 5 minutes
      retry: 1,                 // Retry failed requests once
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
    },
  },
});
```

- Optimized defaults to reduce unnecessary RPC calls
- Stale time prevents excessive refetches
- Cache time keeps data available

---

## 2. Balance Data Flow System

### 2a. Wallet Connection Check

**File:** `useUserBalancesExtended.ts:16`

```typescript
const { address, isConnected } = useAccount();
```

- Wagmi hook for wallet connection state
- Returns user address and connection status
- Used throughout app for conditional rendering

### 2b. AVAX Balance Fetch

**File:** `useUserBalancesExtended.ts:19-25`

```typescript
const { data: avaxBalance, isLoading: isLoadingAvax } = useBalance({
  address,
  chainId: avalanche.id,
  query: {
    enabled: isConnected && !!address,
  },
});
```

- Native AVAX balance fetching
- Uses Wagmi `useBalance()` hook
- Enabled only when wallet connected

### 2c. USDC Balance Fetch

**File:** `useUserBalancesExtended.ts:28-35`

```typescript
const { data: usdcBalance, isLoading: isLoadingUsdc } = useBalance({
  address,
  token: CONTRACTS.USDC_E as `0x${string}`,
  chainId: avalanche.id,
  query: {
    enabled: isConnected && !!address,
  },
});
```

- USDC.e token balance on Avalanche
- Contract address: `0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664`
- ERC20 token balance query

### 2d. Balance Formatting

**File:** `useUserBalancesExtended.ts:60-66`

```typescript
return {
  avaxBalance: avaxBalance?.formatted || '0',
  usdcBalance: usdcBalance?.formatted || '0',
  wavaxBalance: wavaxBalance?.formatted || '0',
  // ... symbols and loading states
};
```

- Formats raw BigInt balances to human-readable strings
- Handles undefined/null cases
- Returns formatted values for UI display

### 2e. UI Integration

**File:** `SimpleDashboard.tsx` (or similar)

- Dashboard components consume balance hooks
- Real-time balance updates via React Query
- Loading states handled automatically

---

## 3. Aave Position Tracking System

### 3a. Account Data Fetch

**File:** `useAavePositions.ts:30-39`

```typescript
const { data: rawData, isLoading: positionsLoading, error } = useReadContract({
  address: CONTRACTS.AAVE_POOL as `0x${string}`,
  abi: AAVE_POOL_ABI,
  functionName: 'getUserAccountData',
  args: address ? [address] : undefined,
  query: {
    enabled: isConnected && !!address,
    refetchInterval: 60_000,  // Refetch every 60 seconds
  },
});
```

- Fetches user's Aave position data
- Returns: total collateral, total debt, available borrows, health factor
- Auto-refetches every 60 seconds

### 3b. Pool Contract Target

**File:** `useAavePositions.ts:31`

- Contract: Aave V3 Pool (`0x794a61358D6845594F94dc1DB02A252b5b4814aD`)
- Uses dynamic pool address from Addresses Provider
- ABI includes `getUserAccountData` function

### 3c. Account Data Method

**File:** `useAavePositions.ts:33`

- `functionName: 'getUserAccountData'`
- Returns array: `[totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor]`
- All values in base units (wei)

### 3d. Position Data Extraction

**File:** `useAavePositions.ts:114-171`

```typescript
const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = rawData;

// Convert to USD values
const totalCollateralUSD = totalCollateralBase 
  ? Number(totalCollateralBase) / 1e8  // Aave uses 8 decimals for USD
  : 0;

const totalDebtUSD = totalDebtBase
  ? Number(totalDebtBase) / 1e8
  : 0;

const healthFactorFormatted = healthFactor && healthFactor > 0n
  ? Number(healthFactor) / 1e18
  : null;
```

- Extracts raw values from contract response
- Converts base units to human-readable format
- Calculates USD values (Aave uses 8 decimals)

### 3e. Health Factor Calculation

**File:** `useAavePositions.ts:171`

- Health factor: `Number(healthFactor) / 1e18`
- Values:
  - `> 1.0`: Safe (can be liquidated if < 1.0)
  - `null`: No debt
- Critical for liquidation risk assessment

### 3f. Reserve Data Fetching

**File:** `useAavePositions.ts:45-110`

- Fetches reserve data for APY calculations
- Gets supply/borrow rates for USDC.e and AVAX
- Calculates APY percentages
- Used for display in dashboard

---

## 4. Supply Operations Flow (ActionModal)

### 4a. Supply Function Entry

**File:** `ActionModal.tsx:318`

```typescript
const handleAction = async (): Promise<void> => {
  // Prevent multiple simultaneous calls
  if (isProcessing) {
    return;
  }
  
  setIsProcessing(true);
  // ... validation and execution
}
```

- Main transaction handler
- Prevents duplicate calls with `isProcessing` guard
- Validates inputs before execution

### 4b. AVAX Balance Check

**File:** `ActionModal.tsx:377-381`

```typescript
// Check AVAX balance for gas fees (need at least 0.01 AVAX)
const minAvaxForGas = 0.01;
if (!avaxBalance || parseFloat(avaxBalance.formatted) < minAvaxForGas) {
  toast.error(`Insufficient AVAX for gas fees...`);
  return;
}
```

- Validates user has enough AVAX for gas
- Prevents failed transactions due to insufficient gas
- Shows clear error message

### 4c. Amount Conversion

**File:** `ActionModal.tsx:232-235`

```typescript
const supplyAmountWei = parseUnits(amount, 6); // USDC.e has 6 decimals
```

- Converts human-readable amount to wei
- USDC.e uses 6 decimals
- Uses Viem `parseUnits()` function

### 4d. Allowance Check

**File:** `ActionModal.tsx:390-410`

```typescript
// Check current allowance
const currentAllowanceValue = allowance !== undefined ? allowance : 0n;

if (currentAllowanceValue >= supplyAmountWei) {
  console.log('Allowance sufficient, skipping approval');
  setStep('supply');
  // Execute supply step directly
  return executeSupplyStep();
}
```

- Checks if pool has sufficient token allowance
- Skips approval if already approved
- Prevents unnecessary approval transactions

### 4e. Approval Transaction (if needed)

**File:** `ActionModal.tsx:465-520`

```typescript
const approveHash = await writeContractAsync({
  address: CONTRACTS.USDC_E as `0x${string}`,
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [poolAddress, maxApproval], // Max approval (2^256 - 1)
});
```

- Approves pool to spend tokens
- Uses max approval to avoid repeated approvals
- Waits for confirmation before proceeding

### 4f. Supply Transaction

**File:** `ActionModal.tsx:250-265`

```typescript
const supplyHash = await writeContractAsync({
  address: poolAddress as `0x${string}`,
  abi: AAVE_POOL_ABI,
  functionName: 'supply',
  args: [
    CONTRACTS.USDC_E as `0x${string}`,  // Asset address
    supplyAmountWei,                      // Amount in wei
    address,                              // On behalf of
    0,                                    // Referral code
  ],
});
```

- Calls Aave Pool `supply()` function
- Transfers tokens to Aave protocol
- Receives aTokens in return

### 4g. Transaction Confirmation

**File:** `ActionModal.tsx:267-319`

```typescript
// Wait 3 seconds for transaction to be indexed
await new Promise(resolve => setTimeout(resolve, 3000));

const receipt = await waitForTransactionReceipt(config, { 
  hash: supplyHash,
  timeout: 120_000,        // 2 minute timeout
  pollingInterval: 2_000,  // Poll every 2 seconds
});
```

- Waits for transaction to be indexed (prevents "unfinalized data" errors)
- Polls for receipt with 2-second intervals
- 2-minute timeout with graceful error handling

### 4h. Error Handling

**File:** `ActionModal.tsx:294-318`

```typescript
catch (timeoutError: unknown) {
  const error = timeoutError as { name?: string; message?: string; details?: string };
  const isTimeout = error?.name === 'WaitForTransactionReceiptTimeoutError';
  const isUnfinalized = error?.message?.includes('cannot query unfinalized data');
  
  if (isTimeout || isUnfinalized) {
    // Show success message with explorer link
    toast.success('Transaction submitted! Check explorer for status.');
    // Refetch balances and close modal
  }
}
```

- Handles timeout errors gracefully
- Handles "unfinalized data" errors
- Shows success message with explorer link
- Refetches balances in case transaction completed

---

## 5. Key Improvements Made

### 5a. Infinite Recursion Fix

**File:** `ActionModal.tsx:319-323`

- Added `isProcessing` guard to prevent duplicate calls
- Changed recursive `handleAction()` calls to direct `executeSupplyStep()` calls
- Prevents "too much recursion" errors

### 5b. Timeout Handling

**File:** `ActionModal.tsx:271-273`

- Increased timeout: 60s → 120s
- Reduced polling: 1s → 2s intervals
- Added 3-second delay before querying receipt
- Graceful handling of timeout/unfinalized errors

### 5c. AVAX Balance Validation

**File:** `ActionModal.tsx:377-381`

- Checks for minimum 0.01 AVAX before transactions
- Prevents failed transactions due to insufficient gas
- Clear error messages

### 5d. Error Suppression

**File:** `main.tsx:9-19`

- Suppresses harmless WalletConnect warnings
- Filters console errors for better developer experience
- Keeps important errors visible

### 5e. React Query Optimization

**File:** `main.tsx:22-37`

- Increased stale time: 10s → 30s
- Disabled refetch on reconnect
- Reduced refetch intervals in hooks
- Fewer unnecessary RPC calls

---

## 6. Contract Addresses

**File:** `config/contracts.ts`

```typescript
export const CONTRACTS = {
  AAVE_POOL_ADDRESSES_PROVIDER: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
  AAVE_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',  // Dynamic
  USDC_E: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664',
  WAVAX: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  TRADER_JOE_ROUTER: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4',
};
```

- All Avalanche C-Chain contract addresses
- Pool address resolved dynamically from Addresses Provider
- Used throughout application

---

## 7. Transaction Flow Summary

1. **User Input** → Amount entered in ActionModal
2. **Validation** → AVAX balance, USDC balance, amount checks
3. **Allowance Check** → Query current token allowance
4. **Approval** (if needed) → Approve pool to spend tokens
5. **Supply** → Call Aave Pool `supply()` function
6. **Confirmation** → Wait for transaction receipt (with timeout handling)
7. **Refresh** → Refetch balances and positions
8. **Close** → Reset state and close modal

---

## 8. Key Files Reference

- `main.tsx` - App initialization and providers
- `config/wagmi.ts` - Wagmi configuration
- `config/contracts.ts` - Contract addresses and ABIs
- `hooks/useAavePositions.ts` - Position data fetching
- `hooks/useUserBalancesExtended.ts` - Balance fetching
- `components/ActionModal.tsx` - Transaction execution (supply/withdraw/borrow/repay)
- `components/SimpleDashboard.tsx` - Main dashboard UI

---

**Last Updated:** December 3, 2025  
**Version:** 1.0.0

