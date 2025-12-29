import { useAccount, useDisconnect, useReadContract } from 'wagmi';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet, LogOut, ArrowDownUp, Plus, Minus, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { ActionModal } from '@/components/ActionModal';
import { WalletConnect } from '@/components/WalletConnect';
import { GmxPositionCard } from '@/components/GmxPositionCard';
import { useState, useEffect } from 'react';
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
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { avaxBalance, usdcBalance, usdcEBalance, needsMigration, isLoading: balanceLoading } = useWalletBalances();
  const positions = useAavePositions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  
  const [activeAction, setActiveAction] = useState<'swap' | 'supply' | 'withdraw' | 'borrow' | 'repay' | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showWalletConnect, setShowWalletConnect] = useState(false);
  
  // Check for direct wallet connection
  const directWalletAddress = (window as TiltVaultWindow).tiltvaultWallet?.address;
  
  // Safety check - ensure address exists before rendering
  const walletAddress = address || directWalletAddress;
  
  // Direct test read of WAVAX reserve data to debug
  // Only enable when we have all required args to prevent ABI encoding errors
  const hasRequiredArgs = !!(walletAddress && CONTRACTS.WAVAX);
  const { data: directWavaxData, error: directWavaxError } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: hasRequiredArgs ? [CONTRACTS.WAVAX as `0x${string}`, walletAddress as `0x${string}`] : undefined,
    query: {
      enabled: Boolean((isConnected || directWalletAddress) && hasRequiredArgs),
    },
  });
  
  // Log direct read for debugging
  useEffect(() => {
    if (directWavaxData) {
      console.log('[SimpleDashboard] DIRECT WAVAX read:', {
        raw: directWavaxData,
        isArray: Array.isArray(directWavaxData),
        length: Array.isArray(directWavaxData) ? directWavaxData.length : 'N/A',
      });
      if (Array.isArray(directWavaxData) && directWavaxData.length >= 3) {
        const stableDebt = directWavaxData[1] as bigint;
        const variableDebt = directWavaxData[2] as bigint;
        const totalDebt = stableDebt + variableDebt;
        console.log('[SimpleDashboard] DIRECT calculated debt:', {
          stableDebt: formatUnits(stableDebt, 18),
          variableDebt: formatUnits(variableDebt, 18),
          totalDebt: formatUnits(totalDebt, 18),
        });
      }
    }
    if (directWavaxError) {
      console.error('[SimpleDashboard] DIRECT WAVAX read error:', directWavaxError);
    }
  }, [directWavaxData, directWavaxError]);
  
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Invalidate all queries
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
      queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
      queryClient.invalidateQueries({ queryKey: ['readContract'], exact: false });
      
      // Explicitly refetch positions if refetch function is available
      if ('refetch' in positions && positions.refetch) {
        await positions.refetch();
      }
      
      toast.success('Positions refreshed!');
    } catch (error) {
      toast.error('Failed to refresh positions');
      console.error('Refresh error:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    toast.info('Wallet disconnected');
  };

  // If not connected, show a simple three-button landing
  if (!isConnected && !directWalletAddress) {
    if (showWalletConnect) {
      return (
        <div className="max-w-md mx-auto">
          <Card className="p-6">
            <Button
              variant="ghost"
              onClick={() => setShowWalletConnect(false)}
              className="mb-4"
            >
              ← Back
            </Button>
            <WalletConnect />
          </Card>
        </div>
      );
    }

    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Card className="p-8">
          <div className="text-center space-y-3">
            <h2 className="text-2xl font-bold">Welcome to TiltVault Banking</h2>
            <p className="text-muted-foreground">
              Choose how you want to get started. You can connect MetaMask directly or jump to Auto to deposit, invest, and withdraw.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
            <Button 
              variant="secondary" 
              className="w-full"
              onClick={() => setShowWalletConnect(true)}
            >
              Connect Wallet
            </Button>
            <Button asChild className="w-full">
              <a
                href="https://link.metamask.io/swap?amount=32600000000000000&from=eip155%3A1%2Fslip44%3A60&sig_params=amount%2Cfrom&sig=lcKWbD9emSvYcSy4wKZAAZK4IusikSldKuh2SLobJnCxX6_H50c7o4lrxGukMkQAlJXl_Ro-z9GOFjHlijuUSQ&attributionId=664f89ab-3a22-4f57-adff-002a5071ff39&utm_source=www.google.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open MetaMask
              </a>
            </Button>
            <Button 
              variant="outline" 
              className="w-full"
              onClick={() => navigate('/stack')}
            >
              Deposit / Invest / Withdraw
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // If we have direct wallet but not wagmi, show connecting state
  if (!isConnected && directWalletAddress) {
    const tiltWindow = window as TiltVaultWindow;
    return (
      <div className="max-w-md mx-auto">
        <Card className="p-6">
          <div className="text-center">
            <p className="text-muted-foreground">Connecting wallet...</p>
            <p className="text-xs text-muted-foreground mt-2">
              Address: {tiltWindow.tiltvaultWallet?.address?.slice(0, 6)}...{tiltWindow.tiltvaultWallet?.address?.slice(-4)}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  if (!walletAddress) {
    return (
      <div className="max-w-md mx-auto">
        <Card className="p-6">
          <div className="text-center">
            <p className="text-muted-foreground">Connecting wallet...</p>
          </div>
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
            Disconnect
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-gray-600">Address</p>
          <p className="font-mono">{walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}</p>
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
                ⚠️ You have {parseFloat(usdcEBalance).toFixed(2)} USDC.e - swap to native USDC for Aave V3
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
            <p className="text-sm text-gray-600">Earning {(positions.usdcSupplyApy || 3.14).toFixed(2)}% APY</p>
          </div>
          <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
            <p className="font-medium text-red-500">Loan Balance</p>
            <p className="text-2xl font-bold">{parseFloat(positions.avaxBorrowed || '0').toFixed(4)}</p>
            <p className="text-sm text-gray-600">Pay {(positions.avaxBorrowApy || 3.55).toFixed(2)}% APY</p>
            {/* Debug info - remove in production */}
            {process.env.NODE_ENV === 'development' && (
              <p className="text-xs text-gray-400 mt-1">
                Raw: {positions.avaxBorrowed || '0'} | Loading: {positions.isLoading ? 'Yes' : 'No'}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* GMX Positions */}
      <GmxPositionCard walletAddress={address} onRefresh={handleRefresh} />

      {/* Action Buttons */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
