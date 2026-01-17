import { useNetworkGuard } from '@/hooks/useNetworkGuard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2, ArrowRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { supportedChains } from '@/config/chains';

interface NetworkGuardProps {
  requiredChain?: typeof supportedChains.avalanche | typeof supportedChains.arbitrum;
  feature?: 'deposit' | 'morpho' | 'gmx';
  children: React.ReactNode;
}

/**
 * Network guard component that ensures users are on the correct network
 * for specific features and provides easy switching
 */
export function NetworkGuard({ requiredChain = supportedChains.avalanche, feature, children }: NetworkGuardProps) {
  const { isCorrectChain, isSwitching, chainId, switchToAvalanche, switchToArbitrum } = useNetworkGuard();
  const [shouldShow, setShouldShow] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setShouldShow(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  // Don't show anything if on correct chain or not connected
  if (!chainId || !shouldShow) {
    return <>{children}</>;
  }

  // Check if user is on the wrong network for the feature
  const isWrongNetwork = chainId !== requiredChain.id;
  
  if (!isWrongNetwork) {
    return <>{children}</>;
  }

  const getNetworkName = (chainId: number) => {
    switch (chainId) {
      case supportedChains.avalanche.id:
        return 'Avalanche C-Chain';
      case supportedChains.arbitrum.id:
        return 'Arbitrum One';
      case 43113:
        return 'Avalanche Fuji Testnet';
      case 1:
        return 'Ethereum Mainnet';
      default:
        return `Chain ${chainId}`;
    }
  };

  const getFeatureName = (feature?: string) => {
    switch (feature) {
      case 'deposit':
        return 'Aave deposits';
      case 'morpho':
        return 'Morpho vaults';
      case 'gmx':
        return 'GMX trading';
      default:
        return 'this feature';
    }
  };

  const handleSwitch = async () => {
    try {
      if (requiredChain.id === supportedChains.avalanche.id) {
        switchToAvalanche();
      } else if (requiredChain.id === supportedChains.arbitrum.id) {
        switchToArbitrum();
      }
    } catch (error) {
      // Error handling is done in the hook
    }
  };

  return (
    <div className="space-y-4">
      <Alert className="border-orange-500 bg-orange-50 dark:bg-orange-950/20">
        <AlertTriangle className="h-4 w-4 text-orange-600" />
        <AlertDescription>
          <div className="space-y-3">
            <div>
              <p className="font-medium text-orange-800 dark:text-orange-200">
                Wrong Network Detected
              </p>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                You're currently on <strong>{getNetworkName(chainId)}</strong> but{' '}
                <strong>{getFeatureName(feature)}</strong> requires{' '}
                <strong>{getNetworkName(requiredChain.id)}</strong>.
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSwitch}
                disabled={isSwitching}
                size="sm"
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                {isSwitching ? (
                  <>
                    <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    Switching...
                  </>
                ) : (
                  <>
                    Switch to {getNetworkName(requiredChain.id)}
                    <ArrowRight className="ml-2 h-3 w-3" />
                  </>
                )}
              </Button>
              
              <div className="text-xs text-orange-600 dark:text-orange-400">
                Or switch manually in your wallet
              </div>
            </div>
          </div>
        </AlertDescription>
      </Alert>
      
      {/* Show children but disabled */}
      <div className="opacity-50 pointer-events-none">
        {children}
      </div>
    </div>
  );
}

/**
 * Original NetworkGuard for backward compatibility
 */
export function NetworkGuardBanner() {
  const { isCorrectChain, isSwitching, chainId, switchToAvalanche } = useNetworkGuard();

  const [shouldShow, setShouldShow] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setShouldShow(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  if (isCorrectChain || !chainId || !shouldShow) {
    return null;
  }

  const handleSwitch = () => {
    try {
      switchToAvalanche();
    } catch (error) {
      // Error handling is done in the hook
    }
  };

  return (
    <Alert className="mb-4 border-orange-500 bg-orange-50 dark:bg-orange-950/20">
      <AlertTriangle className="h-4 w-4 text-orange-600" />
      <AlertDescription className="flex items-center justify-between">
        <span className="text-sm">
          Wrong network detected. Please switch to <strong>Avalanche C-Chain</strong> to use this app.
        </span>
        <Button
          onClick={handleSwitch}
          disabled={isSwitching}
          size="sm"
          variant="outline"
          className="ml-4 border-orange-600 text-orange-700 hover:bg-orange-100"
        >
          {isSwitching ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Switching...
            </>
          ) : (
            'Switch Network'
          )}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

