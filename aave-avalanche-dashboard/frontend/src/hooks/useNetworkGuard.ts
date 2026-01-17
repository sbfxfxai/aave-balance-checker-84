import { useEffect, useCallback } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import { analytics } from '@/lib/analytics';
import { supportedChains } from '@/config/chains';

/**
 * Network guard hook that ensures user is on Avalanche C-Chain
 * This is an Avalanche-first app with cross-chain features
 */
export function useNetworkGuard() {
  const { chainId, isConnected } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  // Centralized network switch functions
  const switchToAvalanche = useCallback(() => {
    try {
      const fromChain = chainId;
      
      analytics.trackNetwork({
        event: 'network_switched',
        fromChain,
        toChain: supportedChains.avalanche.id,
        timestamp: Date.now(),
      });
      
      switchChain({ chainId: supportedChains.avalanche.id });
    } catch (error) {
      console.error('Failed to switch to Avalanche:', error);
      
      analytics.trackNetwork({
        event: 'network_switch_failed',
        fromChain: chainId,
        toChain: supportedChains.avalanche.id,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      toast.error('Failed to switch to Avalanche. Please switch manually in your wallet.');
      throw error;
    }
  }, [switchChain, chainId]);

  const switchToArbitrum = useCallback(() => {
    try {
      const fromChain = chainId;
      
      analytics.trackNetwork({
        event: 'network_switched',
        fromChain,
        toChain: supportedChains.arbitrum.id,
        timestamp: Date.now(),
      });
      
      switchChain({ chainId: supportedChains.arbitrum.id });
    } catch (error) {
      console.error('Failed to switch to Arbitrum:', error);
      
      analytics.trackNetwork({
        event: 'network_switch_failed',
        fromChain: chainId,
        toChain: supportedChains.arbitrum.id,
        timestamp: Date.now(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      
      toast.error('Failed to switch to Arbitrum. Please switch manually in your wallet.');
      throw error;
    }
  }, [switchChain, chainId]);

  useEffect(() => {
    if (!isConnected) return;

    // Only check for Avalanche - this is an Avalanche-first app
    if (chainId && chainId !== supportedChains.avalanche.id) {
      const chainName = chainId === 43113 ? 'Avalanche Fuji Testnet' : `Chain ${chainId}`;
      
      toast.error(
        `TiltVault runs on Avalanche C-Chain. Currently connected to ${chainName}.`,
        {
          duration: 8000,
          action: {
            label: 'Switch to Avalanche',
            onClick: switchToAvalanche,
          },
        }
      );
    }
  }, [chainId, isConnected, switchToAvalanche]);

  return {
    isCorrectChain: chainId === supportedChains.avalanche.id,
    isSwitching,
    chainId,
    switchToAvalanche,
    switchToArbitrum,
  };
}

