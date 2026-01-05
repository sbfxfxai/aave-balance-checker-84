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
    }),
  ],
  transports: {
    [avalanche.id]: http(avalancheRpcUrl),
  },
  // Disable SSR for client-side only
  ssr: false,
})
