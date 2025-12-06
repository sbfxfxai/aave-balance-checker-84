import { http, createConfig } from 'wagmi'
import { avalanche } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// Environment variables for production configuration
// Set VITE_AVALANCHE_RPC_URL in Vercel/environment for dedicated RPC provider
const avalancheRpcUrl = import.meta.env.VITE_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc'

// WalletConnect project ID
// Get one free at https://cloud.walletconnect.com
// Set VITE_WALLETCONNECT_PROJECT_ID in Vercel/environment variables
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

// Use fallback project ID if not set (don't crash in production)
// The fallback allows the app to work even if env var isn't set in Vercel
const walletConnectProjectId = projectId || 'c0daaf12b05ec82413fc8c92c1635a76'

// Warn if using fallback (but don't block)
if (!projectId) {
  console.warn(
    '⚠️ VITE_WALLETCONNECT_PROJECT_ID is not set. ' +
    'Using fallback project ID. ' +
    'Set VITE_WALLETCONNECT_PROJECT_ID in Vercel environment variables for production.'
  )
}

export const config = createConfig({
  chains: [avalanche],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
    walletConnect({
      projectId: walletConnectProjectId,
      showQrModal: true,
      metadata: {
        name: 'Aave Avalanche Dashboard',
        description: 'Aave V3 DeFi dashboard for Avalanche C-Chain',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://aave-balance-checker-84.vercel.app',
        icons: ['https://aave-balance-checker-84.vercel.app/favicon.ico'],
      },
    }),
  ],
  transports: {
    [avalanche.id]: http(avalancheRpcUrl),
  },
  // Disable SSR for client-side only
  ssr: false,
})
