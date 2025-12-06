import { http, createConfig } from 'wagmi'
import { avalanche } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// Environment variables for production configuration
// Set VITE_AVALANCHE_RPC_URL in Vercel/environment for dedicated RPC provider
const avalancheRpcUrl = import.meta.env.VITE_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc'

// WalletConnect project ID - REQUIRED in production
// Get one free at https://cloud.walletconnect.com
// Set VITE_WALLETCONNECT_PROJECT_ID in Vercel/environment
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

// Fail hard in production builds (not development) if WalletConnect project ID is missing
// Only throw in actual production builds, not during local development
if (!projectId && import.meta.env.PROD && !import.meta.env.DEV) {
  throw new Error(
    '❌ VITE_WALLETCONNECT_PROJECT_ID is required in production! ' +
    'Please set it in your environment variables. ' +
    'Get a free project ID at https://cloud.walletconnect.com'
  )
}

// Warn in development if project ID is missing (but don't block)
if (!projectId && import.meta.env.DEV) {
  console.warn(
    '⚠️ VITE_WALLETCONNECT_PROJECT_ID is not set. ' +
    'WalletConnect will use a fallback project ID for development. ' +
    'Set VITE_WALLETCONNECT_PROJECT_ID in your .env file for production.'
  )
}

export const config = createConfig({
  chains: [avalanche],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
    walletConnect({
      projectId: projectId || 'c0daaf12b05ec82413fc8c92c1635a76', // Fallback only for development
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
