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
  const { data: poolAddress, isLoading: poolAddressLoading } = useReadContract({
    address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
    abi: AAVE_POOL_ADDRESSES_PROVIDER_ABI,
    functionName: 'getPool',
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Step 2: Get user positions from dynamically resolved Pool address
  const { data: rawData, isLoading: positionsLoading, error } = useReadContract({
    address: (poolAddress || CONTRACTS.AAVE_POOL) as `0x${string}`, // Fallback to static address if dynamic resolution fails
    abi: AAVE_POOL_ABI,
    functionName: 'getUserAccountData',
    args: address ? [address] : undefined,
    query: {
      enabled: isConnected && !!address && (!!poolAddress || !!CONTRACTS.AAVE_POOL), // Use fallback if poolAddress not yet resolved
      refetchInterval: 30_000,
    },
  });

  // Step 3: Get USDC reserve data for APYs using Data Provider
  const { data: usdcReserveData, isLoading: usdcReserveLoading } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getReserveData',
    args: [CONTRACTS.USDC as `0x${string}`],
    query: { enabled: !!CONTRACTS.AAVE_POOL_DATA_PROVIDER },
  });

  // Step 4: Get WAVAX reserve data for APYs using Data Provider
  const { data: avaxReserveData, isLoading: avaxReserveLoading } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getReserveData',
    args: [CONTRACTS.WAVAX as `0x${string}`],
    query: { enabled: !!CONTRACTS.AAVE_POOL_DATA_PROVIDER },
  });

  // Step 5: Get native USDC reserve data using Data Provider
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

  // Step 6: Also check USDC.e in case user has that supplied
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
      refetchInterval: 30_000,
    },
  });
  
  // Debug: Log query state
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

  if (!isConnected || !address) {
    return {
      healthFactor: null,
      totalDebt: '0',
      totalCollateral: '0',
      usdcSupply: '0',
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
      isLoading: true 
    };
  }

  if (error || !rawData) {
    return {
      healthFactor: null,
      totalDebt: '0',
      totalCollateral: '0',
      usdcSupply: '0',
      isLoading: false,
    };
  }

  const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = rawData;

  // Calculate USDC supply from both native USDC and USDC.e
  let usdcSupply = '0';
  let usdcBorrowed = '0';
  
  // Check native USDC first
  if (reserveData) {
    const [currentATokenBalance, currentStableDebt, currentVariableDebt] = reserveData;
    usdcSupply = formatUnits(currentATokenBalance || 0n, 6);
    usdcBorrowed = formatUnits((currentStableDebt + currentVariableDebt) || 0n, 6);
  }
  
  // If no native USDC, check USDC.e
  if ((!usdcSupply || usdcSupply === '0') && reserveDataE) {
    const [currentATokenBalanceE, currentStableDebtE, currentVariableDebtE] = reserveDataE;
    usdcSupply = formatUnits(currentATokenBalanceE || 0n, 6);
    usdcBorrowed = formatUnits((currentStableDebtE + currentVariableDebtE) || 0n, 6);
  }

  // Calculate AVAX/WAVAX supply and borrows
  let avaxSupply = '0';
  let avaxBorrowed = '0';
  
  // Debug: Log the raw data structure and errors
  if (wavaxReserveError) {
    console.error('[useAavePositions] WAVAX reserve data ERROR:', wavaxReserveError);
  }
  
  if (wavaxReserveData !== undefined) {
    // Log each element of the array with its index and value
    const arrayData = Array.isArray(wavaxReserveData) ? wavaxReserveData : [];
    const arrayDetails = arrayData.map((item, index) => ({
      index,
      value: item,
      type: typeof item,
      isBigInt: typeof item === 'bigint',
      stringValue: typeof item === 'bigint' ? item.toString() : String(item),
      formatted: typeof item === 'bigint' ? formatUnits(item, 18) : String(item),
    }));
    
    console.log('[useAavePositions] WAVAX reserve data received:', {
      type: typeof wavaxReserveData,
      isArray: Array.isArray(wavaxReserveData),
      length: arrayData.length,
      elements: arrayDetails,
      raw: wavaxReserveData,
    });
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
          currentATokenBalance = (wavaxReserveData[0] as bigint) || 0n;
          currentStableDebt = (wavaxReserveData[1] as bigint) || 0n;
          currentVariableDebt = (wavaxReserveData[2] as bigint) || 0n;
        } else {
          console.warn('[useAavePositions] WAVAX reserve data array too short:', wavaxReserveData.length);
        }
      } else if (typeof wavaxReserveData === 'object' && wavaxReserveData !== null) {
        // Check if it's an object with named properties (unlikely but possible)
        const obj = wavaxReserveData as any;
        currentATokenBalance = BigInt(obj.currentATokenBalance || obj[0] || 0);
        currentStableDebt = BigInt(obj.currentStableDebt || obj[1] || 0);
        currentVariableDebt = BigInt(obj.currentVariableDebt || obj[2] || 0);
        console.log('[useAavePositions] Parsed WAVAX data from object format');
      } else {
        console.warn('[useAavePositions] Unexpected WAVAX reserve data format:', typeof wavaxReserveData, wavaxReserveData);
      }
      
      avaxSupply = formatUnits(currentATokenBalance, 18); // WAVAX has 18 decimals
      const totalDebt = currentStableDebt + currentVariableDebt;
      avaxBorrowed = formatUnits(totalDebt, 18);
      
      // Debug logging - always log to help debug
      console.log('[useAavePositions] AVAX position calculated:', {
        aTokenBalance: formatUnits(currentATokenBalance, 18),
        stableDebt: formatUnits(currentStableDebt, 18),
        variableDebt: formatUnits(currentVariableDebt, 18),
        totalDebt: avaxBorrowed,
        totalDebtWei: totalDebt.toString(),
      });
      
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

  // WAVAX APYs and available liquidity
  if (avaxReserveData && Array.isArray(avaxReserveData) && avaxReserveData.length >= 12) {
    const [, , totalAToken, totalStableDebt, totalVariableDebt, liquidityRate, variableBorrowRate] = avaxReserveData;
    
    avaxSupplyApy = (Number(liquidityRate || 0n) / 1e27) * 100;
    avaxBorrowApy = (Number(variableBorrowRate || 0n) / 1e27) * 100;
    
    // Calculate available AVAX (total aToken supply - total debt)
    const totalATokenAmount = Number(totalAToken || 0n) / 1e18;
    const totalStableDebtAmount = Number(totalStableDebt || 0n) / 1e18;
    const totalVariableDebtAmount = Number(totalVariableDebt || 0n) / 1e18;
    avaxAvailableToBorrow = totalATokenAmount - (totalStableDebtAmount + totalVariableDebtAmount);
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
    netApy: 0, // Removed net APY as requested
    usdcSupplyApy: usdcSupplyApy,
    avaxSupplyApy: avaxSupplyApy,
    usdcBorrowApy: usdcBorrowApy,
    avaxBorrowApy: avaxBorrowApy,
    avaxAvailableToBorrow: avaxAvailableToBorrow,
    usdcAvailableToBorrow: usdcAvailableToBorrow,
    isLoading: poolAddressLoading || positionsLoading || reserveLoading || reserveLoadingE || usdcReserveLoading || avaxReserveLoading || wavaxReserveLoading,
    refetch: refetchWavaxReserveData, // Expose refetch function for manual refresh
  };
}
