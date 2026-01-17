/**
 * Fee Calculation Utilities
 * Centralized fee calculation logic for deposits
 */

import {
  DEPOSIT_FEE_TIERS,
  ERGC_CONSTANTS,
} from './constants';

/**
 * Calculate the platform fee rate based on deposit amount (without ERGC discount)
 * 
 * Fee structure:
 * - $10-$99.99: 7.4%
 * - $100-$999.99: 4.4%
 * - $1000+: 3.3%
 * 
 * @param depositAmount - The deposit amount in USD
 * @returns Platform fee rate as a decimal (e.g., 0.074 for 7.4%)
 */
export function calculatePlatformFeeRate(depositAmount: number): number {
  if (depositAmount >= DEPOSIT_FEE_TIERS.TIER_1000.threshold) {
    return DEPOSIT_FEE_TIERS.TIER_1000.rate; // 3.3% for deposits >= $1000
  }
  if (depositAmount >= DEPOSIT_FEE_TIERS.TIER_100.threshold) {
    return DEPOSIT_FEE_TIERS.TIER_100.rate; // 4.4% for deposits $100-$999.99
  }
  return DEPOSIT_FEE_TIERS.DEFAULT_RATE; // 7.4% for deposits $10-$99.99
}

/**
 * Calculate the effective platform fee rate
 * With 100+ ERGC: All deposits are FREE (0% fee)
 * Without ERGC:
 *   - Under $10: 7.4%
 *   - $10-$99.99: 4.4%
 *   - $100+: 3.3%
 * 
 * @param depositAmount - The deposit amount in USD
 * @param hasErgcForFreeDeposit - Whether user has enough ERGC for free deposits
 * @returns Effective platform fee rate as a decimal (0 for free deposits with ERGC, otherwise tiered rate)
 */
export function calculateEffectiveFeeRate(
  depositAmount: number,
  hasErgcForFreeDeposit: boolean
): number {
  // With 100+ ERGC: All deposits are FREE
  if (hasErgcForFreeDeposit) {
    return 0;
  }
  
  // Without ERGC: Use tiered fee structure
  return calculatePlatformFeeRate(depositAmount);
}

/**
 * Calculate the platform fee amount in USD
 * 
 * @param depositAmount - The deposit amount in USD
 * @param hasErgcForFreeDeposit - Whether user has enough ERGC for free deposits
 * @returns Platform fee amount in USD
 */
export function calculatePlatformFee(
  depositAmount: number,
  hasErgcForFreeDeposit: boolean
): number {
  const feeRate = calculateEffectiveFeeRate(depositAmount, hasErgcForFreeDeposit);
  return depositAmount * feeRate;
}

/**
 * Calculate the total amount (deposit + fee) to charge
 * 
 * @param depositAmount - The deposit amount in USD
 * @param hasErgcForFreeDeposit - Whether user has enough ERGC for free deposits
 * @returns Total amount to charge in USD
 */
export function calculateTotalAmount(
  depositAmount: number,
  hasErgcForFreeDeposit: boolean
): number {
  const fee = calculatePlatformFee(depositAmount, hasErgcForFreeDeposit);
  return depositAmount + fee;
}

/**
 * Check if a deposit qualifies for free deposits
 * With 100+ ERGC: All deposits are FREE (0% fee)
 * 
 * @param depositAmount - The deposit amount in USD
 * @param hasErgcForFreeDeposit - Whether user has enough ERGC for free deposits
 * @returns True if deposit is free (0% fee), false otherwise
 */
export function isFreeDeposit(
  depositAmount: number,
  hasErgcForFreeDeposit: boolean
): boolean {
  // With 100+ ERGC: All deposits are FREE
  return hasErgcForFreeDeposit;
}

/**
 * Calculate savings percentage when using ERGC
 * 
 * @param depositAmount - The deposit amount in USD
 * @param hasErgcForFreeDeposit - Whether user has enough ERGC for free deposits
 * @returns Savings percentage (0-100)
 */
export function calculateErgcSavingsPercent(
  depositAmount: number,
  hasErgcForFreeDeposit: boolean
): number {
  const feeWithoutErgc = calculatePlatformFeeRate(depositAmount);
  const feeWithErgc = calculateEffectiveFeeRate(depositAmount, hasErgcForFreeDeposit);
  
  if (feeWithoutErgc === 0) {
    return 0; // No savings if there's no fee to begin with
  }
  
  if (feeWithErgc === 0) {
    return 100; // 100% savings if free
  }
  
  return ((feeWithoutErgc - feeWithErgc) / feeWithoutErgc) * 100;
}

