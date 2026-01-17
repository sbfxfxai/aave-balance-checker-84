import { useAccount, useDisconnect, useReadContract } from 'wagmi';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, Zap, Home, Bitcoin, Landmark, RefreshCw, LayoutDashboard, Wallet,
  ArrowUpRight, ArrowDownLeft, PlusCircle, MinusCircle, History, ExternalLink,
  Settings, Info, ArrowDownUp, Loader2, LogOut, Plus, Minus, TrendingDown, Check, AlertTriangle, Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useMorphoPositions } from '@/hooks/useMorphoPositions';
import { GmxPositionCard } from '@/components/GmxPositionCard';
import { ActionModal } from '@/components/ActionModal';
import { useState, useEffect, useMemo, useCallback, startTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CONTRACTS, AAVE_DATA_PROVIDER_ABI } from '@/config/contracts';
import { formatUnits } from 'viem';
import { storage } from '@/lib/storage';

type TiltVaultWindow = Window & {
  tiltvaultWallet?: {
    address?: string;
  };
};

interface Wallet {
  address: string;
  walletClientType: string;
}

export function SimpleDashboard() {
  const { address: wagmiAddress, isConnected: isWagmiConnected } = useAccount();
  const { authenticated, user, ready, logout, login } = usePrivy();
  const { wallets } = useWallets();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [activeAction, setActiveAction] = useState<'swap' | 'supply' | 'withdraw' | 'borrow' | 'repay' | 'send' | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Helper to check if address is Ethereum format (memoized to avoid recreation)
  const isEthereumAddress = useCallback((addr: string | undefined | null): boolean => {
    return !!addr && addr.startsWith('0x') && addr.length === 42;
  }, []);

  // Get the most relevant wallet address - prioritize Privy for authenticated users
  // Filter out Solana addresses (only use Ethereum addresses)
  // Optimized: Early returns and reduced array iterations
  const walletAddress = useMemo(() => {
    // Fast path: wagmi address (always Ethereum)
    if (wagmiAddress && isEthereumAddress(wagmiAddress)) {
      return wagmiAddress;
    }

    // Fast path: window wallet
    const windowWallet = (window as TiltVaultWindow).tiltvaultWallet?.address;
    if (windowWallet && isEthereumAddress(windowWallet)) {
      return windowWallet;
    }

    // Privy wallet lookup (only if authenticated)
    if (authenticated && ready) {
      // Check user wallet first (fastest)
      const userWalletAddr = user?.wallet?.address;
      if (userWalletAddr && isEthereumAddress(userWalletAddr)) {
        return userWalletAddr;
      }

      // Find Privy wallet (only iterate if wallets array exists)
      if (wallets && wallets.length > 0) {
        // Try Privy wallet first
        const privyWallet = wallets.find((w: Wallet) =>
          w.walletClientType === 'privy' && isEthereumAddress(w.address)
        );
        if (privyWallet) return privyWallet.address;

        // Fallback to any Ethereum wallet
        const ethereumWallet = wallets.find((w: Wallet) => isEthereumAddress(w.address));
        if (ethereumWallet) return ethereumWallet.address;
      }
    }

    return wagmiAddress || windowWallet || undefined;
  }, [authenticated, ready, wallets, user, wagmiAddress, isEthereumAddress]);

  // Check if user has any wallet connected (Privy or wagmi)
  // Prioritize connection status - if MetaMask is connected, show dashboard immediately
  // Also check if we have any address available (wagmiAddress or walletAddress)
  const windowWallet = (window as TiltVaultWindow).tiltvaultWallet?.address;
  const hasWallet = Boolean(
    isWagmiConnected || 
    !!wagmiAddress ||
    authenticated || 
    !!walletAddress ||
    !!windowWallet
  );
  
  // Debug logging (remove in production)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('[SimpleDashboard] Wallet check:', {
        isWagmiConnected,
        wagmiAddress,
        authenticated,
        walletAddress,
        windowWallet,
        hasWallet
      });
    }
  }, [isWagmiConnected, wagmiAddress, authenticated, walletAddress, windowWallet, hasWallet]);

  const { avaxBalance, usdcBalance, usdcEBalance, ergcBalance, needsMigration, isLoading: balanceLoading } = useWalletBalances();
  const positions = useAavePositions();
  const morphoPositions = useMorphoPositions();

  // Direct test read of WAVAX reserve data to debug
  const effectiveAddress = walletAddress || wagmiAddress;
  const hasRequiredArgs = !!(effectiveAddress && CONTRACTS.WAVAX);
  const { data: directWavaxData, error: directWavaxError } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: hasRequiredArgs ? [CONTRACTS.WAVAX as `0x${string}`, effectiveAddress as `0x${string}`] : undefined,
    query: {
      enabled: Boolean(hasWallet && hasRequiredArgs),
    },
  });

  // Log direct read for debugging (deferred to avoid blocking)
  useEffect(() => {
    if (directWavaxData && process.env.NODE_ENV === 'development') {
      // Defer console.log to avoid blocking main thread
      setTimeout(() => {
        console.log('[SimpleDashboard] DIRECT WAVAX read:', directWavaxData);
      }, 0);
    }
  }, [directWavaxData]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    
    // Use startTransition for non-urgent query invalidations
    startTransition(() => {
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
      queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
      queryClient.invalidateQueries({ queryKey: ['readContract'], exact: false });
    });

    try {
      if ('refetch' in positions && positions.refetch) {
        await (positions.refetch as () => Promise<unknown>)();
      }

      toast.success('Positions refreshed!');
    } catch (error) {
      toast.error('Failed to refresh positions');
      // Defer error logging to avoid blocking
      if (process.env.NODE_ENV === 'development') {
        setTimeout(() => console.error('Refresh error:', error), 0);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, positions]);

  const handleDisconnect = async () => {
    console.log('[SimpleDashboard] Starting disconnect process...');
    
    try {
      // Simple approach: clear everything and force reload immediately
      console.log('[SimpleDashboard] Clearing React Query cache...');
      queryClient.clear();
      
      console.log('[SimpleDashboard] Clearing storage...');
      storage.removeUserEmail();
      if (wagmiAddress) {
        storage.removeLastDepositTime(wagmiAddress);
      }
      const currentWalletAddress = walletAddress;
      if (currentWalletAddress) {
        storage.removeLastDepositTime(currentWalletAddress);
      }
      
      // Clear browser storage
      if (typeof window !== 'undefined') {
        sessionStorage.clear();
        localStorage.clear(); // Clear ALL localStorage
        // Also clear any IndexedDB if needed
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
      }
      
      console.log('[SimpleDashboard] Logging out from services...');
      // Logout from services
      if (authenticated) {
        await logout();
      }
      if (isWagmiConnected) {
        wagmiDisconnect();
      }
      
      console.log('[SimpleDashboard] Sign out complete, reloading page...');
      toast.info('Signed out successfully');
      
      // Force hard reload with cache busting
      window.location.href = window.location.origin + window.location.pathname + '?signed_out=' + Date.now();
      
    } catch (error) {
      console.error('[SimpleDashboard] Error during disconnect:', error);
      toast.error('Error signing out. Please refresh the page.');
      // Force reload even on error
      window.location.href = window.location.origin + window.location.pathname + '?signed_out=' + Date.now();
    }
  };

  // Show loading state while Privy/Wagmi is initializing
  if (!ready && !authenticated && !isWagmiConnected) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // If no wallet is connected, show the onboarding flow with Privy
  if (!hasWallet) {
    return (
      <div className="space-y-6">
        {/* Start Investing Section - matching image */}
        <Card className="p-6">
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-bold">Start Investing</h2>
            <p className="text-muted-foreground">
              Sign up with email for fully automated crypto investing
            </p>
            <div className="flex flex-col items-center gap-4 mt-6">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-500" />
                <span>Automated DeFi strategies</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-500" />
                <span>Non-custodial - you own your funds</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-500" />
                <span>No wallet setup required</span>
              </div>
              <Button
                onClick={() => login()}
                className="w-full max-w-md mt-4"
                size="lg"
              >
                Sign Up with Email
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                By signing up, you agree to our Terms of Service and Privacy Policy
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // Use wagmiAddress as fallback if walletAddress isn't ready yet
  const displayAddress = walletAddress || wagmiAddress || 'Connecting...';
  const effectiveWalletAddress = walletAddress || wagmiAddress;

  return (
    <div className="space-y-6">
      {/* 1. Your Account */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Your Account
          </h3>
          <Button variant="outline" onClick={handleDisconnect}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-gray-600">
              {authenticated ? 'Email Wallet' : 'External Wallet'}
            </p>
          </div>
          <p className="font-mono text-sm sm:text-base break-all">
            {displayAddress}
          </p>
        </div>
      </Card>

      {/* 2. Available Cash */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Available Cash</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <p className="font-medium text-blue-500">AVAX</p>
            <p className="text-2xl font-bold">{balanceLoading ? '...' : (avaxBalance ? parseFloat(avaxBalance).toFixed(4) : '0.0000')}</p>
            <p className="text-sm text-gray-600">For network fees</p>
          </div>
          <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
            <p className="font-medium text-green-500">USD Balance</p>
            <p className="text-2xl font-bold">${balanceLoading ? '...' : parseFloat(usdcBalance).toFixed(2)}</p>
            <p className="text-sm text-gray-600">Ready to invest</p>
            {needsMigration && parseFloat(usdcEBalance) > 0 && (
              <p className="text-xs text-orange-500 mt-1">
                ⚠️ You have {parseFloat(usdcEBalance).toFixed(2)} USDC.e - swap to native USDC
              </p>
            )}
          </div>
          <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
            <p className="font-medium text-purple-500">ERGC</p>
            <p className="text-2xl font-bold">{balanceLoading ? '...' : parseFloat(ergcBalance || '0').toFixed(2)}</p>
            <p className="text-sm text-gray-600">EnergyCoin tokens</p>
          </div>
        </div>
      </Card>

      {/* 3. Morpho Vault */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-purple-500" />
            Morpho Vault
          </h3>
          <div className="flex items-center gap-2">
            {parseFloat(morphoPositions.totalUsdValue || '0') > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // TODO: Open MorphoWithdrawModal
                  toast.info('Withdraw All functionality coming soon');
                }}
                className="flex items-center gap-2"
              >
                <ArrowDownLeft className="h-4 w-4" />
                Withdraw All
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
            <p className="font-medium text-purple-500">Total Value</p>
            {morphoPositions.isLoading ? (
              <div className="flex items-center gap-2 mt-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading...</span>
              </div>
            ) : morphoPositions.error ? (
              <div className="mt-2">
                <p className="text-sm text-red-500">Error loading positions</p>
                <p className="text-xs text-muted-foreground mt-1">{morphoPositions.error}</p>
              </div>
            ) : (
              <>
                <p className="text-2xl font-bold">${parseFloat(morphoPositions.totalUsdValue || '0').toFixed(2)}</p>
                <p className="text-sm text-gray-600">Earning {morphoPositions.blendedApy.toFixed(2)}% APY</p>
              </>
            )}
          </div>
          {parseFloat(morphoPositions.eurcUsdValue || '0') > 0 && (
            <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
              <p className="font-medium text-green-500">Gauntlet USDC Core</p>
              <p className="text-2xl font-bold">${parseFloat(morphoPositions.eurcUsdValue).toFixed(2)}</p>
              <p className="text-sm text-gray-600">Earning {morphoPositions.eurcApy.toFixed(2)}% APY</p>
            </div>
          )}
          {parseFloat(morphoPositions.daiUsdValue || '0') > 0 && (
            <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
              <p className="font-medium text-green-500">Hyperithm USDC</p>
              <p className="text-2xl font-bold">${parseFloat(morphoPositions.daiUsdValue).toFixed(2)}</p>
              <p className="text-sm text-gray-600">Earning {morphoPositions.daiApy.toFixed(2)}% APY</p>
            </div>
          )}
          {!morphoPositions.isLoading && 
           parseFloat(morphoPositions.totalUsdValue || '0') === 0 && 
           parseFloat(morphoPositions.eurcUsdValue || '0') === 0 && 
           parseFloat(morphoPositions.daiUsdValue || '0') === 0 && (
            <div className="md:col-span-2 p-4 rounded-lg bg-muted/50 border border-border">
              <p className="text-sm text-muted-foreground">No Morpho vault positions found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Make a deposit on the Stack page to create your first Morpho position
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* 4. GMX Positions */}
      <GmxPositionCard walletAddress={effectiveWalletAddress} onRefresh={handleRefresh} />

      {/* 5. Your Earnings */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Your Earnings</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
            <p className="font-medium text-green-500">Savings Balance</p>
            <p className="text-2xl font-bold">${parseFloat(positions.usdcSupply).toFixed(2)}</p>
            <p className="text-sm text-gray-600">Earning {(positions.usdcSupplyApy || 0).toFixed(2)}% APY</p>
          </div>
          <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
            <p className="font-medium text-red-500">Loan Balance</p>
            <p className="text-2xl font-bold">{parseFloat(positions.avaxBorrowed || '0').toFixed(4)}</p>
            <p className="text-sm text-gray-600">Pay {(positions.avaxBorrowApy || 0).toFixed(2)}% APY</p>
          </div>
        </div>
      </Card>

      {/* 6. Quick Actions */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Button
            onClick={() => setActiveAction('swap')}
            className="flex items-center gap-2 h-12"
          >
            <ArrowDownUp className="h-4 w-4" />
            Get USDC
          </Button>

          <Button
            onClick={() => setActiveAction('supply')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            Earn Interest
          </Button>

          <Button
            onClick={() => setActiveAction('withdraw')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <Minus className="h-4 w-4" />
            Cash Out
          </Button>

          <Button
            onClick={() => setActiveAction('borrow')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <TrendingDown className="h-4 w-4" />
            Borrow Now
          </Button>

          <Button
            onClick={() => setActiveAction('repay')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <TrendingUp className="h-4 w-4" />
            Pay Off Debt
          </Button>

          <Button
            onClick={() => setActiveAction('send')}
            className="flex items-center gap-2 h-12 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <ArrowDownUp className="h-4 w-4" />
            Send Money
          </Button>
        </div>
      </Card>

      {/* 7. Warnings - Important Trading Information */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Important Trading Information</h3>
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
            <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-red-500">One-Click Trading</p>
              <p className="text-sm text-muted-foreground">
                All trades execute immediately with no confirmation screen. Please double-check amounts before clicking.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
            <Clock className="h-5 w-5 text-orange-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-orange-500">Transaction Processing Time</p>
              <p className="text-sm text-muted-foreground">
                Each transaction takes 15-30 seconds to clear the network. Please be patient and do not refresh the page.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Action Modal */}
      {activeAction && (
        <ActionModal
          isOpen={!!activeAction}
          onClose={() => setActiveAction(null)}
          action={activeAction}
        />
      )}

      {/* Email Login Button - Small button at bottom when MetaMask is connected */}
      {isWagmiConnected && !authenticated && (
        <div className="flex justify-center pt-6 border-t border-border/50">
          <Button
            onClick={() => login()}
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
          >
            <Wallet className="h-4 w-4" />
            <span className="text-sm">Sign Up with Email</span>
          </Button>
        </div>
      )}
    </div>
  );
}
