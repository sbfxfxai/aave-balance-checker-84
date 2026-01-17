import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { supportedChains } from '@/config/chains';
import { Button } from '@/components/ui/button';
import { Wallet, LogOut, Loader2, AlertTriangle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useRef, useState } from 'react';
import { formatAddress } from '@/lib/utils';
import React from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { logger } from '@/utils/logger';
import { getErrorMessage, getErrorToastConfig } from '@/utils/errors';

export function ConnectWalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { toast } = useToast();
  const { authenticated, logout: privyLogout } = usePrivy();
  
  // WalletConnect modal state
  const [showWCModal, setShowWCModal] = useState(false);
  const [isWCConnecting, setIsWCConnecting] = useState(false);
  
  // Switch wallet state
  const [isSwitchingWallet, setIsSwitchingWallet] = useState(false);

  // Define supported chain IDs with proper typing
  const SUPPORTED_CHAINS: number[] = [supportedChains.avalanche.id, supportedChains.arbitrum.id];
  
  // CRITICAL: Auto-logout from Privy when MetaMask connects
  // Use a ref to prevent race conditions and multiple simultaneous logouts
  const logoutInProgressRef = React.useRef(false);
  
  useEffect(() => {
    if (isConnected && authenticated && !logoutInProgressRef.current) {
      logoutInProgressRef.current = true;
      logger.debug('[ConnectWalletButton] MetaMask connected, logging out from Privy...');
      privyLogout()
        .then(() => {
          logger.debug('[ConnectWalletButton] ✅ Privy logged out successfully');
        })
        .catch((error) => {
          logger.error('[ConnectWalletButton] Error logging out from Privy:', getErrorMessage(error));
        })
        .finally(() => {
          // Reset flag after a delay to allow state to settle
          setTimeout(() => {
            logoutInProgressRef.current = false;
          }, 1000);
        });
    }
  }, [isConnected, authenticated, privyLogout]);

  // Show error toast if connection fails
  useEffect(() => {
    if (error) {
      const errorConfig = getErrorToastConfig(error);
      toast(errorConfig);
    }
  }, [error, toast]);

  // CRITICAL: Listen for account changes
  useEffect(() => {
    if (isConnected && address) {
      logger.debug('[Wallet] Address changed to:', address);
      
      toast({
        title: 'Wallet Switched',
        description: `Now using ${formatAddress(address)}`,
      });
      
      // TODO: Refresh user data when account changes
      // refetchBalances();
      // refetchPositions();
      // refetchTransactions();
    }
  }, [address, isConnected, toast]);
  
  // Validate chain after connection (move after hooks)
  if (isConnected && chain && !SUPPORTED_CHAINS.includes(chain.id)) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <div className="space-y-2">
            <p className="font-medium">Wrong Network</p>
            <p className="text-sm">
              You're connected to {chain.name || `Chain ${chain.id}`}. Please switch to Avalanche or Arbitrum to use TiltVault.
            </p>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                onClick={() => switchChain({ chainId: supportedChains.avalanche.id })}
              >
                Switch to Avalanche
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => switchChain({ chainId: supportedChains.arbitrum.id })}
              >
                Switch to Arbitrum
              </Button>
            </div>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  // Robust mobile detection using multiple methods
  const isMobile = typeof window !== 'undefined' && (
    'ontouchstart' in window || 
    navigator.maxTouchPoints > 0 || 
    window.innerWidth < 768
  );
  
  // Tablet detection (optional)
  const isTablet = typeof window !== 'undefined' && 
    window.innerWidth >= 768 && window.innerWidth < 1024 && 
    'ontouchstart' in window;

  // Get the injected connector (MetaMask, etc.)
  const injectedConnector = connectors.find((c) => c.id === 'injected' || c.type === 'injected');
  const walletConnectConnector = connectors.find((c) => c.id === 'walletConnect' || c.name === 'WalletConnect');

  const handleConnect = async () => {
    // CRITICAL: Logout from Privy if authenticated before connecting MetaMask
    if (authenticated) {
      logger.debug('[ConnectWalletButton] Logging out from Privy before connecting MetaMask...');
      try {
        await privyLogout();
        logger.debug('[ConnectWalletButton] ✅ Privy logged out successfully');
      } catch (error) {
        logger.error('[ConnectWalletButton] Error logging out from Privy:', getErrorMessage(error));
        // Continue with connection even if logout fails
      }
    }

    if (injectedConnector) {
      connect({ connector: injectedConnector });
    } else {
      toast({
        title: 'No wallet found',
        description: 'Please install MetaMask or another Web3 wallet',
        variant: 'destructive',
      });
    }
  };

  const handleWalletConnect = async () => {
    logger.debug('[ConnectWalletButton] Starting WalletConnect flow');
    
    // Show loading state immediately
    setIsWCConnecting(true);
    setShowWCModal(true);
    
    // Show user guidance
    toast({
      title: 'Opening WalletConnect',
      description: 'Scan the QR code with your mobile wallet app',
    });
    
    try {
      // CRITICAL: Logout from Privy if authenticated before connecting
      if (authenticated) {
        logger.debug('[ConnectWalletButton] Logging out from Privy before WalletConnect...');
        try {
          await privyLogout();
          logger.debug('[ConnectWalletButton] ✅ Privy logged out successfully');
        } catch (error) {
          logger.error('[ConnectWalletButton] Error logging out from Privy:', getErrorMessage(error));
        }
      }
      
      // Find WalletConnect connector (already declared above)
      if (walletConnectConnector) {
        logger.debug('[ConnectWalletButton] Connecting with WalletConnect');
        await connect({ connector: walletConnectConnector });
        logger.debug('[ConnectWalletButton] WalletConnect connection initiated');
      } else {
        throw new Error('WalletConnect not available');
      }
    } catch (error) {
      logger.error('[ConnectWalletButton] WalletConnect connection failed:', getErrorMessage(error));
      const errorConfig = getErrorToastConfig(error);
      toast(errorConfig);
    } finally {
      // Clean up state
      setIsWCConnecting(false);
      setShowWCModal(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    toast({
      title: 'Wallet disconnected',
      description: 'Your wallet has been disconnected',
    });
  };

  const handleSwitchWallet = async () => {
    logger.debug('[ConnectWalletButton] Starting wallet switch flow');
    
    setIsSwitchingWallet(true);
    
    try {
      // Disconnect current wallet
      await disconnect();
      
      // Show guidance to user
      toast({
        title: 'Wallet Disconnected',
        description: 'Choose a new wallet to connect',
      });
      
      // Small delay to let state clear
      setTimeout(() => {
        setIsSwitchingWallet(false);
        logger.debug('[ConnectWalletButton] Ready for new wallet connection');
      }, 500);
      
    } catch (error) {
      logger.error('[ConnectWalletButton] Error switching wallet:', getErrorMessage(error));
      toast({
        title: 'Switch Wallet Failed',
        description: 'Please try disconnecting and reconnecting manually',
        variant: 'destructive',
      });
      setIsSwitchingWallet(false);
    }
  };

  // Show connection error banner inline, but keep buttons visible
  const renderErrorBanner = () => {
    if (!error) return null;
    
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <div className="space-y-2">
            <p className="font-medium">Connection Failed</p>
            <p className="text-sm">{getErrorMessage(error)}</p>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  // Clear error and retry
                  connect({ connector: connectors[0] });
                }}
              >
                Try Again
              </Button>
            </div>
          </div>
        </AlertDescription>
      </Alert>
    );
  };

  // If connected, show address dropdown
  if (isConnected && address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="flex items-center gap-2" disabled={isSwitchingWallet}>
            {isSwitchingWallet ? (
              <>
                <Loader2 className="animate-spin h-4 w-4" />
                <span className="hidden sm:inline">Switching...</span>
                <span className="sm:hidden">Switching...</span>
              </>
            ) : (
              <>
                <Wallet className="h-4 w-4" />
                <span className="hidden sm:inline">{formatAddress(address)}</span>
                <span className="sm:hidden">{formatAddress(address, 4)}</span>
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Connected Wallet</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-xs">{address}</span>
              <span className="text-xs text-muted-foreground">
                {chain?.name || 'Avalanche'}
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          
          {/* Switch Wallet Option */}
          <DropdownMenuItem 
            onClick={handleSwitchWallet}
            disabled={isSwitchingWallet}
            className="flex items-center gap-2"
          >
            {isSwitchingWallet ? (
              <>
                <Loader2 className="animate-spin h-4 w-4 mr-2" />
                Switching...
              </>
            ) : (
              <>
                <Wallet className="h-4 w-4 mr-2" />
                Switch Wallet
              </>
            )}
          </DropdownMenuItem>
          
          <DropdownMenuItem onClick={handleDisconnect} className="text-red-600">
            <LogOut className="h-4 w-4 mr-2" />
            Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // If connecting, show loading state
  if (isPending) {
    return (
      <Button variant="outline" size="sm" disabled className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="hidden sm:inline">Connecting...</span>
        <span className="sm:hidden">Connecting</span>
      </Button>
    );
  }

  // If not connected, show smart wallet selection
  if (!isConnected) {
    return (
      <div className="space-y-4">
        {/* Show error banner if present, but keep buttons visible */}
        {renderErrorBanner()}
        
        {/* Connection buttons */}
        <div className="flex gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={handleConnect}
            disabled={isPending || isWCConnecting}
            className="flex items-center gap-2"
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Connecting...</span>
                <span className="sm:hidden">Connecting</span>
              </>
            ) : (
              <>
                <Wallet className="h-4 w-4" />
                <span className="hidden sm:inline">Connect Wallet</span>
                <span className="sm:hidden">Connect</span>
              </>
            )}
          </Button>
          
          {/* WalletConnect button with proper UX */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleWalletConnect}
            disabled={isWCConnecting || isPending}
            className="flex items-center gap-2"
          >
            {isWCConnecting ? (
              <>
                <Loader2 className="animate-spin mr-2 h-4 w-4" />
                <span className="hidden sm:inline">Scan QR Code...</span>
                <span className="sm:hidden">Scanning...</span>
              </>
            ) : (
              <>
                <Wallet className="mr-2 h-4 w-4" />
                <span className="hidden sm:inline">{isTablet ? 'Connect Tablet' : 'Connect Mobile'}</span>
                <span className="sm:hidden">{isTablet ? 'Tablet' : 'Mobile'}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }
}
