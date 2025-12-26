import { useAccount, useDisconnect } from 'wagmi';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet, LogOut, TrendingUp, TrendingDown, Wallet2, ArrowUpRight, Shield, Plus, Minus, ArrowDown, Settings, Target, Zap, DollarSign, History, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useAaveRates } from '@/hooks/useAaveRates';
import { SupplyModal } from '@/components/SupplyModal';
import { BorrowModal } from '@/components/BorrowModal';
// Modal components - can be implemented later if needed
const StrategiesModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => null;
const AdvancedFeaturesModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => null;
const UserActivitiesModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => null;
const ExchangeRatesModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => null;
const PositionManagersModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => null;
import { useState } from 'react';

export function WalletInfo() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { avaxBalance, usdcBalance, isLoading: balanceLoading } = useWalletBalances();
  const positions = useAavePositions();
  const { supplyAPY } = useAaveRates();
  const [isSupplyModalOpen, setIsSupplyModalOpen] = useState(false);
  const [isBorrowModalOpen, setIsBorrowModalOpen] = useState(false);
  const [isStrategiesModalOpen, setIsStrategiesModalOpen] = useState(false);
  const [isAdvancedFeaturesModalOpen, setIsAdvancedFeaturesModalOpen] = useState(false);
  const [isUserActivitiesModalOpen, setIsUserActivitiesModalOpen] = useState(false);
  const [isExchangeRatesModalOpen, setIsExchangeRatesModalOpen] = useState(false);
  const [isPositionManagersModalOpen, setIsPositionManagersModalOpen] = useState(false);

  const handleDisconnect = () => {
    disconnect();
    toast.info('Wallet disconnected');
  };

  // Calculate net worth
  const netWorth = positions.totalCollateral ? parseFloat(positions.totalCollateral.replace('$', '') || '0') : 0;
  const availableRewards = 0.16; // Placeholder - should be calculated from actual rewards

  if (!isConnected || !address) return null;

  return (
    <div className="space-y-6">
      {/* Wallet Connection Card */}
      <Card className="p-6 bg-card shadow-card hover:shadow-card-hover transition-all duration-300">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Connected Wallet</p>
              <p className="text-sm font-mono font-semibold text-foreground">
                {address.slice(0, 6)}...{address.slice(-4)}
              </p>
            </div>
          </div>
          <Button
            onClick={handleDisconnect}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            Disconnect
          </Button>
        </div>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6 bg-gradient-primary text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">Net Worth</p>
              <p className="text-3xl font-bold">
                ${netWorth.toFixed(2)}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 opacity-50" />
          </div>
        </Card>

        <Card className="p-6 bg-gradient-primary text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm opacity-90">Available Rewards</p>
              <p className="text-3xl font-bold text-yellow-500">
                ${availableRewards.toFixed(2)}
              </p>
            </div>
            <TrendingUp className="h-8 w-8 opacity-50" />
          </div>
        </Card>
      </div>

      {/* Wallet Balances */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Wallet2 className="h-5 w-5" />
          Wallet Balances
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full bg-orange-500"></div>
              </div>
              <div>
                <p className="font-medium">AVAX</p>
                <p className="text-sm text-muted-foreground">In Wallet</p>
              </div>
            </div>
            <div className="text-right mt-2">
              <p className="font-semibold">{avaxBalance ? parseFloat(avaxBalance).toFixed(4) : '0.0000'}</p>
              <p className="text-sm text-muted-foreground">
                AVAX
              </p>
            </div>
          </div>
          <div className="p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full bg-blue-500"></div>
              </div>
              <div>
                <p className="font-medium">USDC</p>
                <p className="text-sm text-muted-foreground">In Wallet</p>
              </div>
            </div>
            <div className="text-right mt-2">
              <p className="font-semibold">{usdcBalance ? parseFloat(usdcBalance).toFixed(2) : '0.00'}</p>
              <p className="text-sm text-muted-foreground">
                ${usdcBalance ? parseFloat(usdcBalance).toFixed(2) : '0.00'}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Aave Positions */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Aave Positions
        </h3>
        <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
              <TrendingDown className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <p className="font-medium text-red-500">AVAX Borrowed</p>
              <p className="text-sm text-muted-foreground">Cost {positions.avaxBorrowApy}% APY</p>
            </div>
          </div>
          <div className="text-right mt-2">
            <p className="font-semibold text-red-500">
              {parseFloat(positions.avaxBorrowed || '0').toFixed(4)} AVAX
            </p>
            <p className="text-sm text-muted-foreground">
              Borrowed
            </p>
          </div>
        </div>
      </Card>

      {/* User Activities */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <History className="h-5 w-5" />
          User Activities
        </h3>
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-purple-500">Transaction History</p>
                <p className="text-sm text-muted-foreground">View all your Aave activities</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supplies, borrows, repayments, withdrawals, and more
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setIsUserActivitiesModalOpen(true)}
                className="flex items-center gap-1"
              >
                <History className="h-3 w-3" />
                Activities
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Exchange Rates */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <ArrowUpDown className="h-5 w-5" />
          Exchange Rates
        </h3>
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-orange-500">Live Exchange Rates</p>
                <p className="text-sm text-muted-foreground">Real-time token prices & conversions</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Chainlink oracle feeds • Auto-refresh
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setIsExchangeRatesModalOpen(true)}
                className="flex items-center gap-1"
              >
                <ArrowUpDown className="h-3 w-3" />
                Rates
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Supply/Withdraw Actions */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Wallet2 className="h-5 w-5" />
          Supply & Withdraw
        </h3>
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-green-500">USDC Supply</p>
                <p className="text-sm text-muted-foreground">Earn {positions.usdcSupplyApy}% APY</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supplied: {parseFloat(positions.usdcSupply).toFixed(2)} USDC
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsSupplyModalOpen(true)}
                  className="flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" />
                  Supply
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsSupplyModalOpen(true)}
                  className="flex items-center gap-1"
                >
                  <Minus className="h-3 w-3" />
                  Withdraw
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* DeFi Strategies */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Target className="h-5 w-5" />
          DeFi Strategies
        </h3>
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-green-500">Active Strategy</p>
                <p className="text-sm text-muted-foreground">Balanced Growth ({supplyAPY.toFixed(2)}% APY)</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Auto-rebalancing enabled • Target HF: 2.2
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setIsStrategiesModalOpen(true)}
                className="flex items-center gap-1"
              >
                <Target className="h-3 w-3" />
                Configure
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Advanced Features */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Advanced Features
        </h3>
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-red-500">Risk Premium Update</p>
                <p className="text-sm text-muted-foreground">Reduce borrow rates by 25%</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Eligible for optimization
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setIsAdvancedFeaturesModalOpen(true)}
                className="flex items-center gap-1"
              >
                <Zap className="h-3 w-3" />
                Advanced
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Assets to Borrow */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <ArrowUpRight className="h-5 w-5" />
          Assets to Borrow
        </h3>
        
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <p className="text-sm text-blue-700">
            <strong>Total Available to Borrow:</strong> {positions.availableBorrow || '$0.00'}
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-orange-500/10 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full bg-orange-500"></div>
              </div>
              <div>
                <p className="font-medium">AVAX</p>
                <p className="text-sm text-muted-foreground">APY, variable</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-semibold">
                {positions.avaxAvailableToBorrow ? positions.avaxAvailableToBorrow.toFixed(6) : '0.000000'} AVAX
              </p>
              <p className="text-sm text-muted-foreground">
                Available
              </p>
              <p className="text-sm text-green-500">{positions.avaxBorrowApy}% APY</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsBorrowModalOpen(true)}
                className="mt-2 flex items-center gap-1"
              >
                <ArrowDown className="h-3 w-3" />
                Borrow
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                <div className="w-4 h-4 rounded-full bg-blue-500"></div>
              </div>
              <div>
                <p className="font-medium">USDC</p>
                <p className="text-sm text-muted-foreground">APY, variable</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-semibold">
                ${positions.usdcAvailableToBorrow ? positions.usdcAvailableToBorrow.toFixed(2) : '0.00'} USDC
              </p>
              <p className="text-sm text-muted-foreground">
                Available
              </p>
              <p className="text-sm text-green-500">{positions.usdcBorrowApy}% APY</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsBorrowModalOpen(true)}
                className="mt-2 flex items-center gap-1"
              >
                <ArrowDown className="h-3 w-3" />
                Borrow
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <p className="text-sm text-yellow-700">
            <strong>E-Mode:</strong> In E-Mode some assets are not borrowable. Exit E-Mode to get access to all assets
          </p>
        </div>
      </Card>
      
      {/* Supply Modal */}
      <SupplyModal 
        isOpen={isSupplyModalOpen} 
        onClose={() => setIsSupplyModalOpen(false)} 
      />
      
      {/* Borrow Modal */}
      <BorrowModal 
        isOpen={isBorrowModalOpen} 
        onClose={() => setIsBorrowModalOpen(false)} 
      />
      
      {/* Position Managers Modal */}
      <PositionManagersModal 
        isOpen={isPositionManagersModalOpen} 
        onClose={() => setIsPositionManagersModalOpen(false)} 
      />
      
      {/* Strategies Modal */}
      <StrategiesModal 
        isOpen={isStrategiesModalOpen} 
        onClose={() => setIsStrategiesModalOpen(false)} 
      />
      
      {/* Advanced Features Modal */}
      <AdvancedFeaturesModal 
        isOpen={isAdvancedFeaturesModalOpen} 
        onClose={() => setIsAdvancedFeaturesModalOpen(false)} 
      />
      
      {/* User Activities Modal */}
      <UserActivitiesModal 
        isOpen={isUserActivitiesModalOpen} 
        onClose={() => setIsUserActivitiesModalOpen(false)} 
      />
      
      {/* Exchange Rates Modal */}
      <ExchangeRatesModal 
        isOpen={isExchangeRatesModalOpen} 
        onClose={() => setIsExchangeRatesModalOpen(false)} 
      />
    </div>
  );
}
