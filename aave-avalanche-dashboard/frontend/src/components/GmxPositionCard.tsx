import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TrendingUp, TrendingDown, Plus, Minus, Target, RefreshCw, ExternalLink } from 'lucide-react';
import { useGmxPositions, GmxPositionData } from '@/hooks/useGmxPositions';
import { useToast } from '@/hooks/use-toast';

interface GmxPositionCardProps {
  onRefresh?: () => void;
  walletAddress?: string | null;
}

export function GmxPositionCard({ onRefresh, walletAddress }: GmxPositionCardProps) {
  const { positions, isLoading, refetch } = useGmxPositions(walletAddress);
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeModal, setActiveModal] = useState<'deposit' | 'withdraw' | 'tpsl' | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<GmxPositionData | null>(null);
  const [collateralAmount, setCollateralAmount] = useState('');
  const [tpslAmount, setTpslAmount] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetch();
      onRefresh?.();
      toast({ title: 'Positions refreshed' });
    } catch {
      toast({ title: 'Failed to refresh', variant: 'destructive' });
    } finally {
      setIsRefreshing(false);
    }
  };

  const openModal = (type: 'deposit' | 'withdraw' | 'tpsl', position: GmxPositionData) => {
    setSelectedPosition(position);
    setActiveModal(type);
    setCollateralAmount('');
    setTpslAmount('');
    setTriggerPrice('');
  };

  const closeModal = () => {
    setActiveModal(null);
    setSelectedPosition(null);
  };

  const handleAction = () => {
    toast({ title: 'Redirecting to GMX', description: 'This action requires GMX interface' });
    window.open('https://app.gmx.io/#/trade', '_blank');
    closeModal();
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          GMX Positions
        </h3>
        <p className="text-muted-foreground">Loading positions...</p>
      </Card>
    );
  }

  return (
    <>
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            GMX Positions
          </h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="https://app.gmx.io/#/trade" target="_blank" rel="noopener noreferrer" aria-label="Open GMX Trade">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>

        {positions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground mb-4">No open GMX positions</p>
            <Button variant="outline" asChild>
              <Link to="/gmx">Open a Position</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {positions.map((position) => (
              <div
                key={position.id}
                className={position.isLong ? 'p-4 rounded-lg border bg-green-500/5 border-green-500/20' : 'p-4 rounded-lg border bg-red-500/5 border-red-500/20'}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {position.isLong ? (
                      <TrendingUp className="h-5 w-5 text-green-500" />
                    ) : (
                      <TrendingDown className="h-5 w-5 text-red-500" />
                    )}
                    <span className="font-semibold">
                      {position.marketInfo?.name || 'Unknown'} {position.leverage.toFixed(1)}x {position.isLong ? 'Long' : 'Short'}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Size</p>
                    <p className="font-medium">${position.sizeInUsd}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Collateral</p>
                    <p className="font-medium">${position.collateralAmount} USDC</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Entry Price</p>
                    <p className="font-medium">${position.entryPrice}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Leverage</p>
                    <p className="font-medium">{position.leverage.toFixed(2)}x</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openModal('deposit', position)}>
                    <Plus className="h-3 w-3 mr-1" />Deposit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openModal('withdraw', position)}>
                    <Minus className="h-3 w-3 mr-1" />Withdraw
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openModal('tpsl', position)}>
                    <Target className="h-3 w-3 mr-1" />TP/SL
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Dialog open={activeModal === 'deposit'} onOpenChange={() => closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deposit Collateral</DialogTitle>
            <DialogDescription>Add USDC collateral to your {selectedPosition?.marketInfo?.name} position</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="deposit-amount">Amount (USDC)</Label>
              <Input id="deposit-amount" type="number" placeholder="0.00" value={collateralAmount} onChange={(e) => setCollateralAmount(e.target.value)} />
            </div>
            <p className="text-sm text-muted-foreground">Current collateral: ${selectedPosition?.collateralAmount} USDC</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleAction} disabled={!collateralAmount || parseFloat(collateralAmount) <= 0}>Deposit via GMX</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={activeModal === 'withdraw'} onOpenChange={() => closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw Collateral</DialogTitle>
            <DialogDescription>Remove USDC collateral from your {selectedPosition?.marketInfo?.name} position</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="withdraw-amount">Amount (USDC)</Label>
              <Input id="withdraw-amount" type="number" placeholder="0.00" value={collateralAmount} onChange={(e) => setCollateralAmount(e.target.value)} />
            </div>
            <p className="text-sm text-muted-foreground">Current collateral: ${selectedPosition?.collateralAmount} USDC</p>
            <p className="text-xs text-orange-500">Warning: Withdrawing collateral increases leverage risk</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleAction} variant="destructive" disabled={!collateralAmount || parseFloat(collateralAmount) <= 0}>Withdraw via GMX</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={activeModal === 'tpsl'} onOpenChange={() => closeModal()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Take Profit / Stop Loss</DialogTitle>
            <DialogDescription>Create a limit order for your {selectedPosition?.marketInfo?.name} position</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tpsl-amount">Position Size to Close ($)</Label>
              <Input id="tpsl-amount" type="number" placeholder="0.00" value={tpslAmount} onChange={(e) => setTpslAmount(e.target.value)} />
              <p className="text-xs text-muted-foreground">Max: ${selectedPosition?.sizeInUsd}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="trigger-price">Trigger Price ($)</Label>
              <Input id="trigger-price" type="number" placeholder="0.00" value={triggerPrice} onChange={(e) => setTriggerPrice(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Entry: ${selectedPosition?.entryPrice} | {selectedPosition?.isLong ? 'Above = TP, Below = SL' : 'Below = TP, Above = SL'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button onClick={handleAction} disabled={!tpslAmount || !triggerPrice || parseFloat(tpslAmount) <= 0}>Set via GMX</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
