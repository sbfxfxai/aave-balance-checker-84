import { useState, useEffect } from 'react';

interface AaveRates {
  supplyAPY: number;
  borrowAPY: number;
  isLoading: boolean;
  error: string | null;
}

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second base delay

// Helper function for exponential backoff retry
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseDelay: number = RETRY_DELAY_BASE
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[Aave Rates] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

export function useAaveRates(): AaveRates {
  const [supplyAPY, setSupplyAPY] = useState<number>(3.5); // Default fallback
  const [borrowAPY, setBorrowAPY] = useState<number>(5.0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRates = async () => {
      const runtimeApiBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const apiUrl = `${runtimeApiBaseUrl}/api/aave/rates`;
      
      try {
        // Retry on network errors to get real values
        const response = await retryWithBackoff(async () => {
          const res = await fetch(apiUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
          }
          
          return res;
        });
        
        // Parse JSON response
        const data = await response.json();
        
        // Check if data is successful
        if (data.success && typeof data.supplyAPY === 'number' && typeof data.borrowAPY === 'number') {
          setSupplyAPY(data.supplyAPY);
          setBorrowAPY(data.borrowAPY);
          setError(null); // Clear any previous errors on success
        } else {
          // API returned an error response
          const errorMsg = data.error || 'Invalid response format';
          setError(errorMsg);
          console.warn('[Aave Rates] API returned error:', errorMsg);
        }
      } catch (err) {
        // Handle network errors and other fetch failures
        const errorMessage = err instanceof Error ? err.message : 'Failed to fetch rates';
        
        // Log the error for debugging
        console.error('[Aave Rates] Failed to fetch after retries:', errorMessage);
        
        // Set error state so user knows we're using fallback values
        setError(`Unable to fetch rates: ${errorMessage}`);
        
        // Keep fallback values - they're already set in initial state
        // Don't update them, just log that we're using fallbacks
      } finally {
        setIsLoading(false);
      }
    };

    fetchRates();
    // Refresh every 5 minutes
    const interval = setInterval(fetchRates, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { supplyAPY, borrowAPY, isLoading, error };
}
