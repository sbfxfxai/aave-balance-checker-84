import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS, AAVE_POOL_ABI, AAVE_DATA_PROVIDER_ABI, AAVE_POOL_ADDRESSES_PROVIDER_ABI } from '@/config/contracts';

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
  const { address, isConnected } = useAccount();

  // Step 1: Get current Pool address from Provider
  const { data: poolAddress } = useReadContract({
    address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
    abi: AAVE_POOL_ADDRESSES_PROVIDER_ABI,
    functionName: 'getPool',
    query: { enabled: true },
  });

  // Step 2: Get user positions from dynamic Pool address
  const { data: rawData, isLoading: positionsLoading, error } = useReadContract({
    address: poolAddress,
    abi: AAVE_POOL_ABI,
    functionName: 'getUserAccountData',
    args: address ? [address] : undefined,
    query: {
      enabled: !!poolAddress && isConnected && !!address,
      refetchInterval: 30_000,
    },
  });

  // Step 3: Get USDC reserve data
  const { data: reserveData, isLoading: reserveLoading } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: [CONTRACTS.USDC_E as `0x${string}`, address!],
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 30_000,
    },
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

  // Calculate USDC supply from reserve data
  let usdcSupply = '0';
  let usdcBorrowed = '0';
  if (reserveData) {
    const [currentATokenBalance, currentStableDebt, currentVariableDebt] = reserveData;
    usdcSupply = formatUnits(currentATokenBalance || 0n, 6);
    usdcBorrowed = formatUnits((currentStableDebt + currentVariableDebt) || 0n, 6);
  }

  return {
    totalCollateral: totalCollateralBase ? `$${(Number(totalCollateralBase) / 1e8).toFixed(2)}` : '$0.00',
    totalDebt: totalDebtBase ? `$${(Number(totalDebtBase) / 1e8).toFixed(2)}` : '$0.00',
    availableBorrow: availableBorrowsBase ? `$${(Number(availableBorrowsBase) / 1e8).toFixed(2)}` : '$0.00',
    usdcSupply: usdcSupply || '0.00',
    usdcBorrowed: usdcBorrowed || '0.00',
    healthFactor: healthFactor && healthFactor > 0n ? Number(healthFactor) / 1e18 : null,
    isLoading: positionsLoading || reserveLoading,
  };
}
