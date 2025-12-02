import { http, createConfig } from 'wagmi'
import { avalanche } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

// WalletConnect project ID - get one free at https://cloud.walletconnect.com
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'c0daaf12b05ec82413fc8c92c1635a76'

export const config = createConfig({
  chains: [avalanche],
  connectors: [
    walletConnect({
      projectId,
      showQrModal: true,
      metadata: {
        name: 'Aave Balance Checker',
        description: 'Check your Aave V3 positions on Avalanche',
        url: typeof window !== 'undefined' ? window.location.origin : 'https://aave-balance-checker-84.vercel.app',
        icons: ['https://aave-balance-checker-84.vercel.app/favicon.ico'],
      },
    }),
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [avalanche.id]: http('https://api.avax.network/ext/bc/C/rpc'),
  },
})
