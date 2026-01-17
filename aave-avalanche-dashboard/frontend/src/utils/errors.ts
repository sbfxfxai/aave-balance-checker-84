/**
 * Professional error handling utilities
 * Provides consistent error message extraction across the application
 */

/**
 * Extracts a user-friendly error message from various error types
 * @param error - Unknown error type that could be Error, string, object, or null/undefined
 * @returns User-friendly error message
 */
export function getErrorMessage(error: unknown): string {
  // Handle Error instances
  if (error instanceof Error) {
    return error.message;
  }
  
  // Handle string errors
  if (typeof error === 'string') {
    return error;
  }
  
  // Handle objects with message property (common in API responses)
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  
  // Handle objects with error property
  if (error && typeof error === 'object' && 'error' in error) {
    const errorProp = (error as { error?: unknown }).error;
    if (typeof errorProp === 'string') {
      return errorProp;
    }
    if (errorProp instanceof Error) {
      return errorProp.message;
    }
  }
  
  // Handle arrays (common in validation errors)
  if (Array.isArray(error)) {
    if (error.length > 0 && typeof error[0] === 'string') {
      return error[0];
    }
    if (error.length > 0 && error[0] instanceof Error) {
      return error[0].message;
    }
  }
  
  // Handle null/undefined
  if (error === null || error === undefined) {
    return 'An unexpected error occurred';
  }
  
  // Handle other objects - try to stringify safely
  try {
    const stringified = JSON.stringify(error);
    if (stringified && stringified !== '{}') {
      return `Error: ${stringified}`;
    }
  } catch {
    // JSON.stringify failed, continue to default
  }
  
  // Default fallback
  return 'An unexpected error occurred';
}

/**
 * Checks if an error is a user rejection (common in wallet operations)
 * @param error - Unknown error type
 * @returns True if the error appears to be a user rejection
 */
export function isUserRejection(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  
  const userRejectionPhrases = [
    'user rejected',
    'user denied',
    'user cancelled',
    'user canceled',
    'rejected by user',
    'denied by user',
    'cancelled by user',
    'canceled by user',
    'user rejected request',
    'user denied request',
    'action rejected',
    'request rejected',
    'transaction rejected',
    'signature denied',
    'signature rejected',
  ];
  
  return userRejectionPhrases.some(phrase => message.includes(phrase));
}

/**
 * Checks if an error is network-related
 * @param error - Unknown error type
 * @returns True if the error appears to be network-related
 */
export function isNetworkError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  
  const networkErrorPhrases = [
    'network',
    'connection',
    'timeout',
    'offline',
    'unreachable',
    'dns',
    'fetch',
    'cors',
    'eth_requestaccounts',
    'chain not supported',
    'wrong network',
  ];
  
  return networkErrorPhrases.some(phrase => message.includes(phrase));
}

/**
 * Checks if an error is wallet-related
 * @param error - Unknown error type
 * @returns True if the error appears to be wallet-related
 */
export function isWalletError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  
  const walletErrorPhrases = [
    'wallet',
    'metamask',
    'walletconnect',
    'coinbase',
    'trust wallet',
    'no wallet',
    'wallet not found',
    'wallet not installed',
    'wallet locked',
    'wallet disconnected',
  ];
  
  return walletErrorPhrases.some(phrase => message.includes(phrase));
}

/**
 * Gets a user-friendly error message with context
 * @param error - Unknown error type
 * @param context - Optional context for better error messages
 * @returns Contextual error message
 */
export function getContextualErrorMessage(error: unknown, context?: string): string {
  const baseMessage = getErrorMessage(error);
  
  if (context) {
    return `${context}: ${baseMessage}`;
  }
  
  return baseMessage;
}

/**
 * Error types for consistent error handling
 */
export enum ErrorType {
  USER_REJECTION = 'USER_REJECTION',
  NETWORK_ERROR = 'NETWORK_ERROR',
  WALLET_ERROR = 'WALLET_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Categorizes an error into a specific type
 * @param error - Unknown error type
 * @returns Error type enum
 */
export function getErrorType(error: unknown): ErrorType {
  if (isUserRejection(error)) {
    return ErrorType.USER_REJECTION;
  }
  
  if (isNetworkError(error)) {
    return ErrorType.NETWORK_ERROR;
  }
  
  if (isWalletError(error)) {
    return ErrorType.WALLET_ERROR;
  }
  
  return ErrorType.UNKNOWN_ERROR;
}

/**
 * Gets appropriate toast configuration for different error types
 * @param error - Unknown error type
 * @returns Toast configuration
 */
export function getErrorToastConfig(error: unknown) {
  const errorType = getErrorType(error);
  const message = getErrorMessage(error);
  
  switch (errorType) {
    case ErrorType.USER_REJECTION:
      return {
        title: 'Action Cancelled',
        description: message,
        variant: 'default' as const,
      };
      
    case ErrorType.NETWORK_ERROR:
      return {
        title: 'Connection Error',
        description: 'Please check your internet connection and try again',
        variant: 'destructive' as const,
      };
      
    case ErrorType.WALLET_ERROR:
      return {
        title: 'Wallet Error',
        description: message,
        variant: 'destructive' as const,
      };
      
    default:
      return {
        title: 'Error',
        description: message,
        variant: 'destructive' as const,
      };
  }
}

// Export default for convenience
export default {
  getErrorMessage,
  isUserRejection,
  isNetworkError,
  isWalletError,
  getContextualErrorMessage,
  getErrorType,
  getErrorToastConfig,
};
