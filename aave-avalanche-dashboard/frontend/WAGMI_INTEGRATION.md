# Wagmi v2 Integration Guide - Aave Avalanche Dashboard

## Overview

This dashboard uses **Wagmi v2.19.5** with **Viem v2.40.3** for Ethereum interactions on Avalanche C-Chain. Wagmi v2 provides React hooks for wallet connections, contract reads/writes, and transaction management.

## Architecture

### Core Setup

```typescript
// main.tsx - Provider Setup
<WagmiProvider config={config}>
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
</WagmiProvider>
```

### Configuration (`config/wagmi.ts`)

- **Chains**: Avalanche Mainnet (43114)
- **Connectors**: 
  - WalletConnect (with QR modal)
  - Injected (MetaMask, etc.)
- **Transport**: HTTP RPC to Avalanche

## Hook Usage Patterns

### 1. Account Management

```typescript
// Basic account hook
const { address, isConnected, chainId } = useAccount();

// Disconnect
const { disconnect } = useDisconnect();

// Connect
const { connect, connectors } = useConnect();
```

**Used in:**
- `WalletConnect.tsx`
- `WalletInfo.tsx`
- `SimpleDashboard.tsx`
- All transaction components

### 2. Balance Queries

```typescript
// Native AVAX balance
const { data: avaxBalance } = useBalance({
  address,
  chainId: avalanche.id,
});

// ERC20 token balance (USDC)
const { data: usdcBalance } = useBalance({
  address,
  token: CONTRACTS.USDC as `0x${string}`,
  chainId: avalanche.id,
});
```

**Used in:**
- `useWalletBalances.ts` - Main balance hook
- `useUserBalancesExtended.ts` - Extended balances
- `BasicSupplyModal.tsx` - USDC balance check

### 3. Contract Reads

```typescript
// Read contract state
const { data, isLoading, error, refetch } = useReadContract({
  address: CONTRACTS.AAVE_POOL as `0x${string}`,
  abi: AAVE_POOL_ABI,
  functionName: 'getUserAccountData',
  args: address ? [address] : undefined,
  query: {
    enabled: isConnected && !!address,
    refetchInterval: 30_000, // Auto-refresh every 30s
  },
});
```

**Used in:**
- `useAavePositions.ts` - Position data (5+ contract reads)
- `useAaveSupply.ts` - Balance and allowance checks
- `useAaveBorrow.ts` - Borrowed amounts
- `ActionModal.tsx` - Allowance checks

### 4. Contract Writes

```typescript
// Write contract (transaction)
const { writeContract, isPending, data: hash } = useWriteContract({
  mutation: {
    onError: (error) => {
      toast.error(`Transaction failed: ${error.message}`);
    },
  },
});

// Execute write
await writeContract({
  address: CONTRACTS.AAVE_POOL as `0x${string}`,
  abi: AAVE_POOL_ABI,
  functionName: 'supply',
  args: [tokenAddress, amount, onBehalfOf, referralCode],
});
```

**Used in:**
- `useAaveSupply.ts` - Supply/withdraw operations
- `useAaveBorrow.ts` - Borrow/repay operations
- `ActionModal.tsx` - Multi-action modal
- `DepositModal.tsx` - Multi-step deposit flow
- `WithdrawModal.tsx` - Withdraw flow

### 5. Transaction Receipts

```typescript
// Wait for transaction confirmation
const { 
  isLoading: isConfirming, 
  isSuccess: isConfirmed,
  data: receipt 
} = useWaitForTransactionReceipt({ 
  hash,
  query: {
    enabled: !!hash,
  },
});
```

**Used in:**
- All write operations for confirmation
- `DepositModal.tsx` - Multi-step flow tracking
- `useAaveSupply.ts` - Post-transaction refetch

## Best Practices Implemented

### ✅ Query Optimization

