import { useAccount, useBalance } from 'wagmi';
import { avalanche } from 'wagmi/chains';
import { CONTRACTS } from '@/config/contracts';

export const useWalletBalances = () => {
  const { address, isConnected } = useAccount();
  
  // AVAX balance
  const { data: avaxBalance, isLoading: isLoadingAvax, refetch: refetchAvax } = useBalance({
    address,
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 15_000, // Refetch every 15 seconds
    },
  });

  // Native USDC balance for Aave V3
  const { data: usdcBalance, isLoading: isLoadingUsdc, refetch: refetchUsdc } = useBalance({
    address,
    token: CONTRACTS.USDC as `0x${string}`, // Native USDC (0xB97E...) for Aave V3
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 15_000, // Refetch every 15 seconds
    },
  });

  // Also check USDC.e balance (for informational purposes)
  const { data: usdcEBalance } = useBalance({
    address,
    token: CONTRACTS.USDC_E as `0x${string}`, // USDC.e (bridged) - not used for Aave V3
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 15_000,
    },
  });

  const avaxValue = avaxBalance?.value ? BigInt(avaxBalance.value) : 0n;
  const usdcValue = usdcBalance?.value ? BigInt(usdcBalance.value) : 0n;

  if (!isConnected || !address) {
    return {
      avaxBalance: '0',
      usdcBalance: '0',
      isLoading: false,
      avaxValue: 0n,
      usdcValue: 0n,
      avaxSymbol: 'AVAX',
      usdcSymbol: 'USDC',
      refetchBalances: async () => {
        await Promise.all([refetchAvax(), refetchUsdc()]);
      },
    };
  }

  // Check if user has USDC.e but not native USDC (migration needed)
  const hasUsdcE = usdcEBalance && BigInt(usdcEBalance.value) > 0n;
  const hasNativeUsdc = usdcBalance && BigInt(usdcBalance.value) > 0n;
  const needsMigration = hasUsdcE && !hasNativeUsdc;

  return {
    avaxBalance: avaxBalance?.formatted || '0',
    usdcBalance: usdcBalance?.formatted || '0',
    usdcEBalance: usdcEBalance?.formatted || '0', // USDC.e balance (for info)
    isLoading: isLoadingAvax || isLoadingUsdc,
    avaxSymbol: avaxBalance?.symbol || 'AVAX',
    usdcSymbol: usdcBalance?.symbol || 'USDC',
    avaxValue,
    usdcValue,
    needsMigration, // Flag if user has USDC.e but needs to swap to native USDC
    refetchBalances: async () => {
      await Promise.all([refetchAvax(), refetchUsdc()]);
    },
  };
};
