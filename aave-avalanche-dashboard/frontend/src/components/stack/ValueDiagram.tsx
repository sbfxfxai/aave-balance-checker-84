import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign, Zap } from 'lucide-react';
import {
  calculatePlatformFeeRate,
  calculateEffectiveFeeRate,
  calculateErgcSavingsPercent,
  isFreeDeposit,
} from '@/lib/fees';

interface ValueDiagramProps {
  aaveAPY: number;
}

interface DepositExample {
  depositAmount: number;
  feeRateWithoutErgc: number;
  feeRateWithErgc: number;
  savingsPercent: number;
  isFree: boolean;
}

const calculateExample = (depositAmount: number): DepositExample => {
  const feeRateWithoutErgc = calculatePlatformFeeRate(depositAmount);
  const feeRateWithErgc = calculateEffectiveFeeRate(depositAmount, true); // Assume user has ERGC
  const isFree = isFreeDeposit(depositAmount, true); // Assume user has ERGC
  const savingsPercent = calculateErgcSavingsPercent(depositAmount, true); // Assume user has ERGC
  
  return {
    depositAmount,
    feeRateWithoutErgc,
    feeRateWithErgc,
    savingsPercent,
    isFree,
  };
};

export function ValueDiagram({ aaveAPY }: ValueDiagramProps) {
  const example10 = calculateExample(10);
  const example100 = calculateExample(100);
  const example1000 = calculateExample(1000);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <Card className="mb-8" id="comparison">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Value Comparison: ERGC Free Deposits
        </CardTitle>
        <CardDescription>
          Hold 100+ ERGC and deposits over $100 are FREE! No platform fees on deposits $100+
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* First Row: $10 and $100 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* $10 Example */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                <h3 className="text-base font-semibold">{formatCurrency(example10.depositAmount)} Deposit</h3>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Without ERGC:</span>
                  <span className="text-lg font-semibold text-muted-foreground">{formatPercent(example10.feeRateWithoutErgc)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-purple-500" />
                    With 100+ ERGC:
                  </span>
                  <span className="text-xl font-bold text-purple-500">
                    {example10.isFree ? 'FREE' : formatPercent(example10.feeRateWithErgc)}
                  </span>
                </div>
                <div className="text-xs text-emerald-600 font-medium text-right">
                  {example10.isFree ? '100% FREE' : `Save ${example10.savingsPercent.toFixed(1)}%`}
                </div>
              </div>
            </div>

            {/* $100 Example */}
            <div className="border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="h-4 w-4 text-emerald-500" />
                <h3 className="text-base font-semibold">{formatCurrency(example100.depositAmount)} Deposit</h3>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Without ERGC:</span>
                  <span className="text-lg font-semibold text-muted-foreground">{formatPercent(example100.feeRateWithoutErgc)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5 text-purple-500" />
                    With 100+ ERGC:
                  </span>
                  <span className="text-xl font-bold text-green-600">
                    {example100.isFree ? 'FREE' : formatPercent(example100.feeRateWithErgc)}
                  </span>
                </div>
                <div className="text-xs text-emerald-600 font-medium text-right">
                  {example100.isFree ? '100% FREE' : `Save ${example100.savingsPercent.toFixed(1)}%`}
                </div>
              </div>
            </div>
          </div>

          {/* Second Row: $1000 */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign className="h-5 w-5 text-emerald-500" />
              <h3 className="text-lg font-semibold">{formatCurrency(example1000.depositAmount)} Deposit</h3>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Without ERGC:</span>
                <span className="text-xl font-semibold text-muted-foreground">{formatPercent(example1000.feeRateWithoutErgc)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-base font-medium flex items-center gap-1">
                  <Zap className="h-4 w-4 text-purple-500" />
                  With 100+ ERGC:
                </span>
                <span className="text-2xl font-bold text-green-600">
                  {example1000.isFree ? 'FREE' : formatPercent(example1000.feeRateWithErgc)}
                </span>
              </div>
              <div className="text-sm text-emerald-600 font-medium text-right">
                {example1000.isFree ? '100% FREE - No platform fees!' : `Save ${example1000.savingsPercent.toFixed(1)}% - Largest savings on bigger deposits!`}
              </div>
            </div>
          </div>

          {/* Key Takeaway */}
          <div id="why-ergc" className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Zap className="h-5 w-5 text-purple-500 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold mb-1">Why Hold 100+ ERGC?</div>
                <div className="text-sm text-muted-foreground">
                  Holding 100+ ERGC ($10) makes deposits over $100 <strong className="text-green-400">completely FREE</strong> - no platform fees! 
                  This creates a strong incentive to buy and hold ERGC tokens.
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

