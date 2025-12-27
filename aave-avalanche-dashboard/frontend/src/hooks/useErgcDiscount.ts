import { useBalance } from 'wagmi';
import { avalanche } from 'wagmi/chains';
import { CONTRACTS, ERGC_DISCOUNT } from '@/config/contracts';
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
  const { data: ergcBalance, isLoading } = useBalance({
    address,
    token: CONTRACTS.ERGC as `0x${string}`,
    chainId: avalanche.id,
  });

  const discountInfo = useMemo(() => {
    const balanceRaw = ergcBalance?.value ? BigInt(ergcBalance.value) : 0n;
    const balanceFormatted = ergcBalance?.formatted || '0';
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
  }, [ergcBalance, isLoading]);

  return discountInfo;
}
