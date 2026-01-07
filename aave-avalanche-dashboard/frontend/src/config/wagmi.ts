import { http, createConfig } from 'wagmi'
import { avalanche } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// Environment variables for production configuration
// Set VITE_AVALANCHE_RPC_URL in Vercel/environment for dedicated RPC provider
const avalancheRpcUrl = import.meta.env.VITE_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc'

export const config = createConfig({
  chains: [avalanche],
  connectors: [
    injected({
      shimDisconnect: true,
      // The injected connector will work independently of Privy's detection
      // Privy's auto-detection timeout won't affect wagmi's injected connector
    }),
  ],
  transports: {
    [avalanche.id]: http(avalancheRpcUrl),
  },
  // Disable SSR for client-side only
  ssr: false,
  // In wagmi v3, auto-connect is controlled by storage persistence
  // By not specifying storage or using a custom storage that doesn't persist,
  // we prevent automatic reconnection on page load
  // User must explicitly click "Connect MetaMask" to connect
})
