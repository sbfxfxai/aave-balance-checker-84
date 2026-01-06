import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign, Zap } from 'lucide-react';

interface ValueDiagramProps {
  aaveAPY: number;
}

// Fee calculation functions (matching DepositModal logic)
const getPlatformFeeRate = (depositAmount: number) => {
  if (depositAmount >= 1000) return 0.033; // 3.3%
  if (depositAmount >= 100) return 0.042; // 4.2%
  if (depositAmount >= 50) return 0.055; // 5.5%
  if (depositAmount >= 20) return 0.074; // 7.4%
  return 0.074; // Default 7.4% for amounts < $20
};

const getErgcDiscountRate = (depositAmount: number) => {
  if (depositAmount >= 1000) return 0.031; // 3.1%
  if (depositAmount >= 100) return 0.04; // 4.0%
  if (depositAmount >= 50) return 0.045; // 4.5%
  if (depositAmount >= 20) return 0.055; // 5.5%
  return 0.055; // 5.5% for amounts < $20
};

interface DepositExample {
  depositAmount: number;
  feeWithoutErgc: number;
  feeWithErgc: number;
  savings: number;
  netDepositWithoutErgc: number;
  netDepositWithErgc: number;
  oneYearBalanceWithoutErgc: number;
  oneYearBalanceWithErgc: number;
  totalSavings: number;
}

const calculateExample = (depositAmount: number, aaveAPY: number): DepositExample => {
  const feeRateWithoutErgc = getPlatformFeeRate(depositAmount);
  const feeRateWithErgc = getErgcDiscountRate(depositAmount);
  
  const feeWithoutErgc = depositAmount * feeRateWithoutErgc;
  const feeWithErgc = depositAmount * feeRateWithErgc;
  const savings = feeWithoutErgc - feeWithErgc;
  
  const netDepositWithoutErgc = depositAmount - feeWithoutErgc;
  const netDepositWithErgc = depositAmount - feeWithErgc;
  
  // Calculate 1 year balance: net deposit * (1 + APY)
  const oneYearBalanceWithoutErgc = netDepositWithoutErgc * (1 + aaveAPY / 100);
  const oneYearBalanceWithErgc = netDepositWithErgc * (1 + aaveAPY / 100);
  
  // Total savings = initial savings + additional interest on savings
  const totalSavings = savings + (savings * aaveAPY / 100);
  
  return {
    depositAmount,
    feeWithoutErgc,
    feeWithErgc,
    savings,
    netDepositWithoutErgc,
    netDepositWithErgc,
    oneYearBalanceWithoutErgc,
    oneYearBalanceWithErgc,
    totalSavings,
  };
};

export function ValueDiagram({ aaveAPY }: ValueDiagramProps) {
  const example1000 = calculateExample(1000, aaveAPY);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Value Comparison: ERGC Savings Impact
        </CardTitle>
        <CardDescription>
          See how holding 100+ ERGC saves you money on fees and increases your 1-year returns
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* $1000 Example */}
          <div className="border rounded-lg p-4 bg-muted/30">
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="h-5 w-5 text-emerald-500" />
              <h3 className="text-lg font-semibold">$1,000 Deposit Example</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Deposit Amount */}
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">Deposit Amount</div>
                <div className="text-2xl font-bold">{formatCurrency(example1000.depositAmount)}</div>
              </div>
              
              {/* ERGC Savings */}
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5 text-purple-500" />
                  ERGC Savings
                </div>
                <div className="text-2xl font-bold text-purple-500">
                  {formatPercent(example1000.feeWithoutErgc / example1000.depositAmount)} → {formatPercent(example1000.feeWithErgc / example1000.depositAmount)}
                </div>
                <div className="text-xs text-muted-foreground">
                  Fee rate with 100+ ERGC
                </div>
              </div>
              
              {/* 1 Year Balance */}
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">1 Year Balance</div>
                <div className="space-y-1">
                  <div className="text-lg font-semibold text-muted-foreground line-through">
                    {formatCurrency(example1000.oneYearBalanceWithoutErgc)}
                  </div>
                  <div className="text-2xl font-bold text-emerald-500">
                    {formatCurrency(example1000.oneYearBalanceWithErgc)}
                  </div>
                  <div className="text-xs text-emerald-600 font-medium">
                    +{formatCurrency(example1000.totalSavings)} total savings
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Key Takeaway */}
          <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Zap className="h-5 w-5 text-purple-500 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold mb-1">Why Hold 100+ ERGC?</div>
                <div className="text-sm text-muted-foreground">
                  Holding 100+ ERGC ($10) gives you a <strong className="text-purple-400">56% discount</strong> on platform fees. 
                  On a $1,000 deposit, you save ${example1000.savings.toFixed(2)} immediately, plus earn additional interest on those savings over time. 
                  The larger your deposits, the more you save!
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

