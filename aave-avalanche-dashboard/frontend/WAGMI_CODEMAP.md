# Wagmi v2/v3 Integration and Hook Usage in Aave Avalanche Dashboard

**Created:** December 2, 2025 at 8:14 PM  
**Wagmi Version:** v2.19.5  
**Viem Version:** v2.40.3

This codemap traces the complete Wagmi v2.19.5 integration in an Aave V3 Avalanche dashboard, covering configuration setup [1b], contract data reading [2a], transaction writing [3c], and balance management [4a]. The system demonstrates modern React hooks usage with blockchain interactions through a multi-step deposit flow.

---

## App Initialization Flow

### 1a. Wagmi Provider Initialization

**File:** `main.tsx:24-30`

```24:30:aave-avalanche-dashboard/frontend/src/main.tsx
createRoot(document.getElementById("root")!).render(
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);
```

- `createRoot()` renders App
- `WagmiProvider` wraps application with config
- `QueryClientProvider` provides React Query context
- Config imported from `wagmi.ts`

### 1b. Wagmi Configuration Creation

**File:** `wagmi.ts:8-30`

```8:30:aave-avalanche-dashboard/frontend/src/config/wagmi.ts
export const config = createConfig({
  chains: [avalanche],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
    walletConnect({
      projectId,
      showQrModal: true,
      metadata: {
        name: 'Aave Avalanche Dashboard',
        description: 'Aave V3 DeFi dashboard for Avalanche C-Chain',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://aave-balance-checker-84.vercel.app',
        icons: ['https://aave-balance-checker-84.vercel.app/favicon.ico'],
      },
    }),
  ],
  transports: {
    [avalanche.id]: http('https://api.avax.network/ext/bc/C/rpc'),
  },
  // Disable SSR for client-side only
  ssr: false,
})
```

- `createConfig()` initializes Wagmi configuration
- Chains array contains Avalanche mainnet
- Connectors array setup

### 1c. Chain Configuration

**File:** `wagmi.ts:9`

```9:9:aave-avalanche-dashboard/frontend/src/config/wagmi.ts
  chains: [avalanche],
```

- Single chain: Avalanche (43114)
- Imported from `wagmi/chains`

### 1d. WalletConnect Connector Setup

**File:** `wagmi.ts:14-23`

```14:23:aave-avalanche-dashboard/frontend/src/config/wagmi.ts
    walletConnect({
      projectId,
      showQrModal: true,
      metadata: {
        name: 'Aave Avalanche Dashboard',
        description: 'Aave V3 DeFi dashboard for Avalanche C-Chain',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://aave-balance-checker-84.vercel.app',
        icons: ['https://aave-balance-checker-84.vercel.app/favicon.ico'],
      },
    }),
```

- `walletConnect()` with projectId from env vars
- QR modal enabled for mobile wallet connections
- Metadata for WalletConnect display

### 1e. RPC Transport Configuration

**File:** `wagmi.ts:25-27`

```25:27:aave-avalanche-dashboard/frontend/src/config/wagmi.ts
  transports: {
    [avalanche.id]: http('https://api.avax.network/ext/bc/C/rpc'),
  },
```

- HTTP transport to Avalanche public RPC
- Chain ID mapped to transport URL
- ProjectId from env vars (`VITE_WALLETCONNECT_PROJECT_ID`)

---

## Aave Position Data Reading System

### 2a. Main Position Data Fetch

**File:** `useAavePositions.ts:30-39`

```30:39:aave-avalanche-dashboard/frontend/src/hooks/useAavePositions.ts
  const { data: rawData, isLoading: positionsLoading, error } = useReadContract({
    address: CONTRACTS.AAVE_POOL as `0x${string}`,
    abi: AAVE_POOL_ABI,
    functionName: 'getUserAccountData',
    args: address ? [address] : undefined,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 30_000,
    },
  });
```

- `useAavePositions()` hook entry point
- `useReadContract()` calls Aave Pool contract
- `getUserAccountData()` returns total collateral, debt, health factor
- Conditional query enabled only when wallet connected
- Auto-refresh every 30 seconds

### 2b. USDC Reserve Data Fetch

**File:** `useAavePositions.ts:42-48`

```42:48:aave-avalanche-dashboard/frontend/src/hooks/useAavePositions.ts
  const { data: usdcReserveData, isLoading: usdcReserveLoading } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getReserveData',
    args: [CONTRACTS.USDC as `0x${string}`],
    query: { enabled: !!CONTRACTS.AAVE_POOL_DATA_PROVIDER },
  });
```

- Data Provider contract read
- `getReserveData()` for USDC reserve
- Returns liquidity rate, borrow rate, total supply

