import { useAccount, useBalance, useReadContract } from 'wagmi';
// @ts-ignore - @privy-io/react-auth types exist but TypeScript can't resolve them due to package.json exports configuration
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useMemo, useEffect } from 'react';
import { avalanche } from 'wagmi/chains';
import { formatUnits } from 'viem';
import { CONTRACTS, ERC20_ABI } from '@/config/contracts';

export const useWalletBalances = () => {
  const { address: wagmiAddress, isConnected: isWagmiConnected } = useAccount();
  const { authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();

  // Helper to check if address is Ethereum format
  const isEthereumAddress = (addr: string | undefined | null): boolean => {
    return !!addr && addr.startsWith('0x') && addr.length === 42;
  };

  // Get the active wallet address - prioritize Privy for authenticated users
  const address = useMemo(() => {
    // Fast path: wagmi address (always Ethereum)
    if (wagmiAddress && isEthereumAddress(wagmiAddress)) {
      return wagmiAddress;
    }

    // Privy wallet lookup (only if authenticated and ready)
    if (authenticated && ready) {
      // Check user wallet first (fastest)
      const userWalletAddr = user?.wallet?.address;
      if (userWalletAddr && isEthereumAddress(userWalletAddr)) {
        return userWalletAddr;
      }

      // Find Privy wallet
      if (wallets && wallets.length > 0) {
        // Try Privy wallet first
        const privyWallet = wallets.find((w: any) =>
          w.walletClientType === 'privy' && isEthereumAddress(w.address)
        );
        if (privyWallet) return privyWallet.address;

        // Fallback to any Ethereum wallet
        const ethereumWallet = wallets.find((w: any) => isEthereumAddress(w.address));
        if (ethereumWallet) return ethereumWallet.address;
      }
    }

    return wagmiAddress || null;
  }, [wagmiAddress, authenticated, ready, wallets, user]);

  // Check if user has any wallet connected (Privy or wagmi)
  const isConnected = isWagmiConnected || (authenticated && ready && !!address);

  // Debug logging
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' || window.location.hostname === 'www.tiltvault.com') {
      console.log('[useWalletBalances] State:', {
        wagmiAddress,
        isWagmiConnected,
        authenticated,
        ready,
        address,
        isConnected,
        walletsCount: wallets?.length || 0,
        userWalletAddress: user?.wallet?.address,
      });
    }
  }, [wagmiAddress, isWagmiConnected, authenticated, ready, address, isConnected, wallets, user]);

  // AVAX balance
  const { data: avaxBalance, isLoading: isLoadingAvax, refetch: refetchAvax } = useBalance({
    address: address as `0x${string}` | undefined,
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address && address.startsWith('0x'),
      refetchInterval: 15_000,
    },
  });

  // Native USDC balance using readContract (same method as Aave positions)
  const { data: usdcBalanceRaw, isLoading: isLoadingUsdc, refetch: refetchUsdc } = useReadContract({
    address: CONTRACTS?.USDC as `0x${string}` | undefined,
    abi: ERC20_ABI || [],
    functionName: 'balanceOf',
    args: address && CONTRACTS?.USDC ? [address as `0x${string}`] : undefined,
    query: {
      enabled: isConnected && !!address && address.startsWith('0x') && !!CONTRACTS?.USDC && !!ERC20_ABI,
      refetchInterval: 15_000,
    },
  });

  // USDC.e balance using readContract (same method as Aave positions)
  const { data: usdcEBalanceRaw, isLoading: isLoadingUsdcE, refetch: refetchUsdcE } = useReadContract({
    address: CONTRACTS?.USDC_E as `0x${string}` | undefined,
    abi: ERC20_ABI || [],
    functionName: 'balanceOf',
    args: address && CONTRACTS?.USDC_E ? [address as `0x${string}`] : undefined,
    query: {
      enabled: isConnected && !!address && address.startsWith('0x') && !!CONTRACTS?.USDC_E && !!ERC20_ABI,
      refetchInterval: 15_000,
    },
  });

  // ERGC (EnergyCoin) balance using readContract (same method as Aave positions)
  const { data: ergcBalanceRaw, isLoading: isLoadingErgc, refetch: refetchErgc } = useReadContract({
    address: CONTRACTS?.ERGC as `0x${string}` | undefined,
    abi: ERC20_ABI || [],
    functionName: 'balanceOf',
    args: address && CONTRACTS?.ERGC ? [address as `0x${string}`] : undefined,
    query: {
      enabled: isConnected && !!address && address.startsWith('0x') && !!CONTRACTS?.ERGC && !!ERC20_ABI,
      refetchInterval: 15_000,
    },
  });

  // Format token balances from raw BigInt values
  // USDC has 6 decimals, ERGC has 18 decimals
  // Safely handle BigInt values from readContract with error handling
  const safeFormatUnits = (value: unknown, decimals: number): string => {
    try {
      if (!value) return '0';
      if (typeof value === 'bigint') {
        return formatUnits(value, decimals);
      }
      if (typeof value === 'string' || typeof value === 'number') {
        return formatUnits(BigInt(value.toString()), decimals);
      }
      return '0';
    } catch (error) {
      console.error('[useWalletBalances] Error formatting balance:', error, value);
      return '0';
    }
  };

  const usdcBalanceFormatted = safeFormatUnits(usdcBalanceRaw, 6);
  const usdcEBalanceFormatted = safeFormatUnits(usdcEBalanceRaw, 6);
  const ergcBalanceFormatted = safeFormatUnits(ergcBalanceRaw, 18);

  const avaxValue = avaxBalance?.value ? BigInt(avaxBalance.value) : 0n;
  const usdcValue = (() => {
    try {
      if (!usdcBalanceRaw) return 0n;
      if (typeof usdcBalanceRaw === 'bigint') return usdcBalanceRaw;
      // Handle other types that can be converted to BigInt
      const value = usdcBalanceRaw as unknown;
      if (typeof value === 'string' || typeof value === 'number') {
        return BigInt(value.toString());
      }
      return 0n;
    } catch {
      return 0n;
    }
  })();

  // If Privy is authenticated but wallet address isn't ready yet, show loading
  const isWaitingForPrivyWallet = authenticated && ready && !address && !isWagmiConnected;

  if (!isConnected || !address) {
    return {
      avaxBalance: '0',
      usdcBalance: '0',
      usdcEBalance: '0',
      ergcBalance: '0',
      isLoading: isWaitingForPrivyWallet, // Show loading if waiting for Privy wallet
      avaxValue: 0n,
      usdcValue: 0n,
      avaxSymbol: 'AVAX',
      usdcSymbol: 'USDC',
      needsMigration: false,
      refetchBalances: async () => {
        await Promise.all([refetchAvax(), refetchUsdc(), refetchUsdcE?.(), refetchErgc?.()]);
      },
    };
  }

  // Check if user has USDC.e but not native USDC (migration needed)
  const safeBigInt = (value: unknown): bigint => {
    try {
      if (!value) return 0n;
      if (typeof value === 'bigint') return value;
      if (typeof value === 'string' || typeof value === 'number') {
        return BigInt(value.toString());
      }
      return 0n;
    } catch {
      return 0n;
    }
  };
  const usdcEBalanceValue = safeBigInt(usdcEBalanceRaw);
  const usdcBalanceValue = safeBigInt(usdcBalanceRaw);
  const hasUsdcE = usdcEBalanceValue > 0n;
  const hasNativeUsdc = usdcBalanceValue > 0n;
  const needsMigration = hasUsdcE && !hasNativeUsdc;

  // Debug balance results
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' || window.location.hostname === 'www.tiltvault.com') {
      if (isConnected && address && !isLoadingAvax && !isLoadingUsdc) {
        console.log('[useWalletBalances] Balance results:', {
          address,
          avaxBalanceFormatted: (avaxBalance as any)?.formatted,
          usdcBalanceRaw: usdcBalanceRaw ? String(usdcBalanceRaw) : '0',
          usdcBalanceFormatted: usdcBalanceFormatted,
          ergcBalanceFormatted: ergcBalanceFormatted,
          avaxValue: avaxValue.toString(),
          usdcValue: usdcValue.toString(),
        });
      }
    }
  }, [isConnected, address, avaxBalance, usdcBalanceRaw, usdcBalanceFormatted, ergcBalanceFormatted, isLoadingAvax, isLoadingUsdc, avaxValue, usdcValue]);

  // Format balances - use formatted if available, otherwise format from value
  const formatBalance = (balance: typeof avaxBalance, decimals: number = 18): string => {
    try {
      if (!balance || !balance.value) return '0';
      const balanceAny = balance as any;
      if (balanceAny.formatted) return balanceAny.formatted;
      
      // Format from BigInt value
      const balanceValue = balance.value;
      const value = typeof balanceValue === 'bigint' ? balanceValue : BigInt(String(balanceValue));
      const divisor = BigInt(10 ** decimals);
      const whole = value / divisor;
      const remainder = value % divisor;
      
      if (remainder === 0n) {
        return whole.toString();
      }
      
      const decimalStr = remainder.toString().padStart(decimals, '0');
      // Remove trailing zeros but keep at least one digit after decimal
      const decimal = decimalStr.replace(/0+$/, '') || '0';
      const result = `${whole}.${decimal}`;
      
      // Debug log for formatting
      if (process.env.NODE_ENV === 'development' || window.location.hostname === 'www.tiltvault.com') {
        console.log('[useWalletBalances] Formatting balance:', {
          value: value.toString(),
          decimals,
          divisor: divisor.toString(),
          whole: whole.toString(),
          remainder: remainder.toString(),
          decimalStr,
          decimal,
          result,
          symbol: balance.symbol,
        });
      }
      
      return result;
    } catch (error) {
      console.error('[useWalletBalances] Error formatting balance:', error, balance);
      return '0';
    }
  };

  // Format AVAX balance (native token, use useBalance)
  const avaxDecimals = avaxBalance?.decimals ?? 18;
  const formattedAvax = formatBalance(avaxBalance, avaxDecimals);
  
  // USDC, USDC.e, and ERGC are already formatted from readContract using formatUnits
  // They're already in human-readable format, no additional formatting needed
  const formattedUsdc = usdcBalanceFormatted;
  const formattedUsdcE = usdcEBalanceFormatted;
  const formattedErgc = ergcBalanceFormatted;

  return {
    avaxBalance: formattedAvax,
    usdcBalance: formattedUsdc,
    usdcEBalance: formattedUsdcE,
    ergcBalance: formattedErgc,
    isLoading: isLoadingAvax || isLoadingUsdc || isLoadingUsdcE || isLoadingErgc,
    avaxSymbol: avaxBalance?.symbol || 'AVAX',
    usdcSymbol: 'USDC', // USDC is always USDC when using readContract
    avaxValue,
    usdcValue,
    needsMigration,
    refetchBalances: async () => {
      await Promise.all([
        refetchAvax(),
        refetchUsdc(),
        refetchUsdcE?.(),
        refetchErgc?.(),
      ]);
    },
  };
};
