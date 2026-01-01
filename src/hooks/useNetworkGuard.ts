import { useEffect, useCallback } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { avalanche } from 'wagmi/chains';
import { toast } from 'sonner';

/**
 * Network guard hook that ensures user is on Avalanche C-Chain
 * Prompts for network switch if connected to wrong chain
 * Centralizes all network switching logic
 */
export function useNetworkGuard() {
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  // Centralized network switch function
  const switchToAvalanche = useCallback(() => {
    try {
      switchChain({ chainId: avalanche.id });
    } catch (error) {
      console.error('Failed to switch chain:', error);
      toast.error('Failed to switch network. Please switch manually in your wallet.');
      throw error; // Re-throw so callers can handle if needed
    }
  }, [switchChain]);

  useEffect(() => {
    if (!isConnected) return;

    // Check if user is on the correct chain
    if (chainId && chainId !== avalanche.id) {
      const chainName = chainId === 43113 ? 'Avalanche Fuji Testnet' : `Chain ${chainId}`;
      
      toast.error(
        `Please switch to Avalanche C-Chain. Currently connected to ${chainName}.`,
        {
          duration: 8000,
          action: {
            label: 'Switch Network',
            onClick: switchToAvalanche,
          },
        }
      );
    }
  }, [chainId, isConnected, switchToAvalanche]);

  return {
    isCorrectChain: chainId === avalanche.id,
    isSwitching,
    chainId,
    switchToAvalanche, // Expose centralized switch function
  };
}

