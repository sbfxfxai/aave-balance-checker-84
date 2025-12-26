import { useState, useEffect } from 'react';

interface AaveRates {
  supplyAPY: number;
  borrowAPY: number;
  isLoading: boolean;
  error: string | null;
}

export function useAaveRates(): AaveRates {
  const [supplyAPY, setSupplyAPY] = useState<number>(3.5); // Default fallback
  const [borrowAPY, setBorrowAPY] = useState<number>(5.0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRates = async () => {
      try {
        const response = await fetch('/api/aave/rates');
        const data = await response.json();
        if (data.success) {
          setSupplyAPY(data.supplyAPY);
          setBorrowAPY(data.borrowAPY);
        } else {
          setError(data.error || 'Failed to fetch rates');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch rates');
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
