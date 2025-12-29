import { useAccount, useDisconnect, useReadContract } from 'wagmi';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet, LogOut, ArrowDownUp, Plus, Minus, TrendingUp, TrendingDown, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { GmxPositionCard } from '@/components/GmxPositionCard';
import { ActionModal } from '@/components/ActionModal';
import { useState, useEffect, useMemo } from 'react';
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
  const { authenticated, user, ready, logout } = usePrivy();
  const { wallets } = useWallets();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [activeAction, setActiveAction] = useState<'swap' | 'supply' | 'withdraw' | 'borrow' | 'repay' | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Get the most relevant wallet address
  const walletAddress = useMemo(() => {
    if (wagmiAddress) return wagmiAddress;

    // Check Privy wallets
    const privyWallet = wallets.find(w => w.walletClientType === 'privy');
    if (privyWallet) return privyWallet.address;

    return user?.wallet?.address || (window as TiltVaultWindow).tiltvaultWallet?.address;
  }, [wagmiAddress, wallets, user]);

  const { avaxBalance, usdcBalance, usdcEBalance, needsMigration, isLoading: balanceLoading } = useWalletBalances();
  const positions = useAavePositions();

  // Direct test read of WAVAX reserve data to debug
  const hasRequiredArgs = !!(walletAddress && CONTRACTS.WAVAX);
  const { data: directWavaxData, error: directWavaxError } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: hasRequiredArgs ? [CONTRACTS.WAVAX as `0x${string}`, walletAddress as `0x${string}`] : undefined,
    query: {
      enabled: Boolean((authenticated || isWagmiConnected) && hasRequiredArgs),
    },
  });

  // Log direct read for debugging
  useEffect(() => {
    if (directWavaxData) {
      console.log('[SimpleDashboard] DIRECT WAVAX read:', directWavaxData);
    }
  }, [directWavaxData]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
      queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
      queryClient.invalidateQueries({ queryKey: ['readContract'], exact: false });

      if ('refetch' in positions && positions.refetch) {
        await (positions.refetch as () => Promise<any>)();
      }

      toast.success('Positions refreshed!');
    } catch (error) {
      toast.error('Failed to refresh positions');
      console.error('Refresh error:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

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
  if (!ready) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // If no address is found at all, we shouldn't really be here due to AuthGuard,
  // but we'll show a fallback just in case.
  if (!walletAddress) {
    return (
      <div className="max-w-md mx-auto text-center p-8">
        <Card className="p-6">
          <p className="text-muted-foreground">Initializing wallet...</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>Reload App</Button>
        </Card>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            Swap AVAX → USDC
          </Button>

          <Button
            onClick={() => setActiveAction('supply')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            Add to Savings
          </Button>

          <Button
            onClick={() => setActiveAction('withdraw')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <Minus className="h-4 w-4" />
            Withdraw Savings
          </Button>

          <Button
            onClick={() => setActiveAction('borrow')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <TrendingDown className="h-4 w-4" />
            Take a Loan
          </Button>

          <Button
            onClick={() => setActiveAction('repay')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <TrendingUp className="h-4 w-4" />
            Repay Loan
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
