import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS, AAVE_POOL_ADDRESSES_PROVIDER_ABI, AAVE_POOL_ABI, AAVE_DATA_PROVIDER_ABI } from '@/config/contracts';
import { bigDecimal, BigDecimal } from '@/utils/bigDecimal';

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
  const { address, isConnected } = useAccount();

  // Step 1: Dynamically resolve Pool address via Addresses Provider (matches DepositModal pattern)
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

  // Debug: Log pool address resolution (only on changes or errors)
  if (poolAddressError || poolAddressLoading) {
    console.log('[useAavePositions] Pool address resolution:', {
      providerAddress: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER,
      resolvedPoolAddress: poolAddress,
      fallbackPoolAddress: CONTRACTS.AAVE_POOL,
      isLoading: poolAddressLoading,
      address,
      isConnected
    });
  }

  if (poolAddressError) {
    console.error('[useAavePositions] Pool address resolution error:', {
      error: poolAddressError,
      addressesProvider: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER,
      address,
      isConnected,
    });
  }

  // Step 2: Get user positions from dynamically resolved Pool address
  const { data: rawData, isLoading: positionsLoading, error } = useReadContract({
    address: (poolAddress || CONTRACTS.AAVE_POOL) as `0x${string}`, // Fallback to static address if dynamic resolution fails
    abi: AAVE_POOL_ABI,
    functionName: 'getUserAccountData',
    args: address ? [address] : undefined,
    query: {
      enabled: isConnected && !!address && (!!poolAddress || !!CONTRACTS.AAVE_POOL), // Use fallback if poolAddress not yet resolved
      refetchInterval: 60_000, // Reduced from 30s to 60s to decrease spam
    },
  });

  // Step 3: Get USDC reserve data for APYs using Data Provider
  const { 
    data: usdcReserveData, 
    isLoading: usdcReserveLoading,
    error: usdcReserveDataError 
  } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getReserveData',
    args: [CONTRACTS.USDC as `0x${string}`],
    query: { enabled: !!CONTRACTS.AAVE_POOL_DATA_PROVIDER },
  });
  
  if (usdcReserveDataError) {
    console.error('[useAavePositions] USDC getReserveData error:', usdcReserveDataError);
  }

  // Step 4: Get WAVAX reserve data for APYs using Data Provider
  const { 
    data: avaxReserveData, 
    isLoading: avaxReserveLoading,
    error: avaxReserveDataError 
  } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getReserveData',
    args: [CONTRACTS.WAVAX as `0x${string}`],
    query: { enabled: !!CONTRACTS.AAVE_POOL_DATA_PROVIDER },
  });
  
  if (avaxReserveDataError) {
    console.error('[useAavePositions] WAVAX getReserveData error:', avaxReserveDataError);
  }

  // Step 5: Get native USDC reserve data using Data Provider
  const { 
    data: reserveData, 
    isLoading: reserveLoading,
    error: reserveDataError 
  } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: [CONTRACTS.USDC as `0x${string}`, address!],
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 60_000, // Reduced from 30s to 60s
    },
  });
  
  // Log USDC reserve data errors
  if (reserveDataError) {
    console.error('[useAavePositions] USDC getUserReserveData error:', {
      error: reserveDataError,
      dataProvider: CONTRACTS.AAVE_POOL_DATA_PROVIDER,
      usdcAddress: CONTRACTS.USDC,
      address,
    });
  }

  // Note: Aave V3 on Avalanche uses native USDC (0xB97E...), NOT USDC.e
  // USDC.e (bridged USDC) is not supported on Aave V3 Avalanche
  // Removed USDC.e query to avoid errors

  // Step 7: Get WAVAX user reserve data for AVAX supply and borrows
  const { 
    data: wavaxReserveData, 
    isLoading: wavaxReserveLoading, 
    error: wavaxReserveError,
    refetch: refetchWavaxReserveData 
  } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: [CONTRACTS.WAVAX as `0x${string}`, address!],
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 60_000, // Reduced from 30s to 60s
    },
  });
  
  // Debug: Log WAVAX query state (only on errors or loading changes)
  if (wavaxReserveError || wavaxReserveLoading) {
    console.log('[useAavePositions] WAVAX query state:', {
      isConnected,
      address,
      enabled: isConnected && !!address,
      isLoading: wavaxReserveLoading,
      hasData: wavaxReserveData !== undefined,
      hasError: !!wavaxReserveError,
      error: wavaxReserveError,
      dataProviderAddress: CONTRACTS.AAVE_POOL_DATA_PROVIDER,
      wavaxAddress: CONTRACTS.WAVAX,
    });
  }

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
    // Log detailed error information for debugging
    console.error('[useAavePositions] getUserAccountData failed:', {
      error,
      rawData,
      poolAddress,
      fallbackPool: CONTRACTS.AAVE_POOL,
      address,
      isConnected,
      enabled: isConnected && !!address && (!!poolAddress || !!CONTRACTS.AAVE_POOL),
      poolAddressLoading,
      positionsLoading,
    });
    
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

  const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = rawData;

  // Calculate USDC supply from native USDC (Aave V3 uses native USDC only)
  let usdcSupply = '0';
  let usdcBorrowed = '0';
  
  // Aave V3 Avalanche uses native USDC (0xB97E...), not USDC.e
  if (reserveData) {
    const [currentATokenBalance, currentStableDebt, currentVariableDebt] = reserveData;
    usdcSupply = formatUnits(currentATokenBalance || 0n, 6);
    usdcBorrowed = formatUnits((currentStableDebt + currentVariableDebt) || 0n, 6);
  }

  // Calculate AVAX/WAVAX supply and borrows
  let avaxSupply = '0';
  let avaxBorrowed = '0';
  
  // Debug: Log the raw data structure and errors
  if (wavaxReserveError) {
    console.error('[useAavePositions] WAVAX reserve data ERROR:', wavaxReserveError);
  }
  
  if (wavaxReserveData !== undefined) {
    // Extract WAVAX data without excessive logging
    const arrayData = Array.isArray(wavaxReserveData) ? wavaxReserveData : [];
    
    if (arrayData.length >= 3) {
      const aTokenBalance = arrayData[0];
      const stableDebt = arrayData[1];
      const variableDebt = arrayData[2];
    }
  } else if (!wavaxReserveLoading) {
    console.warn('[useAavePositions] WAVAX reserve data is undefined and not loading!');
  }
  
  if (wavaxReserveData) {
    try {
      // Wagmi returns getUserReserveData as a tuple/array
      // Structure: [currentATokenBalance, currentStableDebt, currentVariableDebt, ...]
      let currentATokenBalance: bigint = 0n;
      let currentStableDebt: bigint = 0n;
      let currentVariableDebt: bigint = 0n;
      
      if (Array.isArray(wavaxReserveData)) {
        // Standard array format
        if (wavaxReserveData.length >= 3) {
          const val0 = wavaxReserveData[0];
          const val1 = wavaxReserveData[1];
          const val2 = wavaxReserveData[2];
          
          // Convert to bigint if needed
          currentATokenBalance = typeof val0 === 'bigint' ? val0 : BigInt(val0 || 0);
          currentStableDebt = typeof val1 === 'bigint' ? val1 : BigInt(val1 || 0);
          currentVariableDebt = typeof val2 === 'bigint' ? val2 : BigInt(val2 || 0);
        } else {
          console.warn('[useAavePositions] WAVAX reserve data array too short:', wavaxReserveData.length);
        }
      } else if (typeof wavaxReserveData === 'object' && wavaxReserveData !== null && !Array.isArray(wavaxReserveData)) {
        // Check if it's an object with named properties (unlikely but possible)
        // Use unknown intermediate type to satisfy TypeScript
        const obj = wavaxReserveData as unknown as Record<string, unknown>;
        currentATokenBalance = BigInt(Number(obj.currentATokenBalance || obj[0] || 0));
        currentStableDebt = BigInt(Number(obj.currentStableDebt || obj[1] || 0));
        currentVariableDebt = BigInt(Number(obj.currentVariableDebt || obj[2] || 0));
        console.log('[useAavePositions] Parsed WAVAX data from object format');
      } else {
        console.warn('[useAavePositions] Unexpected WAVAX reserve data format:', typeof wavaxReserveData, wavaxReserveData);
      }
      
      avaxSupply = formatUnits(currentATokenBalance, 18); // WAVAX has 18 decimals
      const totalDebt = currentStableDebt + currentVariableDebt;
      avaxBorrowed = formatUnits(totalDebt, 18);
      
    } catch (error) {
      console.error('[useAavePositions] Error parsing WAVAX reserve data:', error, wavaxReserveData);
    }
  } else if (!wavaxReserveLoading) {
    // Only log if we're not loading - if loading, it's expected to be undefined
    console.log('[useAavePositions] WAVAX reserve data is undefined (not loading)');
  }

  // Extract APYs from reserve data
  let usdcSupplyApy = 0;
  let avaxSupplyApy = 0;
  let usdcBorrowApy = 0;
  let avaxBorrowApy = 0;
  let avaxAvailableToBorrow = 0;
  const usdcAvailableToBorrow = 0;

  // USDC APYs
  if (usdcReserveData && Array.isArray(usdcReserveData) && usdcReserveData.length >= 12) {
    const [, , , , , liquidityRate, variableBorrowRate] = usdcReserveData;
    usdcSupplyApy = (Number(liquidityRate || 0n) / 1e27) * 100;
    usdcBorrowApy = (Number(variableBorrowRate || 0n) / 1e27) * 100;
  }

  // WAVAX APYs
  if (avaxReserveData && Array.isArray(avaxReserveData) && avaxReserveData.length >= 12) {
    const [, , , , , liquidityRate, variableBorrowRate] = avaxReserveData;
    avaxSupplyApy = (Number(liquidityRate || 0n) / 1e27) * 100;
    avaxBorrowApy = (Number(variableBorrowRate || 0n) / 1e27) * 100;
  }

  // Personal available to borrow: use availableBorrowsBase from getUserAccountData
  // This is your actual borrowing capacity, not total pool liquidity
  if (availableBorrowsBase) {
    // availableBorrowsBase is in base currency (USD) with 8 decimals
    // To get AVAX amount, we need the current AVAX price.
    // For now, approximate using $15/AVAX; in production you should fetch the price from an oracle.
    const AVAX_PRICE_USD = 15; // Approximate; replace with oracle price in production
    const availableBorrowsUSD = Number(availableBorrowsBase) / 1e8;
    avaxAvailableToBorrow = availableBorrowsUSD / AVAX_PRICE_USD;
  }

  const result = {
    totalCollateral: totalCollateralBase ? `$${(Number(totalCollateralBase) / 1e8).toFixed(2)}` : '$0.00',
    totalDebt: totalDebtBase ? `$${(Number(totalDebtBase) / 1e8).toFixed(2)}` : '$0.00',
    availableBorrow: availableBorrowsBase ? `$${(Number(availableBorrowsBase) / 1e8).toFixed(2)}` : '$0.00',
    usdcSupply: usdcSupply || '0.00',
    usdcBorrowed: usdcBorrowed || '0.00',
    avaxSupply: avaxSupply || '0.00',
    avaxBorrowed: avaxBorrowed || '0.00',
    healthFactor: healthFactor && healthFactor > 0n ? Number(healthFactor) / 1e18 : null,
    netApy: 0, // Removed net APY as requested
    usdcSupplyApy: usdcSupplyApy,
    avaxSupplyApy: avaxSupplyApy,
    usdcBorrowApy: usdcBorrowApy,
    avaxBorrowApy: avaxBorrowApy,
    avaxAvailableToBorrow: avaxAvailableToBorrow,
    usdcAvailableToBorrow: usdcAvailableToBorrow,
    isLoading: poolAddressLoading || positionsLoading || reserveLoading || usdcReserveLoading || avaxReserveLoading || wavaxReserveLoading,
    refetch: refetchWavaxReserveData, // Expose refetch function for manual refresh
  };
  
  return result;
}
