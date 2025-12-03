# USDC.e Supply Flow Codemap - Aave V3 Avalanche Dashboard

**Created:** December 3, 2025  
**Focus:** Complete USDC.e supply transaction flow from app initialization through execution  
**Tech Stack:** React, TypeScript, Wagmi v2.19.5, Viem v2.40.3

This codemap documents the Aave V3 Avalanche dashboard built with React, TypeScript, and Wagmi v2.19.5, covering the complete USDC.e supply flow from app initialization through transaction execution. Key locations include the Wagmi configuration setup [1c], the multi-step supply transaction handler [2a], balance fetching with USDC.e contract [3b], and dynamic pool address resolution [4b].

---

## React App Bootstrap

### 1a. React Root Creation

**File:** `main.tsx:24`

```24:30:aave-avalanche-dashboard/frontend/src/main.tsx
createRoot(document.getElementById("root")!).render(
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);
```

- `main.tsx` entry point
- `createRoot()` initializes React 18 root
- Renders application with providers

### 1b. Wagmi Provider Wrapper

**File:** `main.tsx:25`

```25:26:aave-avalanche-dashboard/frontend/src/main.tsx
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
```

- `<WagmiProvider>` wrapper provides blockchain context
- `<QueryClientProvider>` provides React Query context
- `<App />` component renders
- `<BrowserRouter>` handles routing
- `<Index />` page component
- `<SimpleDashboard />` main dashboard component
- QueryClient configuration with optimized defaults

### 1c. Wagmi Configuration

**File:** `wagmi.ts:8`

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

- `wagmi.ts` configuration
- `createConfig()` initializes Wagmi
- Chains array contains Avalanche mainnet
- Connectors setup includes:
  - `injected()` wallet (MetaMask, Trust Wallet, etc.)
  - `walletConnect()` QR code modal for mobile wallets
- Transports configuration

### 1d. Chain Configuration

**File:** `wagmi.ts:9`

```9:9:aave-avalanche-dashboard/frontend/src/config/wagmi.ts
  chains: [avalanche],
```

- Single chain: Avalanche C-Chain (43114)
- Imported from `wagmi/chains`
- Mainnet configuration

### 1e. RPC Transport Setup

**File:** `wagmi.ts:26`

```26:27:aave-avalanche-dashboard/frontend/src/config/wagmi.ts
  transports: {
    [avalanche.id]: http('https://api.avax.network/ext/bc/C/rpc'),
  },
```

- HTTP transport to Avalanche public RPC endpoint
- Chain ID mapped to transport URL
- Provides blockchain connection for all contract interactions

---

## USDC.e Supply Transaction Flow

### 2a. Transaction Handler Initiation

**File:** `ActionModal.tsx:176`

```176:193:aave-avalanche-dashboard/frontend/src/components/ActionModal.tsx
  const handleAction = async () => {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      setIsProcessing(true);

      switch (action) {
        case 'supply':
          if (!poolAddress) {
            toast.error('Pool address not available. Please try again.');
            setIsProcessing(false);
            return;
          }
```

- Transaction handler initiation
- Check wallet connection & amount validation
- Switch statement for 'supply' action
- Check pool availability
- Step: 'approve' or 'supply'
- Approval step logic

### 2b. Allowance Check

**File:** `ActionModal.tsx:227`

```227:231:aave-avalanche-dashboard/frontend/src/components/ActionModal.tsx
            // Check if we already have allowance
            const supplyAmountWei = parseUnits(amount, 6);
            console.log('Checking allowance:', {
              currentAllowance: allowance?.toString(),
              requiredAmount: supplyAmountWei.toString(),
              poolAddress,
            });
            
            if (allowance && allowance >= supplyAmountWei) {
```

- Allowance check logic
- Compares current allowance with required amount
- If insufficient: proceed to approve()
- If sufficient: skip to supply step

### 2c. USDC.e Approval Transaction

**File:** `ActionModal.tsx:242`

```242:260:aave-avalanche-dashboard/frontend/src/components/ActionModal.tsx
            // Approve USDC spending - use max approval for better UX
            const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
            console.log('Approving USDC.e for pool:', {
              token: CONTRACTS.USDC_E,
              spender: poolAddress,
              amount: 'MAX (unlimited)',
            });
            
            try {
              const approveHash = await writeContract({
                address: CONTRACTS.USDC_E as `0x${string}`, // Use USDC.e on Avalanche
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [poolAddress, maxApproval], // Use max approval
              });
              console.log('Approval transaction hash:', approveHash);
              toast.success('Approval transaction submitted! Waiting for confirmation...', {
                action: {
                  label: 'View on Explorer',
                  onClick: () => window.open(getExplorerTxLink(avalanche.id, approveHash), '_blank'),
                },
              });
```