1. **Conditional Queries**: All reads use `enabled` to prevent unnecessary calls
   ```typescript
   query: {
     enabled: isConnected && !!address,
   }
   ```

2. **Auto-refresh**: Position data refreshes every 30 seconds
   ```typescript
   query: {
     refetchInterval: 30_000,
   }
   ```

3. **Manual Refetch**: After transactions, refetch related data
   ```typescript
   if (isConfirmed) {
     refetchBalance();
     refetchAllowance();
   }
   ```

### ✅ Error Handling

- All write operations have error handlers
- Toast notifications for user feedback
- Console logging for debugging

### ✅ Type Safety

- All addresses typed as `\`0x${string}\``
- ABI definitions with `as const` for type inference
- Viem types for amounts (bigint)

### ✅ Dynamic Pool Resolution

Some components use `PoolAddressesProvider` to dynamically resolve pool address:
```typescript
const { data: poolAddress } = useReadContract({
  address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER,
  abi: AAVE_POOL_ADDRESSES_PROVIDER_ABI,
  functionName: 'getPool',
});
```

## Hook Distribution

### Custom Hooks (Abstraction Layer)

1. **`useWalletBalances`** - AVAX and USDC balances
2. **`useAavePositions`** - Complete Aave position data
3. **`useAaveSupply`** - Supply/withdraw operations
4. **`useAaveBorrow`** - Borrow/repay operations
5. **`useUserBalancesExtended`** - Extended balance queries

### Direct Wagmi Usage

Components use Wagmi hooks directly for:
- Simple account checks
- One-off contract reads
- Transaction execution
- Receipt waiting

## Performance Considerations

### Current Implementation

- ✅ Queries are properly enabled/disabled
- ✅ Refetch intervals for live data
- ✅ Manual refetch after mutations
- ⚠️ Some components have multiple `useReadContract` calls (could batch)

### Optimization Opportunities

1. **Batch Queries**: Use `useReadContracts` for multiple reads
2. **Query Deduplication**: React Query handles this automatically
3. **Cache Configuration**: Could add custom cache times
4. **Parallel Queries**: Already implemented in most hooks

## Transaction Flow Patterns

### Simple Transaction
```typescript
1. useWriteContract() → get hash
2. useWaitForTransactionReceipt({ hash }) → wait for confirmation
3. Refetch related queries on success
```

### Multi-Step Transaction (DepositModal)
```typescript
1. Swap AVAX → USDC (step 1)
2. Wait for swap receipt
3. Approve USDC (step 2)
4. Wait for approval receipt
5. Supply to Aave (step 3)
6. Wait for supply receipt
```

## Version Compatibility

- **Wagmi**: v2.19.5
- **Viem**: v2.40.3
- **React Query**: v5.90.11
- **React**: v18.3.1

All versions are compatible and up-to-date.

## Common Patterns

### Pattern 1: Conditional Contract Read
```typescript
const { data } = useReadContract({
  address: CONTRACT_ADDRESS,
  abi: CONTRACT_ABI,
  functionName: 'functionName',
  args: address ? [address] : undefined,
  query: {
    enabled: !!address && isConnected,
  },
});
```

### Pattern 2: Write with Error Handling
```typescript
const { writeContract, isPending } = useWriteContract({
  mutation: {
    onError: (error) => handleError(error),
    onSuccess: () => handleSuccess(),
  },
});
```

### Pattern 3: Transaction Confirmation
```typescript
const { writeContract, data: hash } = useWriteContract();
const { isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

useEffect(() => {
  if (isConfirmed) {
    // Handle success
    refetchData();
  }
}, [isConfirmed]);
```

## Migration Notes

If upgrading to Wagmi v3 (when available):
- Check breaking changes in hooks API
- Update config structure if changed
- Review connector implementations
- Test all transaction flows

## Resources

- [Wagmi Documentation](https://wagmi.sh)
- [Viem Documentation](https://viem.sh)
- [React Query Documentation](https://tanstack.com/query)

