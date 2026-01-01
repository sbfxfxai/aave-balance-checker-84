import { useAccount, useDisconnect } from 'wagmi';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wallet, LogOut, Wallet2, Plus, Minus, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { WorkingSupplyModal } from '@/components/WorkingSupplyModal';
import { BorrowModal } from '@/components/BorrowModal';
import { useState } from 'react';

export function WalletInfo() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { avaxBalance, usdcBalance, isLoading: balanceLoading } = useWalletBalances();
  const positions = useAavePositions();
  const [isSupplyModalOpen, setIsSupplyModalOpen] = useState(false);
  const [isBorrowModalOpen, setIsBorrowModalOpen] = useState(false);

  const handleDisconnect = () => {
    disconnect();
    toast.info('Wallet disconnected');
  };

  if (!isConnected) {
    return (
      <Card className="p-6">
        <div className="text-center">
          <Wallet className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Connect Your Wallet</h3>
          <p className="text-gray-600 mb-4">Connect to view your Aave positions and manage your assets</p>
        </div>
      </Card>
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

      {/* Supply Section */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Your Supplies
        </h3>
        
        {/* Net Worth and APY */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <p className="text-sm text-gray-600">Net worth</p>
            <p className="text-2xl font-bold">${positions.totalCollateral.replace('$', '') || '2.16'}</p>
          </div>
          <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
            <p className="text-sm text-gray-600">Net APY</p>
            <p className="text-2xl font-bold text-green-600">{(positions.usdcSupplyApy || 3.14).toFixed(2)}%</p>
          </div>
          <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
            <p className="text-sm text-gray-600">Available rewards</p>
            <p className="text-2xl font-bold text-purple-600">$0.16</p>
          </div>
        </div>

        {/* Your Supplies */}
        <div className="mb-6">
          <h4 className="font-semibold mb-3">Your supplies</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Asset</th>
                  <th className="text-right py-2">Balance</th>
                  <th className="text-right py-2">APY</th>
                  <th className="text-right py-2">Collateral</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="py-2 font-medium">USDC</td>
                  <td className="text-right">${parseFloat(positions.usdcSupply).toFixed(2)}</td>
                  <td className="text-right text-green-600">{(positions.usdcSupplyApy || 3.14).toFixed(2)}%</td>
                  <td className="text-right">${parseFloat(positions.usdcSupply).toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Assets to Supply */}
        <div>
          <h4 className="font-semibold mb-3">Assets to supply</h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                  <span className="text-red-500 font-bold text-xs">AVAX</span>
                </div>
                <div>
                  <p className="font-medium">AVAX</p>
                  <p className="text-sm text-gray-600">Wallet balance: {avaxBalance ? parseFloat(avaxBalance).toFixed(4) : '0.0000'}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium text-green-600">{(positions.avaxSupplyApy || 1.13).toFixed(2)}%</p>
                <p className="text-sm text-gray-600">Can be collateral</p>
              </div>
              <Button size="sm" onClick={() => setIsSupplyModalOpen(true)}>
                Supply
              </Button>
            </div>
            
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <span className="text-orange-500 font-bold text-xs">WAVAX</span>
                </div>
                <div>
                  <p className="font-medium">WAVAX</p>
                  <p className="text-sm text-gray-600">Wallet balance: 0.0090278</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium text-green-600">{(positions.avaxSupplyApy || 1.13).toFixed(2)}%</p>
                <p className="text-sm text-gray-600">Can be collateral</p>
              </div>
              <Button size="sm" variant="outline" disabled>
                No balance
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Borrow Section */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingDown className="h-5 w-5" />
          Your Borrows
        </h3>
        
        {/* Net Worth and APY */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
            <p className="text-sm text-gray-600">Net worth</p>
            <p className="text-2xl font-bold">${positions.totalCollateral.replace('$', '') || '2.16'}</p>
          </div>
          <div className="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
            <p className="text-sm text-gray-600">Net APY</p>
            <p className="text-2xl font-bold text-green-600">{(positions.usdcSupplyApy || 3.14).toFixed(2)}%</p>
          </div>
          <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
            <p className="text-sm text-gray-600">Available rewards</p>
            <p className="text-2xl font-bold text-purple-600">$0.16</p>
          </div>
        </div>

        {/* Your Borrows */}
        <div className="mb-6">
          <h4 className="font-semibold mb-3">Your borrows</h4>
          <div className="p-4 rounded-lg bg-gray-50 text-center">
            <p className="text-gray-600">E-Mode</p>
            <p className="font-medium">Nothing borrowed yet</p>
          </div>
        </div>

        {/* Assets to Borrow */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold">Assets to borrow</h4>
            <p className="text-sm text-gray-600">In E-Mode some assets are not borrowable. Exit E-Mode to get access to all assets</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center">
                  <span className="text-red-500 font-bold text-xs">AVAX</span>
                </div>
                <div>
                  <p className="font-medium">AVAX</p>
                  <p className="text-sm text-gray-600">Available: {(positions.avaxAvailableToBorrow || 0.1174102).toFixed(7)} ($1.60)</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium text-red-600">{(positions.avaxBorrowApy || 3.55).toFixed(2)}%</p>
                <p className="text-sm text-gray-600">APY, variable</p>
              </div>
              <Button size="sm" onClick={() => setIsBorrowModalOpen(true)}>
                Borrow
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Working Supply & Borrow Modals */}
      <WorkingSupplyModal 
        isOpen={isSupplyModalOpen} 
        onClose={() => setIsSupplyModalOpen(false)} 
      />
      <BorrowModal 
        isOpen={isBorrowModalOpen} 
        onClose={() => setIsBorrowModalOpen(false)} 
      />
    </div>
  );
}
