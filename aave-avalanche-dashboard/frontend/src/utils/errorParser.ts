/**
 * Utility functions for parsing and categorizing blockchain errors
 * Helps distinguish between gas errors, contract reverts, and Aave-specific failures
 */

export interface ParsedError {
  type: 'user_rejected' | 'gas_insufficient' | 'contract_revert' | 'allowance' | 'balance' | 'network' | 'unknown';
  message: string;
  originalError: unknown;
  revertReason?: string;
}

/**
 * Common Aave V3 revert reasons (from Aave Protocol error codes)
 */
const AAVE_REVERT_REASONS = {
  RESERVE_PAUSED: /reserve.*paused|paused.*reserve/i,
  RESERVE_INACTIVE: /reserve.*inactive|inactive.*reserve/i,
  RESERVE_FROZEN: /reserve.*frozen|frozen.*reserve/i,
  TRANSFER_FAILED: /transfer.*failed|failed.*transfer|erc20.*transfer/i,
  INSUFFICIENT_LIQUIDITY: /insufficient.*liquidity|liquidity.*insufficient/i,
  INVALID_AMOUNT: /invalid.*amount|amount.*invalid|zero.*amount/i,
  HEALTH_FACTOR_LOW: /health.*factor|ltv.*exceeded/i,
  COLLATERAL_DISABLED: /collateral.*disabled|disabled.*collateral/i,
} as const;

/**
 * Parse error to extract meaningful information
 */
export function parseError(error: unknown): ParsedError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorString = String(error).toLowerCase();
  
  // Check for user rejection
  if (
    errorMessage.includes('User rejected') ||
    errorMessage.includes('user rejected') ||
    errorMessage.includes('User denied') ||
    errorMessage.includes('user denied')
  ) {
    return {
      type: 'user_rejected',
      message: 'Transaction rejected in wallet',
      originalError: error,
    };
  }

  // Check for genuine gas balance issues (very specific patterns)
  if (
    errorMessage.toLowerCase().includes('insufficient funds for gas') ||
    errorMessage.toLowerCase().includes('insufficient funds for intrinsic transaction cost') ||
    errorMessage.toLowerCase().includes('insufficient balance for transfer') ||
    (errorMessage.toLowerCase().includes('insufficient funds') && 
     errorMessage.toLowerCase().includes('transaction'))
  ) {
    return {
      type: 'gas_insufficient',
      message: 'Insufficient AVAX for gas fees',
      originalError: error,
    };
  }

  // Check for contract execution reverts
  if (
    errorMessage.includes('execution reverted') ||
    errorString.includes('execution reverted') ||
    errorMessage.includes('Execution reverted') ||
    errorMessage.includes('revert') ||
    errorString.includes('revert')
  ) {
    // Try to extract revert reason from error data
    let revertReason: string | undefined;
    
    // Check for Aave-specific revert reasons
    for (const [reason, pattern] of Object.entries(AAVE_REVERT_REASONS)) {
      if (pattern.test(errorMessage) || pattern.test(errorString)) {
        revertReason = reason;
        break;
      }
    }

    // Try to extract revert reason from error data if available
    // Type guard for error objects with data/reason properties
    const errorWithData = error as { data?: unknown; reason?: unknown };
    if (errorWithData?.data || errorWithData?.reason) {
      const data = errorWithData.data || errorWithData.reason;
      if (typeof data === 'string') {
        revertReason = data;
      } else if (data && typeof data === 'object' && 'message' in data) {
        revertReason = String((data as { message: unknown }).message);
      }
    }

    // Build user-friendly message based on revert reason
    let message = 'Transaction would fail on-chain (contract revert)';
    if (revertReason === 'RESERVE_PAUSED') {
      message = 'Aave reserve is paused. Supply is temporarily disabled.';
    } else if (revertReason === 'RESERVE_INACTIVE' || revertReason === 'RESERVE_FROZEN') {
      message = 'Aave reserve is inactive or frozen. Please try again later.';
    } else if (revertReason === 'TRANSFER_FAILED') {
      message = 'Token transfer failed. Check your USDC balance and allowance.';
    } else if (revertReason === 'INSUFFICIENT_LIQUIDITY') {
      message = 'Insufficient liquidity in Aave pool. Please try a smaller amount.';
    } else if (revertReason === 'INVALID_AMOUNT') {
      message = 'Invalid amount. Please enter a valid amount greater than zero.';
    } else if (revertReason) {
      message = `Contract revert: ${revertReason}`;
    }

    return {
      type: 'contract_revert',
      message,
      originalError: error,
      revertReason,
    };
  }

  // Check for allowance issues
  if (
    errorMessage.includes('allowance') ||
    errorString.includes('allowance') ||
    errorMessage.includes('approval') ||
    errorString.includes('approval')
  ) {
    return {
      type: 'allowance',
      message: 'Insufficient token allowance. Please approve first.',
      originalError: error,
    };
  }

  // Check for balance issues
  if (
    errorMessage.includes('insufficient balance') ||
    errorString.includes('insufficient balance') ||
    errorMessage.includes('balance too low') ||
    errorString.includes('balance too low')
  ) {
    return {
      type: 'balance',
      message: 'Insufficient token balance',
      originalError: error,
    };
  }

  // Check for network issues
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('Network') ||
    errorMessage.includes('chain') ||
    errorMessage.includes('Chain')
  ) {
    return {
      type: 'network',
      message: 'Network error. Please check your connection.',
      originalError: error,
    };
  }

  // Unknown error
  return {
    type: 'unknown',
    message: errorMessage || 'Unknown error occurred',
    originalError: error,
  };
}

/**
 * Get detailed error message for display to user
 */
export function getErrorMessage(error: unknown, context?: string): string {
  const parsed = parseError(error);
  
  // Add context if provided
  if (context) {
    return `${context}: ${parsed.message}`;
  }
  
  return parsed.message;
}

/**
 * Check if error is a contract revert (not a gas issue)
 */
export function isContractRevert(error: unknown): boolean {
  const parsed = parseError(error);
  return parsed.type === 'contract_revert';
}

/**
 * Check if error is a genuine gas balance issue
 */
export function isGasInsufficient(error: unknown): boolean {
  const parsed = parseError(error);
  return parsed.type === 'gas_insufficient';
}

