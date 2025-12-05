import { useAccount, useDisconnect, useReadContract } from 'wagmi';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet, LogOut, ArrowDownUp, Plus, Minus, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { ActionModal } from '@/components/ActionModal';
import { WalletConnect } from '@/components/WalletConnect';
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CONTRACTS, AAVE_DATA_PROVIDER_ABI } from '@/config/contracts';
import { formatUnits } from 'viem';

export function SimpleDashboard() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { avaxBalance, usdcBalance, usdcEBalance, needsMigration, isLoading: balanceLoading } = useWalletBalances();
  const positions = useAavePositions();
  const queryClient = useQueryClient();
  
  const [activeAction, setActiveAction] = useState<'swap' | 'supply' | 'withdraw' | 'borrow' | 'repay' | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Direct test read of WAVAX reserve data to debug
  const { data: directWavaxData, error: directWavaxError } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: AAVE_DATA_PROVIDER_ABI,
    functionName: 'getUserReserveData',
    args: address ? [CONTRACTS.WAVAX as `0x${string}`, address] : undefined,
    query: {
      enabled: isConnected && !!address,
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

  if (!isConnected) {
    return (
      <div className="max-w-md mx-auto">
        <WalletConnect />
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
            Connected Wallet
          </h3>
          <Button variant="outline" onClick={handleDisconnect}>
            <LogOut className="h-4 w-4 mr-2" />
            Disconnect
          </Button>
        </div>
        <div className="space-y-2">
          <p className="text-sm text-gray-600">Address</p>
          <p className="font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</p>
        </div>
      </Card>

      {/* Balances */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Your Balances</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <p className="font-medium text-blue-500">AVAX</p>
            <p className="text-2xl font-bold">{balanceLoading ? '...' : (avaxBalance ? parseFloat(avaxBalance).toFixed(4) : '0.0000')}</p>
            <p className="text-sm text-gray-600">In Wallet</p>
          </div>
          <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
            <p className="font-medium text-green-500">USDC (Native)</p>
            <p className="text-2xl font-bold">{balanceLoading ? '...' : parseFloat(usdcBalance).toFixed(2)}</p>
            <p className="text-sm text-gray-600">In Wallet</p>
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
          <h3 className="text-lg font-semibold">Your Aave Positions</h3>
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
            <p className="font-medium text-green-500">USDC Supplied</p>
            <p className="text-2xl font-bold">{parseFloat(positions.usdcSupply).toFixed(2)}</p>
            <p className="text-sm text-gray-600">Earn {(positions.usdcSupplyApy || 3.14).toFixed(2)}% APY</p>
          </div>
          <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
            <p className="font-medium text-red-500">AVAX Borrowed</p>
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

      {/* Action Buttons */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Actions</h3>
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
            Supply USDC to Aave
          </Button>
          
          <Button 
            onClick={() => setActiveAction('withdraw')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <Minus className="h-4 w-4" />
            Withdraw USDC
          </Button>
          
          <Button 
            onClick={() => setActiveAction('borrow')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <TrendingDown className="h-4 w-4" />
            Borrow AVAX
          </Button>
          
          <Button 
            onClick={() => setActiveAction('repay')}
            className="flex items-center gap-2 h-12"
            variant="outline"
          >
            <TrendingUp className="h-4 w-4" />
            Repay AVAX
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
