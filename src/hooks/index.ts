/**
 * Aave Dashboard Hooks Index
 * Real hooks only - no fake data
 */

// Real Core Hooks
export { useAavePositions } from './useAavePositions';
export { useWalletBalances } from './useWalletBalances';
export { useUserBalancesExtended } from './useUserBalancesExtended';
export { useAaveSupply } from './useAaveSupply';
export { useAaveBorrow } from './useAaveBorrow';

// BigDecimal Utility
export { bigDecimal, BigDecimal, RoundingMode } from '../utils/bigDecimal';
