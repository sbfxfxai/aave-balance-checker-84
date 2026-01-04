// React is already exposed globally in main.tsx before any imports
// No need to expose it again here - it's already available for wagmi
import { Suspense, ReactNode, useEffect } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '@/config/wagmi';

// Eagerly load Buffer polyfill - Privy needs it synchronously for transaction signing
// This must be loaded before Privy operations to prevent "fromByteArray" errors
const ensureBufferPolyfill = async () => {
  if (typeof window !== "undefined" && !(window as any).Buffer) {
    try {
      const { Buffer } = await import("buffer");
      (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
      (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
      console.log('[Web3Providers] Buffer polyfill loaded');
    } catch (error) {
      console.error('Failed to load Buffer polyfill:', error);
      // Don't silently fail - Buffer is critical for Privy operations
    }
  }
};

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
  // Load Buffer polyfill immediately when Web3Providers mounts (before Privy operations)
  // This must be synchronous/eager to prevent Privy transaction errors
  useEffect(() => {
    // Ensure Buffer is loaded before any Web3 operations
    ensureBufferPolyfill().catch((error) => {
      console.error('[Web3Providers] Critical: Failed to load Buffer polyfill:', error);
    });
  }, []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={<Web3Fallback />}>
          {children}
        </Suspense>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
