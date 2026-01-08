/**
 * Secure Storage Utility
 * 
 * Provides secure storage mechanisms for different types of data:
 * - sessionStorage: For sensitive data (cleared when browser closes)
 * - localStorage: For non-sensitive data (persists across sessions)
 * 
 * All functions are SSR-safe and handle cases where storage is unavailable.
 */

/**
 * Storage keys used throughout the application
 */
export const STORAGE_KEYS = {
  /** User email (sensitive - uses sessionStorage) */
  USER_EMAIL: 'tiltvault_email',
  /** Last deposit timestamp per wallet (non-sensitive - uses localStorage) */
  LAST_DEPOSIT: (address: string) => `lastDeposit_${address.toLowerCase()}`,
} as const;

/**
 * Check if storage is available (not in SSR and not disabled)
 */
function isStorageAvailable(storage: Storage): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    const testKey = '__storage_test__';
    storage.setItem(testKey, testKey);
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Secure storage for sensitive data (uses sessionStorage)
 * Data is cleared when the browser tab/window closes
 */
export const secureStorage = {
  /**
   * Set a sensitive value (uses sessionStorage)
   */
  setItem(key: string, value: string): boolean {
    if (!isStorageAvailable(sessionStorage)) {
      return false;
    }

    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn('[Storage] Failed to set secure storage item:', error);
      return false;
    }
  },

  /**
   * Get a sensitive value (uses sessionStorage)
   */
  getItem(key: string): string | null {
    if (!isStorageAvailable(sessionStorage)) {
      return null;
    }

    try {
      return sessionStorage.getItem(key);
    } catch (error) {
      console.warn('[Storage] Failed to get secure storage item:', error);
      return null;
    }
  },

  /**
   * Remove a sensitive value (uses sessionStorage)
   */
  removeItem(key: string): boolean {
    if (!isStorageAvailable(sessionStorage)) {
      return false;
    }

    try {
      sessionStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn('[Storage] Failed to remove secure storage item:', error);
      return false;
    }
  },
};

/**
 * Persistent storage for non-sensitive data (uses localStorage)
 * Data persists across browser sessions
 */
export const persistentStorage = {
  /**
   * Set a non-sensitive value (uses localStorage)
   */
  setItem(key: string, value: string): boolean {
    if (!isStorageAvailable(localStorage)) {
      return false;
    }

    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn('[Storage] Failed to set persistent storage item:', error);
      return false;
    }
  },

  /**
   * Get a non-sensitive value (uses localStorage)
   */
  getItem(key: string): string | null {
    if (!isStorageAvailable(localStorage)) {
      return null;
    }

    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('[Storage] Failed to get persistent storage item:', error);
      return null;
    }
  },

  /**
   * Remove a non-sensitive value (uses localStorage)
   */
  removeItem(key: string): boolean {
    if (!isStorageAvailable(localStorage)) {
      return false;
    }

    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.warn('[Storage] Failed to remove persistent storage item:', error);
      return false;
    }
  },
};

/**
 * Convenience functions for common storage operations
 */
export const storage = {
  /**
   * Get user email from secure storage (sessionStorage)
   */
  getUserEmail(): string {
    return secureStorage.getItem(STORAGE_KEYS.USER_EMAIL) || '';
  },

  /**
   * Set user email in secure storage (sessionStorage)
   */
  setUserEmail(email: string): boolean {
    return secureStorage.setItem(STORAGE_KEYS.USER_EMAIL, email);
  },

  /**
   * Remove user email from secure storage
   */
  removeUserEmail(): boolean {
    return secureStorage.removeItem(STORAGE_KEYS.USER_EMAIL);
  },

  /**
   * Get last deposit timestamp for a wallet address (localStorage)
   */
  getLastDepositTime(address: string): number | null {
    const value = persistentStorage.getItem(STORAGE_KEYS.LAST_DEPOSIT(address));
    if (!value) return null;
    
    const timestamp = parseInt(value, 10);
    return isNaN(timestamp) ? null : timestamp;
  },

  /**
   * Set last deposit timestamp for a wallet address (localStorage)
   */
  setLastDepositTime(address: string, timestamp: number): boolean {
    return persistentStorage.setItem(
      STORAGE_KEYS.LAST_DEPOSIT(address),
      timestamp.toString()
    );
  },

  /**
   * Remove last deposit timestamp for a wallet address
   */
  removeLastDepositTime(address: string): boolean {
    return persistentStorage.removeItem(STORAGE_KEYS.LAST_DEPOSIT(address));
  },
};

