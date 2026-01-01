import { useQuery } from '@tanstack/react-query';

export interface SquarePayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
  source_type: string;
  card_brand?: string;
  last_4?: string;
}

export interface SquareBalanceData {
  success: boolean;
  timestamp: number;
  environment: string;
  location_id: string;
  location?: {
    name: string;
    currency: string;
    status: string;
  };
  payments?: {
    completed: SquarePayment[];
    pending: SquarePayment[];
    total_completed_7d: number;
    total_pending: number;
    count_completed: number;
    count_pending: number;
  };
  bank_accounts?: {
    id: string;
    account_number_suffix: string;
    bank_name: string;
    status: string;
    primary: boolean;
  }[];
  error?: string;
}

async function fetchSquareBalance(): Promise<SquareBalanceData> {
  const response = await fetch('/api/square/balance');
  if (!response.ok) {
    throw new Error('Failed to fetch Square balance');
  }
  return response.json();
}

export function useSquareBalance() {
  const query = useQuery({
    queryKey: ['squareBalance'],
    queryFn: fetchSquareBalance,
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
