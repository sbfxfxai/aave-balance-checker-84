import { useAccount, useBalance } from 'wagmi';
// @ts-expect-error - @privy-io/react-auth types exist but TypeScript can't resolve them due to package.json exports configuration
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useMemo } from 'react';
import { avalanche } from 'wagmi/chains';
import { CONTRACTS } from '@/config/contracts';

export const useWalletBalances = () => {
  const { address: wagmiAddress, isConnected: isWagmiConnected } = useAccount();
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();

  // Get the active wallet address
  const address = useMemo(() => {
    if (wagmiAddress) return wagmiAddress;
    const privyWallet = wallets.find((w: any) => w.walletClientType === 'privy');
    return privyWallet?.address || null;
  }, [wagmiAddress, wallets]);

  const isConnected = isWagmiConnected || (authenticated && !!address);

  // AVAX balance
  const { data: avaxBalance, isLoading: isLoadingAvax, refetch: refetchAvax } = useBalance({
    address: address as `0x${string}`,
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 15_000,
    },
  });

  // Native USDC balance for Aave V3
  const { data: usdcBalance, isLoading: isLoadingUsdc, refetch: refetchUsdc } = useBalance({
    address: address as `0x${string}`,
    token: CONTRACTS.USDC as `0x${string}`,
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 15_000,
    },
  });

  // Also check USDC.e balance
  const { data: usdcEBalance } = useBalance({
    address: address as `0x${string}`,
    token: CONTRACTS.USDC_E as `0x${string}`,
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 15_000,
    },
  });

  // ERGC (EnergyCoin) balance
  const { data: ergcBalance } = useBalance({
    address: address as `0x${string}`,
    token: CONTRACTS.ERGC as `0x${string}`,
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address && !!CONTRACTS.ERGC,
      refetchInterval: 15_000,
    },
  });

  const avaxValue = avaxBalance?.value ? BigInt(avaxBalance.value) : 0n;
  const usdcValue = usdcBalance?.value ? BigInt(usdcBalance.value) : 0n;

  if (!isConnected || !address) {
    return {
      avaxBalance: '0',
      usdcBalance: '0',
      usdcEBalance: '0',
      ergcBalance: '0',
      isLoading: false,
      avaxValue: 0n,
      usdcValue: 0n,
      avaxSymbol: 'AVAX',
      usdcSymbol: 'USDC',
      needsMigration: false,
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
    usdcEBalance: usdcEBalance?.formatted || '0',
    ergcBalance: ergcBalance?.formatted || '0',
    isLoading: isLoadingAvax || isLoadingUsdc,
    avaxSymbol: avaxBalance?.symbol || 'AVAX',
    usdcSymbol: usdcBalance?.symbol || 'USDC',
    avaxValue,
    usdcValue,
    needsMigration,
    refetchBalances: async () => {
      await Promise.all([refetchAvax(), refetchUsdc()]);
    },
  };
};
