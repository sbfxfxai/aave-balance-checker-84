import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TrendingUp, TrendingDown, Plus, Minus, Target, RefreshCw, ExternalLink, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useGmxPositions, GmxPositionData } from '@/hooks/useGmxPositions';
import { useToast } from '@/hooks/use-toast';
import { calculatePositionMetrics, getPnlColor, getHealthFactorColor } from '@/lib/gmxUtils';

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
  const [expandedPositions, setExpandedPositions] = useState<Set<string>>(new Set());

  const toggleExpanded = (positionId: string) => {
    setExpandedPositions(prev => {
      const next = new Set(prev);
      if (next.has(positionId)) {
        next.delete(positionId);
      } else {
        next.add(positionId);
      }
      return next;
    });
  };

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
                        {positions.length > 0 && (
                          <Badge variant="secondary">{positions.length}</Badge>
                        )}
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
            {positions.map((position) => {
              const metrics = calculatePositionMetrics(position);
              const isExpanded = expandedPositions.has(position.id);
              const pnlValue = parseFloat(metrics.pnl || '0');
              
              return (
                <div
                  key={position.id}
                  className={`rounded-lg border ${
                    position.isLong 
                      ? 'bg-green-500/5 border-green-500/20' 
                      : 'bg-red-500/5 border-red-500/20'
                  }`}
                >
                  {/* Header - Always Visible */}
                  <div className="p-4">
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
                        {metrics.hasLowCollateral && (
                          <Badge variant="destructive" className="text-xs">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Low Collateral
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpanded(position.id)}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {/* Key Metrics - Always Visible */}
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Position</p>
                        <p className="font-medium">
                          {position.marketInfo?.name || 'Unknown'} {position.isLong ? 'Long' : 'Short'}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Size</p>
                        <p className="font-medium">${position.sizeInUsd}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">PnL</p>
                        <p className={`font-medium ${getPnlColor(metrics.pnl)}`}>
                          ${metrics.pnl} ({pnlValue > 0 ? '+' : ''}{metrics.pnlPercentage}%)
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Net Value</p>
                        <p className={`font-medium ${getPnlColor(parseFloat(position.netValue || position.collateralAmount) - parseFloat(position.collateralAmount))}`}>
                          ${position.netValue || position.collateralAmount}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Mark Price</p>
                        <p className="font-medium">${parseFloat(position.markPrice || position.entryPrice).toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Collateral</p>
                        <p className="font-medium">${position.collateralAmount}</p>
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t space-y-4">
                        {/* Price Details */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
                            <Info className="h-4 w-4" />
                            Price Details
                          </h4>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                            <div>
                              <p className="text-muted-foreground">Entry Price</p>
                              <p className="font-mono">${parseFloat(position.entryPrice || '0').toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Mark Price</p>
                              <p className="font-mono">${parseFloat(position.markPrice || position.entryPrice).toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Liquidation Price</p>
                              <p className={`font-mono ${getHealthFactorColor(parseFloat(metrics.healthFactor))}`}>
                                ${metrics.liquidationPrice}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* PnL Breakdown */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2">PnL Breakdown</h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <p className="text-muted-foreground">Unrealized PnL</p>
                              <p className={`font-mono ${getPnlColor(metrics.pnl)}`}>${metrics.pnl}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Total Fees</p>
                              <p className="font-mono text-red-500">-${metrics.totalFees}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Net PnL</p>
                              <p className={`font-mono font-semibold ${getPnlColor(metrics.pnlAfterFees)}`}>
                                ${metrics.pnlAfterFees}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">ROI</p>
                              <p className={`font-mono ${getPnlColor(metrics.pnlPercentage)}`}>
                                {parseFloat(metrics.pnlPercentage) > 0 ? '+' : ''}{metrics.pnlPercentage}%
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Fee Breakdown */}
                        {(position.fundingFeeAmount || position.borrowingFeeAmount || position.claimableFundingAmount) && (
                          <div>
                            <h4 className="text-sm font-semibold mb-2">Fee Breakdown</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                              {position.fundingFeeAmount && (
                                <div>
                                  <p className="text-muted-foreground">Funding Fees</p>
                                  <p className="font-mono">${parseFloat(position.fundingFeeAmount).toFixed(2)}</p>
                                </div>
                              )}
                              {position.claimableFundingAmount && (
                                <div>
                                  <p className="text-muted-foreground">Claimable Funding</p>
                                  <p className="font-mono text-green-500">${parseFloat(position.claimableFundingAmount).toFixed(2)}</p>
                                </div>
                              )}
                              {position.borrowingFeeAmount && (
                                <div>
                                  <p className="text-muted-foreground">Borrowing Fees</p>
                                  <p className="font-mono">${parseFloat(position.borrowingFeeAmount).toFixed(2)}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Risk Metrics */}
                        <div>
                          <h4 className="text-sm font-semibold mb-2">Risk Metrics</h4>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                            <div>
                              <p className="text-muted-foreground">Leverage</p>
                              <p className="font-mono">{position.leverage.toFixed(2)}x</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Health Factor</p>
                              <p className={`font-mono ${getHealthFactorColor(parseFloat(metrics.healthFactor))}`}>
                                {metrics.healthFactor}
                              </p>
                            </div>
                            {metrics.positionAge && (
                              <div>
                                <p className="text-muted-foreground">Position Age</p>
                                <p className="font-mono">{metrics.positionAge}</p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Quick Actions */}
                        <div className="flex flex-wrap gap-2 pt-2">
                          <Button size="sm" variant="outline" onClick={() => openModal('deposit', position)}>
                            <Plus className="h-3 w-3 mr-1" />Deposit
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openModal('withdraw', position)}>
                            <Minus className="h-3 w-3 mr-1" />Withdraw
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openModal('tpsl', position)}>
                            <Target className="h-3 w-3 mr-1" />TP/SL
                          </Button>
                          <Button 
                            size="sm" 
                            variant="outline"
                            className="ml-auto"
                            asChild
                          >
                            <a 
                              href="https://app.gmx.io/#/trade" 
                              target="_blank" 
                              rel="noopener noreferrer"
                            >
                              Manage on GMX
                              <ExternalLink className="h-3 w-3 ml-2" />
                            </a>
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Collapsed Actions */}
                    {!isExpanded && (
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
                    )}
                  </div>
                </div>
              );
            })}
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
