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
const fallbackProjectId = '392a0f60dab84b8a1d2a2773b55f3aa1' // Fresh WalletConnect project
const finalProjectId = projectId || fallbackProjectId

// Log WalletConnect configuration for debugging
if (typeof window !== 'undefined') {
  console.log('[Wagmi Config] WalletConnect Configuration:', {
    hasEnvProjectId: !!projectId,
    projectIdLength: projectId?.length || 0,
    usingFallback: !projectId,
    finalProjectId: finalProjectId.substring(0, 8) + '...',
    currentOrigin: window.location.origin,
    isProduction: import.meta.env.PROD,
  })
  
  if (!projectId && import.meta.env.PROD) {
    console.warn(
      '⚠️ [Wagmi Config] VITE_WALLETCONNECT_PROJECT_ID not set in production! ' +
      'Using fallback project ID. This may cause 403 errors. ' +
      'Set VITE_WALLETCONNECT_PROJECT_ID in Vercel environment variables. ' +
      'Also ensure your domain (www.tiltvault.com) is whitelisted in WalletConnect Cloud dashboard.'
    )
  }
}

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
      projectId: finalProjectId,
      showQrModal: true,
      metadata: {
        name: 'TiltVault',
        description: 'DeFi dashboard for Avalanche C-Chain with GMX integration',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://www.tiltvault.com',
        icons: ['https://www.tiltvault.com/tiltvault-logo.png'],
      },
    }),
  ],
  transports: {
    [avalanche.id]: http(avalancheRpcUrl),
  },
  // Disable SSR for client-side only
  ssr: false,
})