### 2c. User Reserve Data Fetch

**File:** `useAavePositions.ts:60-69`

```60:69:aave-avalanche-dashboard/frontend/src/hooks/useAavePositions.ts
  const { data: reserveData, isLoading: reserveLoading } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: [CONTRACTS.USDC as `0x${string}`, address!],
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 30_000,
    },
  });
```

- `getUserReserveData()` for user-specific USDC position
- Returns aToken balance, stable debt, variable debt
- Also checks USDC.e variant (lines 72-81)

### 2d. APY Calculation Logic

**File:** `useAavePositions.ts:143-150`

```143:150:aave-avalanche-dashboard/frontend/src/hooks/useAavePositions.ts
  if (usdcReserveData && Array.isArray(usdcReserveData) && usdcReserveData.length >= 12) {
    const [, , , , , liquidityRate, variableBorrowRate] = usdcReserveData;
    usdcSupplyApy = (Number(liquidityRate || 0n) / 1e27) * 100;
    usdcBorrowApy = (Number(variableBorrowRate || 0n) / 1e27) * 100;
    
    console.log('USDC Supply APY:', usdcSupplyApy, '%');
    console.log('USDC Borrow APY:', usdcBorrowApy, '%');
  }
```

- APY calculations from rates
- Liquidity rate → Supply APY (divide by 1e27, multiply by 100)
- Variable borrow rate → Borrow APY
- Similar calculation for WAVAX (lines 153-168)

### 2e. Hook Consumption in UI

**File:** `SimpleDashboard.tsx:15`

```15:15:aave-avalanche-dashboard/frontend/src/components/SimpleDashboard.tsx
  const positions = useAavePositions();
```

- Dashboard component consumes hook
- Returns formatted position data with loading states
- Used in UI to display supplied/borrowed amounts and APYs

---

## DepositModal Component

### 3a. Write Contract Hook Setup

**File:** `DepositModal.tsx:36-44`

```36:44:aave-avalanche-dashboard/frontend/src/components/DepositModal.tsx
  const { writeContractAsync } = useWriteContract({
    mutation: {
      onError: (error) => {
        console.error('Transaction error:', error);
        setError(error.message);
        toast.error(`Transaction failed: ${error.message || 'Unknown error'}`);
      },
    },
  });
```

- Component initialization
- `useWriteContract()` hook with error handling
- `writeContractAsync` for async transaction execution

### 3b. USDC Balance Check

**File:** `DepositModal.tsx:84-95`

```84:95:aave-avalanche-dashboard/frontend/src/components/DepositModal.tsx
      const balance = await readContract(config, {
        address: CONTRACTS.USDC_E as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      setUsdcBalance(balance as bigint);
    } catch (error) {
      console.error('Error fetching USDC balance:', error);
      setError('Failed to fetch USDC balance');
    }
```

- Balance checking flow
- `readContract()` from `@wagmi/core` for direct reads
- Checks USDC.e token balance
- Used to determine available amount for deposit

### 3c. AVAX to USDC Swap Execution

**File:** `DepositModal.tsx:248-259`

```248:259:aave-avalanche-dashboard/frontend/src/components/DepositModal.tsx
      const txHash = await writeContractAsync({
        address: CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`,
        abi: TRADER_JOE_ROUTER_ABI,
        functionName: 'swapExactAVAXForTokens',
        args: [
          amountOutMin,
          path,
          address,
          deadline,
        ],
        value: amountInWei,
      });
```

- Step 1: Swap AVAX → USDC
- Multi-step transaction flow
- TraderJoe router contract interaction
- Sends native AVAX via `value` parameter
- Returns transaction hash

### 3d. USDC Approval Transaction

**File:** `DepositModal.tsx:298-303`

```298:303:aave-avalanche-dashboard/frontend/src/components/DepositModal.tsx
      const txHash = await writeContractAsync({
        address: CONTRACTS.USDC_E as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [poolAddress, maxUint256],
      });
```

- Step 2: Approve USDC spending
- ERC20 `approve()` function call
- Approves Aave Pool to spend USDC
- Uses max uint256 for unlimited approval
- Pool address fetched dynamically from AddressesProvider

### 3e. Aave Supply Transaction

**File:** `DepositModal.tsx:339-349`

```339:349:aave-avalanche-dashboard/frontend/src/components/DepositModal.tsx
      const txHash = await writeContractAsync({
        address: poolAddress,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [
          CONTRACTS.USDC_E as `0x${string}`, // asset
          usdcBalance, // amount
          address, // onBehalfOf
          0 // referralCode (uint16)
        ],
      });
