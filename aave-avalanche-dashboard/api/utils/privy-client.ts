// Dynamic import to avoid @hpke dependency issues
import type { PrivyClient as PrivyClientType } from '@privy-io/server-auth';
import { logger, LogCategory } from './logger';
import { errorTracker } from './errorTracker';

let PrivyClient: typeof PrivyClientType | null = null;
let privyClient: PrivyClientType | null = null;
let privyImportError: Error | null = null;
let lastInitAttempt: number = 0;

// Configuration
const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

// Helper to detect known @hpke dependency issues
function isKnownHpkeError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return msg.includes('@hpke') || 
         (msg.includes('cannot find module') && msg.includes('hpke'));
}

// Helper to validate configuration
function validateConfiguration(): Error | null {
  const missing: string[] = [];
  if (!PRIVY_APP_ID) missing.push('PRIVY_APP_ID');
  if (!PRIVY_APP_SECRET) missing.push('PRIVY_APP_SECRET');
  
  if (missing.length > 0) {
    return new Error(`Privy configuration incomplete: ${missing.join(', ')} not set`);
  }
  
  return null;
}

/**
 * Initialize Privy client with error handling for known dependency issues.
 * This function is idempotent and caches the result (success or failure).
 * 
 * @returns Object with privyClient (if successful) and error (if failed)
 */
async function initPrivyClient(): Promise<{ 
  privyClient: PrivyClientType | null; 
  error: Error | null;
}> {
  // Return cached result if available
  if (privyClient !== null) {
    return { privyClient, error: null };
  }
  
  if (privyImportError !== null) {
    // For known @hpke errors, never retry
    if (isKnownHpkeError(privyImportError)) {
      return { privyClient: null, error: privyImportError };
    }
    
    // For other errors, allow retry after 30 seconds
    if (Date.now() - lastInitAttempt < 30000) {
      return { privyClient: null, error: privyImportError };
    }
    
    // Clear error to allow retry
    logger.info('Retrying Privy initialization after previous failure', LogCategory.AUTH);
    privyImportError = null;
  }
  
  lastInitAttempt = Date.now();
  
  try {
    // Validate configuration first
    const configError = validateConfiguration();
    if (configError) {
      privyImportError = configError;
      logger.error('Privy configuration invalid', LogCategory.AUTH, {}, configError);
      return { privyClient: null, error: configError };
    }
    
    // Dynamic import to avoid static import issues with @hpke
    let privyModule;
    try {
      privyModule = await import('@privy-io/server-auth');
    } catch (importError) {
      const error = importError instanceof Error ? importError : new Error(String(importError));
      
      // Check if it's the known @hpke dependency issue
      if (isKnownHpkeError(error)) {
        const wrappedError = new Error(
          `Privy SDK dependency error (@hpke): ${error.message}. ` +
          `This is a known issue with @privy-io/server-auth dependencies.` 
        );
        privyImportError = wrappedError;
        
        logger.error('Known Privy @hpke dependency issue detected', LogCategory.AUTH, {
          originalError: error.message,
          stack: error.stack
        }, wrappedError);
        
        errorTracker.trackAuthError(wrappedError, {
          stage: 'privy_import',
          errorType: 'hpke_dependency',
          originalError: error.message
        });
        
        return { privyClient: null, error: privyImportError };
      }
      
      // Re-throw if it's a different error
      throw error;
    }
    
    PrivyClient = privyModule.PrivyClient;
    privyClient = new PrivyClient(PRIVY_APP_ID!, PRIVY_APP_SECRET!);
    
    logger.info('Successfully initialized Privy client', LogCategory.AUTH);
    
    return { privyClient, error: null };
    
  } catch (error) {
    privyImportError = error instanceof Error ? error : new Error(String(error));
    
    logger.error('Failed to initialize Privy client', LogCategory.AUTH, {}, privyImportError);
    
    errorTracker.trackAuthError(privyImportError, {
      stage: 'privy_initialization',
      errorType: 'unknown'
    });
    
    return { privyClient: null, error: privyImportError };
  }
}

/**
 * Get the Privy client instance.
 * Initializes the client on first call if not already initialized.
 * 
 * @throws {Error} If initialization fails or client is unavailable
 * @returns Promise resolving to initialized Privy client
 * 
 * @example
 * try {
 *   const privy = await getPrivyClient();
 *   const user = await privy.verifyAuthToken(token);
 * } catch (error) {
 *   // Handle initialization or verification error
 * }
 */
export async function getPrivyClient(): Promise<PrivyClientType> {
  if (privyClient !== null) {
    return privyClient;
  }
  
  if (privyImportError !== null) {
    throw privyImportError;
  }
  
  const result = await initPrivyClient();
  
  if (!result.privyClient) {
    throw result.error || new Error('Privy client initialization failed for unknown reason');
  }
  
  return result.privyClient;
}

/**
 * Check if Privy client is available and can be initialized.
 * 
 * Note: This function will attempt initialization if not already attempted,
 * which may have side effects (network calls, error logging).
 * 
 * @returns Promise resolving to true if Privy is available, false otherwise
 * 
 * @example
 * const canUsePrivy = await isPrivyAvailable();
 * if (canUsePrivy) {
 *   const privy = await getPrivyClient();
 *   // Use privy...
 * } else {
 *   // Fall back to alternative auth
 * }
 */
export async function isPrivyAvailable(): Promise<boolean> {
  // If already initialized successfully
  if (privyClient !== null) {
    return true;
  }
  
  // If previously failed with known @hpke issue
  if (privyImportError !== null && isKnownHpkeError(privyImportError)) {
    return false;
  }
  
  // Try to initialize
  const result = await initPrivyClient();
  return result.privyClient !== null;
}

/**
 * Get the current Privy import/initialization error, if any.
 * 
 * Note: Returns null if no initialization has been attempted yet.
 * Call isPrivyAvailable() first to trigger initialization.
 * 
 * @returns Current error or null if no error or not yet initialized
 */
export function getPrivyError(): Error | null {
  return privyImportError;
}

/**
 * Reset Privy client state to allow re-initialization.
 * Useful for testing or recovering from transient errors.
 * 
 * @example
 * // After fixing configuration
 * resetPrivyClient();
 * const privy = await getPrivyClient(); // Will retry initialization
 */
export function resetPrivyClient(): void {
  privyClient = null;
  privyImportError = null;
  PrivyClient = null;
  lastInitAttempt = 0;
  
  logger.info('Privy client state reset', LogCategory.AUTH);
}

/**
 * Get current Privy initialization status.
 * Useful for health checks and monitoring.
 * 
 * @returns Status object with initialization state
 */
export function getPrivyStatus(): {
  initialized: boolean;
  available: boolean;
  error: string | null;
  lastAttempt: number;
} {
  return {
    initialized: privyClient !== null,
    available: privyClient !== null && privyImportError === null,
    error: privyImportError?.message || null,
    lastAttempt: lastInitAttempt
  };
}
