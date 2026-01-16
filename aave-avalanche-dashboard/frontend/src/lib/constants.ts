// Trader Joe Router ABI
export const TRADER_JOE_ROUTER_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' }
    ],
    name: 'swapExactAVAXForTokens',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' }
    ],
    name: 'getAmountsOut',
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/**
 * Deposit Modal Constants
 * Centralized configuration values for the deposit flow
 */

// Platform Fee Tiers (based on deposit amount)
export const DEPOSIT_FEE_TIERS = {
  TIER_1000: {
    threshold: 1000,
    rate: 0.033, // 3.3%
  },
  TIER_100: {
    threshold: 100,
    rate: 0.044, // 4.4%
  },
  TIER_50: {
    threshold: 50,
    rate: 0.058, // 5.8%
  },
  TIER_20: {
    threshold: 20,
    rate: 0.074, // 7.4%
  },
  DEFAULT_RATE: 0.074, // 7.4% default
} as const;

// ERGC Token Constants
export const ERGC_CONSTANTS = {
  /** Minimum ERGC balance required for free deposits */
  FREE_DEPOSIT_THRESHOLD: 100,
  /** Minimum deposit amount to qualify for free deposits with ERGC */
  FREE_DEPOSIT_MIN_AMOUNT: 10,
} as const;

// Deposit Limits
export const DEPOSIT_LIMITS = {
  /** Minimum deposit amount for Conservative and Morpho strategies */
  MIN_DEPOSIT: 10,
  /** Maximum deposit amount cap */
  MAX_DEPOSIT: 9999,
  /** Fallback hub balance when API fails */
  HUB_BALANCE_FALLBACK: 9999,
} as const;

// Cooldown Constants
export const COOLDOWN_CONSTANTS = {
  /** Cooldown period between deposits (10 minutes in milliseconds) */
  PERIOD_MS: 10 * 60 * 1000,
  /** Interval for checking cooldown status (1 second) */
  CHECK_INTERVAL_MS: 1000,
} as const;

// Price Constants
export const PRICE_CONSTANTS = {
  /** Fallback AVAX price in USD when API fails */
  AVAX_FALLBACK_PRICE_USD: 30,
} as const;

// API Timeout Constants (in milliseconds)
export const API_TIMEOUTS = {
  /** Short timeout for quick API calls (5 seconds) */
  SHORT: 5000,
  /** Standard timeout for API calls (10 seconds) */
  STANDARD: 10000,
} as const;

// UI Constants
export const UI_CONSTANTS = {
  /** Delay before redirecting to dashboard after successful payment (2 seconds) */
  REDIRECT_DELAY_MS: 2000,
} as const;