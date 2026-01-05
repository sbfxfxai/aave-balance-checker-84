import { useQuery } from '@tanstack/react-query';

const COINGECKO_BTC_API = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd';

interface BtcPriceResponse {
  bitcoin: {
    usd: number;
  };
}

/**
 * Hook to fetch current BTC price with frequent updates
 * Updates every 10 seconds for real-time price tracking
 */
export function useBtcPrice() {
  const query = useQuery({
    queryKey: ['btcPrice'],
    queryFn: async (): Promise<number> => {
      try {
        const response = await fetch(COINGECKO_BTC_API, {
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch BTC price: HTTP ${response.status}`);
        }

        const data = (await response.json()) as BtcPriceResponse;
        const price = data.bitcoin?.usd;

        if (!price || typeof price !== 'number') {
          throw new Error('Invalid BTC price data');
        }

        return price;
      } catch (error) {
        console.error('[useBtcPrice] Error fetching BTC price:', error);
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