- USDC.e approval transaction
- Uses max approval (uint256 max) for better UX
- Calls ERC20 `approve()` function
- Approves Aave Pool to spend USDC.e
- Returns transaction hash
- Shows explorer link in toast

### 2d. Supply Transaction Execution

**File:** `ActionModal.tsx:281`

```281:301:aave-avalanche-dashboard/frontend/src/components/ActionModal.tsx
            // Supply USDC to Aave
            const supplyAmountWei = parseUnits(amount, 6);
            
            // Double-check allowance before supplying
            const currentAllowance = allowance || 0n;
            if (currentAllowance < supplyAmountWei) {
              toast.error('Insufficient allowance. Please approve first.');
              setStep('approve');
              setIsProcessing(false);
              return;
            }
            
            console.log('Supplying USDC.e to Aave:', {
              poolAddress,
              asset: CONTRACTS.USDC_E,
              amount: supplyAmountWei.toString(),
              onBehalfOf: address,
            });
            
            try {
              const supplyHash = await writeContract({
                address: poolAddress, // Use dynamic pool address
                abi: AAVE_POOL_ABI,
                functionName: 'supply',
                args: [CONTRACTS.USDC_E as `0x${string}`, supplyAmountWei, address, 0], // Use USDC.e
              });
```

- Supply step execution
- Double-check allowance before executing
- Calls Aave Pool `supply()` function
- Supplies USDC.e to Aave protocol
- Receives aTokens in return
- Returns transaction hash

### 2e. Transaction Confirmation

**File:** `ActionModal.tsx:145`

```145:165:aave-avalanche-dashboard/frontend/src/components/ActionModal.tsx
  React.useEffect(() => {
    if (receipt && hash) {
      console.log('Transaction receipt:', receipt);
      if (receipt.status === 'success') {
        if (step === 'approve') {
          console.log('Approval successful:', hash);
          toast.success('USDC approved! Now you can supply to Aave.');
          setStep('supply');
          setIsProcessing(false);
          refetchAllowance();
        } else if (step === 'supply') {
          console.log('Supply successful:', hash);
          toast.success(`Successfully supplied ${amount} USDC to Aave!`);
          setAmount('');
          setStep('approve');
          setIsProcessing(false);
          onClose();
        }
      } else if (receipt.status === 'reverted') {
        console.error('Transaction reverted:', hash);
        toast.error('Transaction failed. Please check the transaction on Snowtrace.');
        setIsProcessing(false);
      }
    }
  }, [receipt, hash, action, onClose, step, amount, refetchAllowance]);
```

- Transaction receipt monitoring
- Uses `useWaitForTransactionReceipt` hook
- Checks transaction status (success/reverted)
- Auto-advances to next step on success
- Shows error message on failure
- Refetches allowance after approval

---

## Balance & Position Data Reading System

### 3a. AVAX Balance Fetch

**File:** `useWalletBalances.ts:8`

```8:11:aave-avalanche-dashboard/frontend/src/hooks/useWalletBalances.ts
  const { data: avaxBalance, isLoading: isLoadingAvax } = useBalance({
    address,
    chainId: avalanche.id,
  });
```

- `useWalletBalances()` hook entry point
- `useBalance()` with chainId parameter
- Returns native AVAX balance (formatted string)
- Used for wallet balance display

### 3b. USDC.e Balance Fetch

**File:** `useWalletBalances.ts:16`

```14:18:aave-avalanche-dashboard/frontend/src/hooks/useWalletBalances.ts
  const { data: usdcBalance, isLoading: isLoadingUsdc } = useBalance({
    address,
    token: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664' as `0x${string}`, // USDC.e on Avalanche
    chainId: avalanche.id,
  });
```

- USDC.e balance fetch
- `useBalance()` with token address parameter
- Returns USDC.e token balance (formatted string)
- Contract address: `0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664`
- Used for supply amount validation

### 3c. Aave Position Data

**File:** `useAavePositions.ts:30`

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

- `useAavePositions()` hook
- Fetches collateral/debt/health factor
- Calls Aave Pool `getUserAccountData()`
- Returns total collateral, total debt, health factor
- Auto-refreshes every 30 seconds

### 3d. User Reserve Data

**File:** `useAavePositions.ts:72`

```72:81:aave-avalanche-dashboard/frontend/src/hooks/useAavePositions.ts
  // Step 5: Also check USDC.e in case user has that supplied
  const { data: reserveDataE, isLoading: reserveLoadingE } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: [CONTRACTS.USDC_E as `0x${string}`, address!],
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 30_000,
    },
  });
```

