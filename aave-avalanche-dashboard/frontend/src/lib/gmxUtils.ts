import { GmxPositionData } from '@/hooks/useGmxPositions';

// Format position age into human-readable string
export const formatPositionAge = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
};

// Helper functions to calculate derived metrics
export const calculatePositionMetrics = (position: GmxPositionData) => {
  const entryPrice = parseFloat(position.entryPrice || '0');
  const markPrice = parseFloat(position.markPrice || position.entryPrice || '0');
  const sizeUsd = parseFloat(position.sizeInUsd || '0');
  const collateral = parseFloat(position.collateralAmount || '0');
  
  // Calculate unrealized PnL
  let pnl = 0;
  let pnlPercentage = 0;
  
  if (entryPrice > 0 && markPrice > 0 && sizeUsd > 0) {
    const priceDelta = position.isLong 
      ? markPrice - entryPrice 
      : entryPrice - markPrice;
    
    const positionSize = sizeUsd / entryPrice;
    pnl = positionSize * priceDelta;
    pnlPercentage = collateral > 0 ? (pnl / collateral) * 100 : 0;
  }
  
  // Calculate total fees
  const fundingFee = parseFloat(position.fundingFeeAmount || '0');
  const borrowingFee = parseFloat(position.borrowingFeeAmount || '0');
  const positionFee = parseFloat(position.positionFeeAmount || '0');
  const totalFees = fundingFee + borrowingFee + positionFee;
  
  // PnL after fees
  const pnlAfterFees = pnl - totalFees;
  
  // Calculate liquidation price (simplified - GMX has complex calculation)
  // This is approximate - you should use GMX SDK for exact calculation
  let liquidationPrice = 0;
  if (position.leverage && entryPrice > 0 && collateral > 0) {
    const liquidationThreshold = 0.9; // 90% of collateral
    const moveToLiquidation = (collateral * liquidationThreshold) / (sizeUsd / entryPrice);
    
    liquidationPrice = position.isLong
      ? entryPrice - moveToLiquidation
      : entryPrice + moveToLiquidation;
  }
  
  // Health factor (1.0 = at liquidation, higher = safer)
  const healthFactor = liquidationPrice > 0 && markPrice > 0
    ? position.isLong
      ? markPrice / liquidationPrice
      : liquidationPrice / markPrice
    : 999;
  
  // Low collateral warning (if within 20% of liquidation)
  const hasLowCollateral = healthFactor < 1.2;
  
  // Position age
  const positionAge = position.increasedAtTime
    ? formatPositionAge(Date.now() - position.increasedAtTime * 1000)
    : undefined;
  
  return {
    pnl: pnl.toFixed(2),
    pnlPercentage: pnlPercentage.toFixed(2),
    pnlAfterFees: pnlAfterFees.toFixed(2),
    totalFees: totalFees.toFixed(2),
    liquidationPrice: liquidationPrice.toFixed(2),
    healthFactor: healthFactor.toFixed(2),
    hasLowCollateral,
    positionAge,
  };
};

// Color coding for PnL
export const getPnlColor = (pnl: string | number): string => {
  const value = typeof pnl === 'string' ? parseFloat(pnl) : pnl;
  if (value > 0) return 'text-green-500';
  if (value < 0) return 'text-red-500';
  return 'text-gray-500';
};

// Color coding for health factor
export const getHealthFactorColor = (healthFactor: number | string): string => {
  const value = typeof healthFactor === 'string' ? parseFloat(healthFactor) : healthFactor;
  if (value < 1.1) return 'text-red-500';
  if (value < 1.3) return 'text-orange-500';
  if (value < 1.5) return 'text-yellow-500';
  return 'text-green-500';
};

