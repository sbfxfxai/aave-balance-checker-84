/**
 * Fee Calculation Utilities
 * Centralized fee calculation logic for deposits
 */

import {
  DEPOSIT_FEE_TIERS,
  ERGC_CONSTANTS,
} from './constants';

/**
 * Calculate the platform fee rate based on deposit amount
 * Uses tiered fee structure from DEPOSIT_FEE_TIERS
 * 
 * @param depositAmount - The deposit amount in USD
 * @returns Platform fee rate as a decimal (e.g., 0.033 for 3.3%)
 */
export function calculatePlatformFeeRate(depositAmount: number): number {
  if (depositAmount >= DEPOSIT_FEE_TIERS.TIER_1000.threshold) {
    return DEPOSIT_FEE_TIERS.TIER_1000.rate;
  }
  if (depositAmount >= DEPOSIT_FEE_TIERS.TIER_100.threshold) {
    return DEPOSIT_FEE_TIERS.TIER_100.rate;
  }
  if (depositAmount >= DEPOSIT_FEE_TIERS.TIER_50.threshold) {
    return DEPOSIT_FEE_TIERS.TIER_50.rate;
  }
  if (depositAmount >= DEPOSIT_FEE_TIERS.TIER_20.threshold) {
    return DEPOSIT_FEE_TIERS.TIER_20.rate;
  }
  return DEPOSIT_FEE_TIERS.DEFAULT_RATE;
}

/**
 * Calculate the effective platform fee rate considering ERGC benefits
 * 
 * If user has ERGC_CONSTANTS.FREE_DEPOSIT_THRESHOLD+ ERGC and deposit is >= ERGC_CONSTANTS.FREE_DEPOSIT_MIN_AMOUNT,
 * the fee is 0% (FREE). Otherwise, uses the standard platform fee rate.
 * 
 * @param depositAmount - The deposit amount in USD
 * @param hasErgcForFreeDeposit - Whether user has enough ERGC for free deposits
 * @returns Effective platform fee rate as a decimal (0 for free deposits, otherwise tiered rate)
 */
export function calculateEffectiveFeeRate(
  depositAmount: number,
  hasErgcForFreeDeposit: boolean
): number {
  // FREE deposits: If deposit >= FREE_DEPOSIT_MIN_AMOUNT AND user has FREE_DEPOSIT_THRESHOLD+ ERGC, fee is 0
  if (depositAmount >= ERGC_CONSTANTS.FREE_DEPOSIT_MIN_AMOUNT && hasErgcForFreeDeposit) {
    return 0;
  }
  
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
 * Check if a deposit qualifies for free deposits with ERGC
 * 
 * @param depositAmount - The deposit amount in USD
 * @param hasErgcForFreeDeposit - Whether user has enough ERGC for free deposits
 * @returns True if deposit is free (0% fee), false otherwise
 */
export function isFreeDeposit(
  depositAmount: number,
  hasErgcForFreeDeposit: boolean
): boolean {
  return depositAmount >= ERGC_CONSTANTS.FREE_DEPOSIT_MIN_AMOUNT && hasErgcForFreeDeposit;
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