- User reserve data fetch
- Calls Data Provider `getUserReserveData()`
- Fetches user-specific USDC.e position
- Returns aToken balance, stable debt, variable debt
- Used to calculate supplied amount

### 3e. UI Data Consumption

**File:** `SimpleDashboard.tsx:15`

```14:15:aave-avalanche-dashboard/frontend/src/components/SimpleDashboard.tsx
  const { avaxBalance, usdcBalance, isLoading: balanceLoading } = useWalletBalances();
  const positions = useAavePositions();
```

- SimpleDashboard component
- Consumes balance and position hooks
- Displays balances & positions in UI
- Shows supplied USDC amount and APY

---

## Dynamic Pool Resolution System

### 4a. Addresses Provider Contract

**File:** `contracts.ts:12`

```12:12:aave-avalanche-dashboard/frontend/src/config/contracts.ts
  AAVE_POOL_ADDRESSES_PROVIDER: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
```

- Contract configuration layer
- Addresses Provider contract address
- Used to dynamically resolve Pool address
- Aave V3 standard pattern

### 4b. Dynamic Pool Fetch

**File:** `ActionModal.tsx:112`

```112:116:aave-avalanche-dashboard/frontend/src/components/ActionModal.tsx
  // Get dynamic Pool address
  const { data: poolAddress } = useReadContract({
    address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
    abi: [{ name: 'getPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }] as const,
    functionName: 'getPool',
```

- Pool address fetching
- Reads from Addresses Provider contract
- Uses `useReadContract` hook
- Returns dynamic pool address

### 4c. getPool Call

**File:** `ActionModal.tsx:115`

```115:115:aave-avalanche-dashboard/frontend/src/components/ActionModal.tsx
    functionName: 'getPool',
```

- `getPool()` function call
- Returns current Aave Pool address
- Pool address can change with protocol upgrades
- Ensures always using correct pool

### 4d. Dynamic Pool Usage

**File:** `ActionModal.tsx:282`

```282:290:aave-avalanche-dashboard/frontend/src/components/ActionModal.tsx
              const supplyHash = await writeContract({
                address: poolAddress, // Use dynamic pool address
                abi: AAVE_POOL_ABI,
                functionName: 'supply',
                args: [CONTRACTS.USDC_E as `0x${string}`, supplyAmountWei, address, 0], // Use USDC.e
              });
```

- Transaction execution layer
- `writeContract()` for supply
- Uses dynamically resolved `poolAddress`
- Ensures transactions go to correct pool

### 4e. USDC.e Contract Address

**File:** `contracts.ts:9`

```9:9:aave-avalanche-dashboard/frontend/src/config/contracts.ts
  USDC_E: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664', // Bridged USDC.e
```

- Token contract reference
- USDC.e contract address on Avalanche
- Bridged version of USDC (USDC.e)
- Used for all USDC.e operations (balance, approval, supply)

---

## Transaction Flow Summary

### Complete Supply Flow

1. **User Input**: User enters USDC.e amount in ActionModal
2. **Validation**: Check wallet connection, amount validity, pool availability
3. **Allowance Check**: Verify if pool has sufficient allowance
4. **Approval** (if needed):
   - Call `approve()` on USDC.e contract
   - Approve pool address with max approval
   - Wait for transaction confirmation
   - Refetch allowance
5. **Supply**:
   - Call `supply()` on Aave Pool contract
   - Transfer USDC.e to pool
   - Receive aTokens
   - Wait for transaction confirmation
6. **UI Update**:
   - Refetch balances
   - Refetch positions
   - Show success message
   - Close modal

### Key Design Decisions

- **Max Approval**: Uses unlimited approval for better UX (one-time approval)
- **Dynamic Pool**: Always resolves pool address from AddressesProvider
- **USDC.e Focus**: Uses bridged USDC.e instead of native USDC
- **Transaction Confirmation**: Waits for receipt before proceeding
- **Error Handling**: Comprehensive error catching and user feedback
- **Explorer Links**: Provides Snowtrace links for all transactions

---

## Related Files

- `main.tsx` - App initialization
- `wagmi.ts` - Wagmi configuration
- `contracts.ts` - Contract addresses and ABIs
- `ActionModal.tsx` - Supply transaction handler
- `useWalletBalances.ts` - Balance fetching
- `useAavePositions.ts` - Position data fetching
- `SimpleDashboard.tsx` - UI component

---

## Version Information

- **Wagmi**: v2.19.5
- **Viem**: v2.40.3
- **React Query**: v5.90.11
- **React**: v18.3.1
- **Aave V3**: Avalanche Mainnet

