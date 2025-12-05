import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.tsx";
import { config } from "./config/wagmi";
import "./index.css";

// Suppress harmless WalletConnect warnings about session_request events
if (typeof window !== 'undefined') {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const message = args[0]?.toString() || '';
    // Filter out WalletConnect session_request warnings
    if (message.includes('emitting session_request') && message.includes('without any listeners')) {
      return; // Suppress this specific warning
    }
    originalError.apply(console, args);
  };
}

// Configure QueryClient with optimized defaults for Wagmi
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time: data is fresh for 30 seconds (reduces unnecessary refetches)
      staleTime: 30_000,
      // Cache time: keep unused data for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Retry failed requests
      retry: 1,
      // Refetch on window focus only if data is stale (reduces refetches)
      refetchOnWindowFocus: true,
      // Don't refetch on reconnect unless data is stale
      refetchOnReconnect: false,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
);
