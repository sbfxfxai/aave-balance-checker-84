import { useAccount } from 'wagmi';
import { readContract } from '@wagmi/core';
import { formatUnits } from 'viem';
import { CONTRACTS, AAVE_POOL_ABI, AAVE_DATA_PROVIDER_ABI, AAVE_POOL_ADDRESSES_PROVIDER_ABI } from '@/config/contracts';
import { useState, useEffect, useCallback } from 'react';
import { config } from '@/config/wagmi';

type AccountDataTuple = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

type ReserveDataTuple = readonly [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  boolean,
];

export function useAavePositions() {
  const { address } = useAccount();

  const [accountData, setAccountData] = useState<AccountDataTuple | null>(null);
  const [usdcReserveData, setUsdcReserveData] = useState<ReserveDataTuple | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!address) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      
      // Step 1: Get the real Pool address from PoolAddressesProvider
      const { data: poolAddress } = await readContract(config, {
        address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
        abi: AAVE_POOL_ADDRESSES_PROVIDER_ABI,
        functionName: 'getPool',
      }) as { data: `0x${string}` };
      
      console.log('Fetched Pool Address:', poolAddress);
      
      // Step 2: Fetch account data using the dynamic Pool address
      const { data: accountDataResult } = await readContract(config, {
        address: poolAddress,
        abi: AAVE_POOL_ABI,
        functionName: 'getUserAccountData',
        args: [address],
      }) as { data: AccountDataTuple };
      setAccountData(accountDataResult);

      // Step 3: Fetch USDC reserve data
      const { data: reserveDataResult } = await readContract(config, {
        address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
        abi: AAVE_DATA_PROVIDER_ABI,
        functionName: 'getUserReserveData',
        args: [CONTRACTS.USDC_E as `0x${string}`, address],
      }) as { data: ReserveDataTuple };
      setUsdcReserveData(reserveDataResult);
    } catch (error) {
      console.error('Error fetching AAVE positions:', error);
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  // Set up polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [fetchData]);

  const formatData = () => {
    if (isLoading || !accountData || !usdcReserveData) {
      return {
        totalCollateral: '0',
        totalDebt: '0',
        availableBorrow: '0',
        healthFactor: '0',
        usdcSupplied: '0',
        usdcBorrowed: '0',
        isLoading,
      };
    }

    const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = accountData;
    const [currentATokenBalance, currentStableDebt, currentVariableDebt] = usdcReserveData;

    return {
      totalCollateral: formatUnits(totalCollateralBase, 8), // Base units are in 8 decimals
      totalDebt: formatUnits(totalDebtBase, 8),
      availableBorrow: formatUnits(availableBorrowsBase, 8),
      healthFactor: healthFactor > 0n ? (Number(healthFactor) / 1e18).toFixed(2) : '∞',
      usdcSupplied: formatUnits(currentATokenBalance, 6), // USDC has 6 decimals
      usdcBorrowed: formatUnits(currentStableDebt + currentVariableDebt, 6),
      isLoading: false,
    };
  };

  return formatData();
}
