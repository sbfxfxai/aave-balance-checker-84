import { http, createConfig } from 'wagmi'
import { injected, walletConnect } from 'wagmi/connectors'
import { createWeb3Modal } from '@web3modal/wagmi/react'
import { supportedChains } from './chains'

// Environment variables for production configuration
// NOTE: Environment validation is handled in main.tsx by validateEnvironment()
const avalancheRpcUrl = import.meta.env.VITE_AVALANCHE_RPC_URL!
const arbitrumRpcUrl = import.meta.env.VITE_ARBITRUM_RPC_URL!
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID!

export const config = createConfig({
  chains: [supportedChains.avalanche, supportedChains.arbitrum],
  connectors: [
    injected({
      shimDisconnect: true,
      // The injected connector will work independently of Privy's detection
      // Privy's auto-detection timeout won't affect wagmi's injected connector
    }),
    walletConnect({
      projectId, // Now guaranteed to be valid
      showQrModal: true,
      metadata: {
        name: 'TiltVault',
        description: 'DeFi Dashboard for Avalanche',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://www.tiltvault.com',
        icons: typeof window !== 'undefined' 
          ? [`${window.location.origin}/favicon.ico`]
          : ['https://www.tiltvault.com/favicon.ico'],
      },
      qrModalOptions: {
        themeMode: 'light',
        themeVariables: {
          '--wcm-z-index': '99999',
        },
        enableExplorer: true,
        // Show all available wallets for best user experience
        // Users can choose from MetaMask, Trust Wallet, Rainbow, etc.
      },
    }),
  ],
  transports: {
    [supportedChains.avalanche.id]: http(avalancheRpcUrl, {
      batch: {
        wait: 50, // Batch requests within 50ms
        batchSize: 10, // Max 10 requests per batch
      },
      retryCount: 3,
      retryDelay: 1000,
      // Add timeout to prevent hanging requests
      timeout: 10000,
    }),
    [supportedChains.arbitrum.id]: http(arbitrumRpcUrl, {
      batch: {
        wait: 50, // Batch requests within 50ms
        batchSize: 10, // Max 10 requests per batch
      },
      retryCount: 3,
      retryDelay: 1000,
      // Add timeout to prevent hanging requests
      timeout: 10000,
    }),
  },
  // Disable SSR for client-side only
  ssr: false,
  // In wagmi v3, auto-connect is controlled by storage persistence
  // By not specifying storage or using a custom storage that doesn't persist,
  // we prevent automatic reconnection on page load
  // User must explicitly click "Connect MetaMask" to connect
})

// Create Web3Modal instance
export const web3Modal = createWeb3Modal({
  wagmiConfig: config,
  projectId,
  themeMode: 'light',
})
