import { useAccount, useBalance } from 'wagmi';
import { avalanche } from 'wagmi/chains';
import { useWalletBalances } from './useWalletBalances';
import { useAavePositions } from './useAavePositions';

export interface ExtendedUserBalance {
  // Wallet balances
  avaxBalance: string;
  usdcBalance: string;
  avaxSymbol: string;
  usdcSymbol: string;
  
  // Aave positions
  totalCollateral: string;
  totalDebt: string;
  availableBorrow: string;
  usdcSupply: string;
  usdcBorrowed: string;
  avaxSupply: string;
  avaxBorrowed: string;
  healthFactor: number | null;
  
  // APYs
  usdcSupplyApy: number;
  avaxSupplyApy: number;
  usdcBorrowApy: number;
  avaxBorrowApy: number;
  
  // Available amounts
  avaxAvailableToBorrow: number;
  usdcAvailableToBorrow: number;
  
  // Loading states
  isLoading: boolean;
}

export const useUserBalancesExtended = (): ExtendedUserBalance => {
  const walletBalances = useWalletBalances();
  const aavePositions = useAavePositions();

  return {
    // Wallet balances with fallbacks
    avaxBalance: walletBalances.avaxBalance || '0',
    usdcBalance: walletBalances.usdcBalance || '0',
    avaxSymbol: walletBalances.avaxSymbol || 'AVAX',
    usdcSymbol: walletBalances.usdcSymbol || 'USDC.e',
    
    // Aave positions with fallbacks
    totalCollateral: aavePositions.totalCollateral || '$0.00',
    totalDebt: aavePositions.totalDebt || '$0.00',
    availableBorrow: aavePositions.availableBorrow || '$0.00',
    usdcSupply: aavePositions.usdcSupply || '0',
    usdcBorrowed: aavePositions.usdcBorrowed || '0',
    avaxSupply: aavePositions.avaxSupply || '0',
    avaxBorrowed: aavePositions.avaxBorrowed || '0',
    healthFactor: aavePositions.healthFactor,
    
    // APYs with fallbacks
    usdcSupplyApy: aavePositions.usdcSupplyApy || 0,
    avaxSupplyApy: aavePositions.avaxSupplyApy || 0,
    usdcBorrowApy: aavePositions.usdcBorrowApy || 0,
    avaxBorrowApy: aavePositions.avaxBorrowApy || 0,
    
    // Available amounts with fallbacks
    avaxAvailableToBorrow: aavePositions.avaxAvailableToBorrow || 0,
    usdcAvailableToBorrow: aavePositions.usdcAvailableToBorrow || 0,
    
    // Combined loading state
    isLoading: walletBalances.isLoading || aavePositions.isLoading,
  };
};