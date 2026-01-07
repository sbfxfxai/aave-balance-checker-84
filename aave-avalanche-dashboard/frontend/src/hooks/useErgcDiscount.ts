import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { CONTRACTS, ERGC_DISCOUNT, ERC20_ABI } from '@/config/contracts';
import { useMemo } from 'react';

export interface ErgcDiscountInfo {
  ergcBalance: string;
  ergcBalanceRaw: bigint;
  hasDiscount: boolean;
  standardFee: number;
  discountedFee: number;
  savingsPerTrade: number;
  savingsPercent: number;
  tokensNeeded: number;
  isLoading: boolean;
}

export function useErgcDiscount(address: `0x${string}` | undefined): ErgcDiscountInfo {
  const { data: ergcBalanceRaw, isLoading } = useReadContract({
    address: CONTRACTS?.ERGC as `0x${string}` | undefined,
    abi: ERC20_ABI || [],
    functionName: 'balanceOf',
    args: address && CONTRACTS?.ERGC ? [address] : undefined,
    query: {
      enabled: !!address && !!CONTRACTS?.ERGC && !!ERC20_ABI,
      refetchInterval: 15_000,
    },
  });

  const discountInfo = useMemo(() => {
    // Safely convert to BigInt
    const balanceRaw = (() => {
      try {
        if (!ergcBalanceRaw) return 0n;
        if (typeof ergcBalanceRaw === 'bigint') return ergcBalanceRaw;
        const value = ergcBalanceRaw as unknown;
        if (typeof value === 'string' || typeof value === 'number') {
          return BigInt(value.toString());
        }
        return 0n;
      } catch {
        return 0n;
      }
    })();
    
    // ERGC has 18 decimals
    const balanceFormatted = balanceRaw > 0n ? formatUnits(balanceRaw, 18) : '0';
    const hasDiscount = balanceRaw >= ERGC_DISCOUNT.THRESHOLD;
    
    const savingsPerTrade = ERGC_DISCOUNT.STANDARD_FEE - ERGC_DISCOUNT.DISCOUNTED_FEE;
    const savingsPercent = Math.round((savingsPerTrade / ERGC_DISCOUNT.STANDARD_FEE) * 100);
    
    // Calculate tokens needed to reach threshold
    const tokensNeeded = hasDiscount ? 0 : Math.max(0, 100 - parseFloat(balanceFormatted));

    return {
      ergcBalance: balanceFormatted,
      ergcBalanceRaw: balanceRaw,
      hasDiscount,
      standardFee: ERGC_DISCOUNT.STANDARD_FEE,
      discountedFee: ERGC_DISCOUNT.DISCOUNTED_FEE,
      savingsPerTrade,
      savingsPercent,
      tokensNeeded,
      isLoading,
    };
  }, [ergcBalanceRaw, isLoading]);

  return discountInfo;
}
