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
    availableBorrow: ('availableBorrow' in aavePositions ? aavePositions.availableBorrow : null) || '$0.00',
    usdcSupply: aavePositions.usdcSupply || '0',
    usdcBorrowed: ('usdcBorrowed' in aavePositions ? aavePositions.usdcBorrowed : null) || '0',
    avaxSupply: ('avaxSupply' in aavePositions ? aavePositions.avaxSupply : null) || '0',
    avaxBorrowed: ('avaxBorrowed' in aavePositions ? aavePositions.avaxBorrowed : null) || '0',
    healthFactor: aavePositions.healthFactor,
    
    // APYs with fallbacks
    usdcSupplyApy: ('usdcSupplyApy' in aavePositions ? aavePositions.usdcSupplyApy : null) || 0,
    avaxSupplyApy: ('avaxSupplyApy' in aavePositions ? aavePositions.avaxSupplyApy : null) || 0,
    usdcBorrowApy: ('usdcBorrowApy' in aavePositions ? aavePositions.usdcBorrowApy : null) || 0,
    avaxBorrowApy: ('avaxBorrowApy' in aavePositions ? aavePositions.avaxBorrowApy : null) || 0,
    
    // Available amounts with fallbacks
    avaxAvailableToBorrow: ('avaxAvailableToBorrow' in aavePositions ? aavePositions.avaxAvailableToBorrow : null) || 0,
    usdcAvailableToBorrow: ('usdcAvailableToBorrow' in aavePositions ? aavePositions.usdcAvailableToBorrow : null) || 0,
    
    // Combined loading state
    isLoading: walletBalances.isLoading || aavePositions.isLoading,
  };
};