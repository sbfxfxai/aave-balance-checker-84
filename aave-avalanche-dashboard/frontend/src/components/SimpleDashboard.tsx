import { useAccount, useDisconnect, useReadContract } from 'wagmi';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TrendingUp, Zap, Home, Bitcoin, Landmark, RefreshCw, LayoutDashboard, Wallet,
  ArrowUpRight, ArrowDownLeft, PlusCircle, MinusCircle, History, ExternalLink,
  Settings, Info, ArrowDownUp, Loader2, LogOut, Plus, Minus, TrendingDown
} from 'lucide-react';
import { toast } from 'sonner';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { GmxPositionCard } from '@/components/GmxPositionCard';
import { ActionModal } from '@/components/ActionModal';
import { useConnect } from 'wagmi';
import { useState, useEffect, useMemo, useCallback, startTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CONTRACTS, AAVE_DATA_PROVIDER_ABI } from '@/config/contracts';
import { formatUnits } from 'viem';

type TiltVaultWindow = Window & {
  tiltvaultWallet?: {
    address?: string;
  };
};

export function SimpleDashboard() {
  const { address: wagmiAddress, isConnected: isWagmiConnected } = useAccount();
  const { authenticated, user, ready, logout, login } = usePrivy();
  const { wallets } = useWallets();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { connect, connectors } = useConnect();
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
        const privyWallet = wallets.find(w =>
          w.walletClientType === 'privy' && isEthereumAddress(w.address)
        );
        if (privyWallet) return privyWallet.address;

        // Fallback to any Ethereum wallet
        const ethereumWallet = wallets.find(w => isEthereumAddress(w.address));
        if (ethereumWallet) return ethereumWallet.address;
      }
    }

    return wagmiAddress || windowWallet || undefined;
  }, [authenticated, ready, wallets, user, wagmiAddress, isEthereumAddress]);

  // Check if user has any wallet connected (Privy or wagmi)
  const hasWallet = Boolean(walletAddress && (authenticated || isWagmiConnected));

  const { avaxBalance, usdcBalance, usdcEBalance, ergcBalance, needsMigration, isLoading: balanceLoading } = useWalletBalances();
  const positions = useAavePositions();

  // Direct test read of WAVAX reserve data to debug
  const hasRequiredArgs = !!(walletAddress && CONTRACTS.WAVAX);
  const { data: directWavaxData, error: directWavaxError } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: hasRequiredArgs ? [CONTRACTS.WAVAX as `0x${string}`, walletAddress as `0x${string}`] : undefined,
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
        await (positions.refetch as () => Promise<any>)();
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
    if (authenticated) {
      await logout();
    }
    if (isWagmiConnected) {
      wagmiDisconnect();
    }
    toast.info('Signed out successfully');
  };

  // Show loading state while Privy/Wagmi is initializing
  if (!ready && !authenticated && !isWagmiConnected) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // If no wallet is connected, show the onboarding flow with Privy and WalletConnect
  if (!hasWallet) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="space-y-6">
          {/* Hero Section */}
          <div className="text-center space-y-4">
            <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              Banking that works as hard as you do
            </h1>
            <p className="text-muted-foreground text-lg">
              Earn <span className="font-semibold text-emerald-500">5-8% APY</span> on savings. Optional managed Bitcoin exposure. Built on Aave—$70B+ secured.
            </p>
          </div>

          {/* Login Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Privy Email Login */}
            <Card className="p-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-3 rounded-full bg-gradient-primary">
                  <Wallet className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold mb-2">Email Wallet</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Sign up with email to get a secure smart wallet
                  </p>
                  <Button
                    onClick={() => login()}
                    className="w-full"
                    size="lg"
                  >
                    Sign Up with Email
                  </Button>
                </div>
              </div>
            </Card>

            {/* WalletConnect */}
            <Card className="p-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="p-3 rounded-full bg-gradient-primary">
                  <Wallet className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold mb-2">Wallet Connect</h2>
                  <p className="text-sm text-muted-foreground mb-4">
                    Connect your existing MetaMask or other wallet
                  </p>
                  <Button
                    onClick={() => {
                      const walletConnectConnector = connectors.find(c => c.id === 'walletConnect');
                      if (walletConnectConnector) {
                        connect({ connector: walletConnectConnector });
                      } else {
                        toast.error('WalletConnect not available');
                      }
                    }}
                    className="w-full"
                    size="lg"
                    variant="outline"
                  >
                    <Wallet className="mr-2 h-4 w-4" />
                    Connect Wallet
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Wallet Info */}
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
            {walletAddress}
          </p>
        </div>
      </Card>

      {/* Balances */}
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
          {parseFloat(ergcBalance || '0') > 0 && (
            <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
              <p className="font-medium text-purple-500">ERGC</p>
              <p className="text-2xl font-bold">{balanceLoading ? '...' : parseFloat(ergcBalance).toFixed(2)}</p>
              <p className="text-sm text-gray-600">EnergyCoin tokens</p>
            </div>
          )}
        </div>
      </Card>

      {/* Aave Positions */}
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

      {/* GMX Positions */}
      <GmxPositionCard walletAddress={walletAddress} onRefresh={handleRefresh} />

      {/* Action Buttons */}
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

      {/* Action Modal */}
      {activeAction && (
        <ActionModal
          isOpen={!!activeAction}
          onClose={() => setActiveAction(null)}
          action={activeAction}
        />
      )}
    </div>
  );
}
