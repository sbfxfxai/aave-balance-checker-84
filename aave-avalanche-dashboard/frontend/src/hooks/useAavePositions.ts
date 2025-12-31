import { useAccount, useReadContract } from 'wagmi';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useMemo } from 'react';
import { formatUnits } from 'viem';
import { CONTRACTS, AAVE_POOL_ADDRESSES_PROVIDER_ABI, AAVE_POOL_ABI, AAVE_DATA_PROVIDER_ABI } from '@/config/contracts';

export interface AavePosition {
  totalCollateral: string;
  totalDebt: string;
  totalLiquidity: string;
  healthFactor: number;
  availableBorrow: string;
  suppliedAssets: Array<{
    symbol: string;
    amount: string;
    usdValue: string;
    apy: number;
  }>;
  borrowedAssets: Array<{
    symbol: string;
    amount: string;
    usdValue: string;
    apy: number;
  }>;
}

export function useAavePositions() {
  const { address: wagmiAddress, isConnected: isWagmiConnected } = useAccount();
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();

  // Get the active wallet address
  const address = useMemo(() => {
    if (wagmiAddress) return wagmiAddress;
    const privyWallet = wallets.find(w => w.walletClientType === 'privy');
    return privyWallet?.address || null;
  }, [wagmiAddress, wallets]);

  const isConnected = isWagmiConnected || (authenticated && !!address);

  // Step 1: Dynamically resolve Pool address via Addresses Provider
  const {
    data: poolAddress,
    isLoading: poolAddressLoading,
    error: poolAddressError
  } = useReadContract({
    address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
    abi: AAVE_POOL_ADDRESSES_PROVIDER_ABI,
    functionName: 'getPool',
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Step 2: Get user positions
  const { data: rawData, isLoading: positionsLoading, error } = useReadContract({
    address: (poolAddress || CONTRACTS.AAVE_POOL) as `0x${string}`,
    abi: AAVE_POOL_ABI,
    functionName: 'getUserAccountData',
    args: address ? [address as `0x${string}`] : undefined,
    query: {
      enabled: isConnected && !!address && (!!poolAddress || !!CONTRACTS.AAVE_POOL),
      refetchInterval: 60_000,
    },
  });

  // Step 3: Get USDC reserve data
  const {
    data: usdcReserveData,
    isLoading: usdcReserveLoading,
  } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getReserveData',
    args: [CONTRACTS.USDC as `0x${string}`],
    query: { enabled: !!CONTRACTS.AAVE_POOL_DATA_PROVIDER },
  });

  // Step 4: Get WAVAX reserve data
  const {
    data: avaxReserveData,
    isLoading: avaxReserveLoading,
  } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getReserveData',
    args: [CONTRACTS.WAVAX as `0x${string}`],
    query: { enabled: !!CONTRACTS.AAVE_POOL_DATA_PROVIDER },
  });

  // Step 5: Get native USDC reserve data
  const {
    data: reserveData,
    isLoading: reserveLoading,
  } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: address ? [CONTRACTS.USDC as `0x${string}`, address as `0x${string}`] : undefined,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 60_000,
    },
  });

  // Step 7: Get WAVAX user reserve data for AVAX supply and borrows
  const hasWavaxArgs = !!(address && CONTRACTS.WAVAX);
  const {
    data: wavaxReserveData,
    isLoading: wavaxReserveLoading,
    refetch: refetchWavaxReserveData
  } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: hasWavaxArgs ? [CONTRACTS.WAVAX as `0x${string}`, address as `0x${string}`] : undefined,
    query: {
      enabled: isConnected && hasWavaxArgs,
      refetchInterval: 60_000,
    },
  });

  if (!isConnected || !address) {
    return {
      healthFactor: null,
      totalDebt: '0',
      totalCollateral: '0',
      usdcSupply: '0',
      usdcBorrowed: '0',
      avaxSupply: '0',
      avaxBorrowed: '0',
      availableBorrow: '$0.00',
      usdcSupplyApy: 0,
      avaxSupplyApy: 0,
      usdcBorrowApy: 0,
      avaxBorrowApy: 0,
      avaxAvailableToBorrow: 0,
      usdcAvailableToBorrow: 0,
      isLoading: false,
    };
  }

  if (poolAddressLoading || positionsLoading) {
    return {
      healthFactor: null,
      totalDebt: '0',
      totalCollateral: '0',
      usdcSupply: '0',
      usdcBorrowed: '0',
      avaxSupply: '0',
      avaxBorrowed: '0',
      availableBorrow: '$0.00',
      usdcSupplyApy: 0,
      avaxSupplyApy: 0,
      usdcBorrowApy: 0,
      avaxBorrowApy: 0,
      avaxAvailableToBorrow: 0,
      usdcAvailableToBorrow: 0,
      isLoading: true
    };
  }

  if (error || !rawData) {
    return {
      healthFactor: null,
      totalDebt: '0',
      totalCollateral: '0',
      usdcSupply: '0',
      usdcBorrowed: '0',
      avaxSupply: '0',
      avaxBorrowed: '0',
      availableBorrow: '$0.00',
      usdcSupplyApy: 0,
      avaxSupplyApy: 0,
      usdcBorrowApy: 0,
      avaxBorrowApy: 0,
      avaxAvailableToBorrow: 0,
      usdcAvailableToBorrow: 0,
      isLoading: false,
    };
  }

  // Parse rawData
  let totalCollateralBase: bigint = 0n;
  let totalDebtBase: bigint = 0n;
  let availableBorrowsBase: bigint = 0n;
  let healthFactor: bigint = 0n;

  if (Array.isArray(rawData) && rawData.length >= 6) {
    [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = rawData;
  }

  // Calculate USDC balances
  let usdcSupply = '0';
  let usdcBorrowed = '0';

  if (reserveData && Array.isArray(reserveData)) {
    const [currentATokenBalance, currentStableDebt, currentVariableDebt] = reserveData;
    usdcSupply = formatUnits(currentATokenBalance || 0n, 6);
    usdcBorrowed = formatUnits(((currentStableDebt || 0n) + (currentVariableDebt || 0n)), 6);
  }

  // Calculate AVAX balances
  let avaxSupply = '0';
  let avaxBorrowed = '0';

  if (wavaxReserveData && Array.isArray(wavaxReserveData)) {
    const [currentATokenBalance, currentStableDebt, currentVariableDebt] = wavaxReserveData;
    avaxSupply = formatUnits(currentATokenBalance || 0n, 18);
    avaxBorrowed = formatUnits(((currentStableDebt || 0n) + (currentVariableDebt || 0n)), 18);
  }

  // Extract APYs
  let usdcSupplyApy = 0;
  let avaxSupplyApy = 0;
  let usdcBorrowApy = 0;
  let avaxBorrowApy = 0;

  if (usdcReserveData && Array.isArray(usdcReserveData) && usdcReserveData.length >= 12) {
    const [, , , , , liquidityRate, variableBorrowRate] = usdcReserveData;
    usdcSupplyApy = (Number(liquidityRate || 0n) / 1e27) * 100;
    usdcBorrowApy = (Number(variableBorrowRate || 0n) / 1e27) * 100;
  }

  if (avaxReserveData && Array.isArray(avaxReserveData) && avaxReserveData.length >= 12) {
    const [, , , , , liquidityRate, variableBorrowRate] = avaxReserveData;
    avaxSupplyApy = (Number(liquidityRate || 0n) / 1e27) * 100;
    avaxBorrowApy = (Number(variableBorrowRate || 0n) / 1e27) * 100;
  }

  // Personal available to borrow
  let avaxAvailableToBorrow = 0;
  if (availableBorrowsBase) {
    const AVAX_PRICE_USD = 25; // Approximate
    const availableBorrowsUSD = Number(availableBorrowsBase) / 1e8;
    avaxAvailableToBorrow = availableBorrowsUSD / AVAX_PRICE_USD;
  }

  return {
    totalCollateral: totalCollateralBase ? `$${(Number(totalCollateralBase) / 1e8).toFixed(2)}` : '$0.00',
    totalDebt: totalDebtBase ? `$${(Number(totalDebtBase) / 1e8).toFixed(2)}` : '$0.00',
    availableBorrow: availableBorrowsBase ? `$${(Number(availableBorrowsBase) / 1e8).toFixed(2)}` : '$0.00',
    usdcSupply: usdcSupply || '0.00',
    usdcBorrowed: usdcBorrowed || '0.00',
    avaxSupply: avaxSupply || '0.00',
    avaxBorrowed: avaxBorrowed || '0.00',
    healthFactor: healthFactor && healthFactor > 0n ? Number(healthFactor) / 1e18 : null,
    usdcSupplyApy,
    avaxSupplyApy,
    usdcBorrowApy,
    avaxBorrowApy,
    avaxAvailableToBorrow,
    usdcAvailableToBorrow: 0,
    isLoading: poolAddressLoading || positionsLoading || reserveLoading || usdcReserveLoading || avaxReserveLoading || wavaxReserveLoading,
    refetch: refetchWavaxReserveData,
  };
}
