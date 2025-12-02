import { useQuery } from '@tanstack/react-query';
import { useAccount, useContractRead } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS, AAVE_POOL_ABI, AAVE_DATA_PROVIDER_ABI } from '@/config/contracts';

export function useAavePositions() {
  const { address } = useAccount();

  const { data: accountData } = useContractRead({
    address: CONTRACTS.AAVE_POOL as `0x${string}`,
    abi: AAVE_POOL_ABI,
    functionName: 'getUserAccountData',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10000, // Refresh every 10 seconds
    },
  });

  const { data: usdcReserveData } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: address ? [CONTRACTS.USDC_E as `0x${string}`, address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10000,
    },
  });

  const formatData = () => {
    if (!accountData || !usdcReserveData) {
      return {
        totalCollateral: '0',
        totalDebt: '0',
        availableBorrow: '0',
        healthFactor: '0',
        usdcSupplied: '0',
        usdcBorrowed: '0',
        isLoading: true,
      };
    }

    const [totalCollateralBase, totalDebtBase, availableBorrowsBase, , , healthFactor] = accountData as bigint[];
    const [currentATokenBalance, currentStableDebt, currentVariableDebt] = usdcReserveData as bigint[];

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
