import { useAccount, useBalance } from 'wagmi';
import { avalanche } from 'wagmi/chains';

export const useWalletBalances = () => {
  const { address, isConnected } = useAccount();
  
  // AVAX balance
  const { data: avaxBalance, isLoading: isLoadingAvax } = useBalance({
    address,
    chainId: avalanche.id,
  });

  // USDC balance on Avalanche
  const { data: usdcBalance, isLoading: isLoadingUsdc } = useBalance({
    address,
    token: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664', // USDC.e on Avalanche
    chainId: avalanche.id,
  });

  if (!isConnected || !address) {
    return {
      avaxBalance: '0',
      usdcBalance: '0',
      isLoading: false,
    };
  }

  return {
    avaxBalance: avaxBalance?.formatted || '0',
    usdcBalance: usdcBalance?.formatted || '0',
    isLoading: isLoadingAvax || isLoadingUsdc,
    avaxSymbol: avaxBalance?.symbol || 'AVAX',
    usdcSymbol: usdcBalance?.symbol || 'USDC.e',
  };
};