```

- Step 3: Supply to Aave
- Aave Pool `supply()` function
- Supplies USDC.e to Aave protocol
- Receives aTokens in return

### 3f. Transaction Receipt Monitoring

**File:** `DepositModal.tsx:45-62`

```45:62:aave-avalanche-dashboard/frontend/src/components/DepositModal.tsx
  const { data: swapReceipt, isLoading: isSwapLoading } = useWaitForTransactionReceipt({
    hash: txHash!,
    query: {
      enabled: !!txHash && step === 'swap',
    },
  });
  const { data: approveReceipt, isLoading: isApproveLoading } = useWaitForTransactionReceipt({
    hash: txHash!,
    query: {
      enabled: !!txHash && step === 'approve',
    },
  });
  const { data: supplyReceipt, isLoading: isSupplyLoading } = useWaitForTransactionReceipt({
    hash: txHash!,
    query: {
      enabled: !!txHash && step === 'supply',
    },
  });
```

- Transaction monitoring
- Three separate `useWaitForTransactionReceipt()` hooks
- Each enabled based on current step
- Step progression based on receipt status (lines 187-228)
- Auto-advances to next step on success

---

## Wallet Balance System

### 4a. AVAX Balance Fetch

**File:** `useWalletBalances.ts:8-11`

```8:11:aave-avalanche-dashboard/frontend/src/hooks/useWalletBalances.ts
  const { data: avaxBalance, isLoading: isLoadingAvax } = useBalance({
    address,
    chainId: avalanche.id,
  });
```

- `useWalletBalances()` hook entry point
- `useAccount()` for wallet connection (destructures address & isConnected)
- `useBalance()` with chainId param
- Returns native AVAX balance (formatted string)

### 4b. USDC Token Balance Fetch

**File:** `useWalletBalances.ts:14-18`

```14:18:aave-avalanche-dashboard/frontend/src/hooks/useWalletBalances.ts
  const { data: usdcBalance, isLoading: isLoadingUsdc } = useBalance({
    address,
    token: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664' as `0x${string}`, // USDC.e on Avalanche
    chainId: avalanche.id,
  });
```

- Token balance fetch
- `useBalance()` with token address parameter
- Returns USDC.e balance

### 4c. Token Address Specification

**File:** `useWalletBalances.ts:16`

```16:16:aave-avalanche-dashboard/frontend/src/hooks/useWalletBalances.ts
    token: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664' as `0x${string}`, // USDC.e on Avalanche
```

- USDC.e contract address on Avalanche
- Typed as `0x${string}` for Wagmi compatibility

### 4d. Balance Hook Consumption

**File:** `SimpleDashboard.tsx:14`

```14:14:aave-avalanche-dashboard/frontend/src/components/SimpleDashboard.tsx
  const { avaxBalance, usdcBalance, isLoading: balanceLoading } = useWalletBalances();
```

- SimpleDashboard component
- Destructures balances & loading state
- Returns formatted balance strings

### 4e. Balance Display in UI

**File:** `SimpleDashboard.tsx:62`

```62:62:aave-avalanche-dashboard/frontend/src/components/SimpleDashboard.tsx
            <p className="text-2xl font-bold">{balanceLoading ? '...' : parseFloat(avaxBalance).toFixed(4)}</p>
```

- Shows formatted values with loading state
- Displays AVAX balance with 4 decimal places
- Similar display for USDC (line 67)

---

## Key Patterns & Best Practices

### Query Optimization
- All reads use `enabled` condition to prevent unnecessary calls
- Auto-refresh intervals (30s) for position data
- Manual refetch after transactions complete

### Error Handling
- All write operations have error handlers
- Toast notifications for user feedback
- Console logging for debugging

### Type Safety
- All addresses typed as `\`0x${string}\``
- ABI definitions with proper TypeScript types
- Viem types for amounts (bigint)

### Multi-Step Transaction Flow
1. Execute transaction → get hash
2. Wait for receipt → confirm status
3. Advance to next step on success
4. Refetch related data after completion

---

## Hook Distribution

### Custom Hooks (Abstraction Layer)
- `useWalletBalances` - AVAX and USDC balances
- `useAavePositions` - Complete Aave position data (5+ contract reads)
- `useAaveSupply` - Supply/withdraw operations
- `useAaveBorrow` - Borrow/repay operations

### Direct Wagmi Usage
- `useAccount` - Wallet connection state
- `useReadContract` - One-off contract reads
- `useWriteContract` - Transaction execution
- `useWaitForTransactionReceipt` - Transaction confirmation
- `useBalance` - Token balance queries

---

## Version Information

- **Wagmi**: v2.19.5
- **Viem**: v2.40.3
- **React Query**: v5.90.11
- **React**: v18.3.1

All versions are compatible and production-ready.

