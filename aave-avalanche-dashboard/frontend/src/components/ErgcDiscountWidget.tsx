import { useState } from 'react';
import { Zap, TrendingDown, Check, Info, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useErgcDiscount } from '@/hooks/useErgcDiscount';
import { ERGC_DISCOUNT } from '@/config/contracts';

interface ErgcDiscountWidgetProps {
  address: `0x${string}` | undefined;
  onPurchaseClick?: () => void;
  compact?: boolean;
}

export function ErgcDiscountWidget({ address, onPurchaseClick, compact = false }: ErgcDiscountWidgetProps) {
  const {
    ergcBalance,
    hasDiscount,
    savingsPerTrade,
    savingsPercent,
    standardFee,
    discountedFee,
    tokensNeeded,
    isLoading,
  } = useErgcDiscount(address);

  const [showDetails, setShowDetails] = useState(false);

  // Calculate potential annual savings (assuming weekly trades)
  const annualSavings = hasDiscount ? (savingsPerTrade * 52 * 30).toFixed(2) : '0'; // $30 AVAX price estimate

  if (isLoading) {
    return (
      <Card className="p-4 bg-muted/50 animate-pulse">
        <div className="h-16"></div>
      </Card>
    );
  }

  // Compact version for deposit modal
  if (compact) {
    return (
      <div className={`rounded-lg p-3 ${hasDiscount ? 'bg-green-500/10 border border-green-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className={`w-4 h-4 ${hasDiscount ? 'text-green-500' : 'text-yellow-500'}`} />
            <span className="text-sm font-medium">
              {hasDiscount ? 'Fee Discount Active!' : 'Save 56% on fees'}
            </span>
          </div>
          {hasDiscount ? (
            <span className="text-xs text-green-500 font-medium">
              {ergcBalance} ERGC
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-yellow-500/50 text-yellow-600 hover:bg-yellow-500/10"
              onClick={onPurchaseClick}
            >
              Get 100 ERGC - $10
            </Button>
          )}
        </div>
        {hasDiscount && (
          <p className="text-xs text-muted-foreground mt-1">
            Paying {discountedFee} AVAX instead of {standardFee} AVAX
          </p>
        )}
      </div>
    );
  }

  // Full widget
  return (
    <Card className="overflow-hidden">
      {/* Status Banner */}
      <div className={`p-4 ${hasDiscount ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/20' : 'bg-gradient-to-r from-yellow-500/20 to-orange-500/20'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${hasDiscount ? 'bg-green-500' : 'bg-yellow-500'}`}>
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold">
                {hasDiscount ? '⚡ Fee Discount Active!' : '💡 Unlock Fee Discounts'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {hasDiscount
                  ? `Saving ${savingsPercent}% on every GMX trade`
                  : `Hold 100+ ERGC to save ${savingsPercent}% on fees`}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{parseFloat(ergcBalance).toFixed(0)}</div>
            <div className="text-xs text-muted-foreground">ERGC Balance</div>
          </div>
        </div>
      </div>

      {/* Fee Comparison */}
      <div className="p-4 border-b border-border/50">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-lg font-bold text-muted-foreground line-through">{standardFee} AVAX</div>
            <div className="text-xs text-muted-foreground">Standard Fee</div>
          </div>
          <div className="flex items-center justify-center">
            <TrendingDown className="w-5 h-5 text-green-500" />
          </div>
          <div>
            <div className="text-lg font-bold text-green-500">{discountedFee} AVAX</div>
            <div className="text-xs text-muted-foreground">With ERGC</div>
          </div>
        </div>
      </div>

      {/* Action Section */}
      <div className="p-4">
        {hasDiscount ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-green-600">
              <Check className="w-4 h-4" />
              <span>Discount automatically applied to all GMX trades</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold">${(savingsPerTrade * 30).toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">Saved per trade</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold">${annualSavings}</div>
                <div className="text-xs text-muted-foreground">Potential yearly savings</div>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="w-3 h-3" />
              <span>Keep 100+ ERGC to maintain your discount</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-green-500" />
                <span>Save ${(savingsPerTrade * 30).toFixed(2)} per transaction</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-green-500" />
                <span>Discount applies to all future trades</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Check className="w-4 h-4 text-green-500" />
                <span>Pays for itself in ~2 trades</span>
              </div>
            </div>
            
            <Button
              className="w-full bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600"
              onClick={onPurchaseClick}
            >
              Buy {tokensNeeded.toFixed(0)} ERGC for ${(tokensNeeded * ERGC_DISCOUNT.PRICE_USD).toFixed(2)}
            </Button>
            
            <a
              href="https://app.uniswap.org/explore/pools/avalanche/0x3c83d0058e9d1652534be264dba75cfcc2e1d48a3ff1d2c3611a194a361a16ee"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/30 hover:bg-purple-500/20 hover:border-purple-500/50 transition-colors text-sm font-medium text-purple-400 hover:text-purple-300"
            >
              <Zap className="h-4 w-4" />
              <span>Get ERGC on Uniswap (AVAX → ERGC)</span>
              <ExternalLink className="h-4 w-4" />
            </a>
            
            <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-2 text-xs text-center">
              <span className="font-medium text-purple-400">Fee Discount:</span> Holding 100+ ERGC = <span className="font-bold text-purple-300">56% discount</span> on TiltVault platform fees
            </div>
            
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showDetails ? 'Hide details' : 'How does this work?'}
            </button>
            
            {showDetails && (
              <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-2">
                <p><strong>EnergyCoin (ERGC)</strong> is TiltVault's utility token that reduces GMX trading fees.</p>
                <p>Hold 100+ ERGC in your wallet to automatically get 56% off all GMX execution fees.</p>
                <p>At $0.10 per token, 100 ERGC costs $10 and saves you ~$6.50 per trade.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
