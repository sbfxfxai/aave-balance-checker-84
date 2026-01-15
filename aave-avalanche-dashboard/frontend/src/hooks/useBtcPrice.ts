import { useQuery } from '@tanstack/react-query';

const BTC_PRICE_API = '/api/price/btc';

interface BtcPriceResponse {
  price: number;
  source: string;
  timestamp: number;
  confidence: 'high' | 'medium' | 'low';
  cached?: boolean;
  stale?: boolean;
}

/**
 * Hook to fetch current BTC price with frequent updates
 * Uses backend API endpoint to avoid CORS issues and rate limiting
 * Updates every 10 seconds for real-time price tracking
 */
export function useBtcPrice() {
  const query = useQuery({
    queryKey: ['btcPrice'],
    queryFn: async (): Promise<number> => {
      try {
        const response = await fetch(BTC_PRICE_API, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          // Handle rate limiting gracefully - don't throw, let React Query retry
          if (response.status === 429) {
            console.warn('[useBtcPrice] Rate limited (429), will retry');
            throw new Error('Rate limited');
          }
          if (response.status === 503) {
            console.warn('[useBtcPrice] Service unavailable (503), will retry');
            throw new Error('Service unavailable');
          }
          throw new Error(`Failed to fetch BTC price: HTTP ${response.status}`);
        }

        const data = (await response.json()) as BtcPriceResponse;
        const price = data.price;

        if (!price || typeof price !== 'number') {
          throw new Error('Invalid BTC price data');
        }

        return price;
      } catch (error) {
        // Suppress network errors - they're expected and React Query will retry
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (!errorMsg.includes('Failed to fetch') && !errorMsg.includes('aborted') && !errorMsg.includes('Rate limited') && !errorMsg.includes('Service unavailable')) {
          console.error('[useBtcPrice] Error fetching BTC price:', error);
        }
        // Return cached price or fallback
        throw error;
      }
    },
    refetchInterval: 10000, // Refetch every 10 seconds
    refetchIntervalInBackground: true, // Continue refetching when tab is in background
    staleTime: 5000, // Consider data stale after 5 seconds
    gcTime: 30000, // Keep in cache for 30 seconds
    retry: 3,
    retryDelay: 1000,
  });

  return {
    price: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}

