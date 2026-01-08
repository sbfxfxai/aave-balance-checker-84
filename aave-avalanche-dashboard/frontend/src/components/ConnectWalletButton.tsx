import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Wallet, LogOut, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { useEffect, useRef } from 'react';
import { formatAddress } from '@/lib/utils';
import React from 'react';
// @ts-ignore - @privy-io/react-auth types exist but TypeScript can't resolve them due to package.json exports configuration
import { usePrivy } from '@privy-io/react-auth';

export function ConnectWalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { toast } = useToast();
  const { authenticated, logout: privyLogout } = usePrivy();

  // CRITICAL: Auto-logout from Privy when MetaMask connects
  // Use a ref to prevent race conditions and multiple simultaneous logouts
  const logoutInProgressRef = React.useRef(false);
  
  useEffect(() => {
    if (isConnected && authenticated && !logoutInProgressRef.current) {
      logoutInProgressRef.current = true;
      console.log('[ConnectWalletButton] MetaMask connected, logging out from Privy...');
      privyLogout()
        .then(() => {
          console.log('[ConnectWalletButton] ✅ Privy logged out successfully');
        })
        .catch((error) => {
          console.error('[ConnectWalletButton] Error logging out from Privy:', error);
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
      toast({
        title: 'Connection failed',
        description: error.message || 'Failed to connect wallet',
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  // Get the injected connector (MetaMask, etc.)
  const injectedConnector = connectors.find((c) => c.id === 'injected' || c.type === 'injected');

  const handleConnect = async () => {
    // CRITICAL: Logout from Privy if authenticated before connecting MetaMask
    if (authenticated) {
      console.log('[ConnectWalletButton] Logging out from Privy before connecting MetaMask...');
      try {
        await privyLogout();
        console.log('[ConnectWalletButton] ✅ Privy logged out successfully');
      } catch (error) {
        console.error('[ConnectWalletButton] Error logging out from Privy:', error);
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

  const handleDisconnect = () => {
    disconnect();
    toast({
      title: 'Wallet disconnected',
      description: 'Your wallet has been disconnected',
    });
  };

  // If connected, show address dropdown
  if (isConnected && address) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            <span className="hidden sm:inline">{formatAddress(address)}</span>
            <span className="sm:hidden">{formatAddress(address, 4)}</span>
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

  // Show connect button
  return (
    <Button
      variant="default"
      size="sm"
      onClick={handleConnect}
      className="flex items-center gap-2"
    >
      <Wallet className="h-4 w-4" />
      <span className="hidden sm:inline">Connect Wallet</span>
      <span className="sm:hidden">Connect</span>
    </Button>
  );
}

