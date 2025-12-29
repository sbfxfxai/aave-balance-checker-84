import { Suspense, ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/config/wagmi';
import { PrivyAuthProvider } from '@/components/PrivyAuthProvider';

// Optimized QueryClient for web3 usage
// Created here so it's only instantiated when Web3Providers is loaded
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
    },
  },
});

// Minimal fallback while web3 context loads
const Web3Fallback = () => (
  <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
    <div className="animate-pulse bg-muted h-10 w-32 rounded-md" />
  </div>
);

interface Web3ProvidersProps {
  children: ReactNode;
}

export function Web3Providers({ children }: Web3ProvidersProps) {
  return (
    <PrivyAuthProvider>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <Suspense fallback={<Web3Fallback />}>
            {children}
          </Suspense>
        </QueryClientProvider>
      </WagmiProvider>
    </PrivyAuthProvider>
  );
}
