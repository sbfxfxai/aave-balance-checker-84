import { http, createConfig } from 'wagmi'
import { avalanche } from 'wagmi/chains'
import { walletConnect } from 'wagmi/connectors'

// WalletConnect project ID - get one free at https://cloud.walletconnect.com
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'c0daaf12b05ec82413fc8c92c1635a76'

export const config = createConfig({
  chains: [avalanche],
  connectors: [
    walletConnect({
      projectId,
      showQrModal: true,
    }),
  ],
  transports: {
    [avalanche.id]: http(),
  },
})
