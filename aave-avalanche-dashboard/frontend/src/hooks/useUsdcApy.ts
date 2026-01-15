import { useReadContract } from 'wagmi';
import { CONTRACTS, AAVE_DATA_PROVIDER_ABI } from '@/config/contracts';

/**
 * Hook to fetch current USDC supply APY from Aave
 * Works without wallet connection - just reads public market data
 */
export function useUsdcApy() {
  // Fetch USDC reserve data from Aave Data Provider
  const { data: usdcReserveData, isLoading } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getReserveData',
    args: [CONTRACTS.USDC as `0x${string}`],
  });

  let usdcSupplyApy = 0;

  // Extract APY from reserve data
  // liquidityRate is at index 5 in the returned array
  if (usdcReserveData && Array.isArray(usdcReserveData) && usdcReserveData.length >= 12) {
    const [, , , , , liquidityRate] = usdcReserveData;
    usdcSupplyApy = (Number(liquidityRate || 0n) / 1e27) * 100;
  }

  return {
    apy: usdcSupplyApy,
    isLoading,
    // Format as display string with fallback
    displayApy: usdcSupplyApy > 0 ? usdcSupplyApy.toFixed(2) : 'Loading...',
  };
}
