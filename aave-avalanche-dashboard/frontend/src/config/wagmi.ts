import { createConfig } from 'wagmi';
import { avalanche } from 'wagmi/chains';
import { InjectedConnector } from 'wagmi/connectors/injected';
import { WalletConnectConnector } from 'wagmi/connectors/walletConnect';
import { createPublicClient, http } from 'viem';

// WalletConnect project ID - get one free at https://cloud.walletconnect.com
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;

const connectors = [
  new InjectedConnector({
    chains: [avalanche],
    options: {
      shimDisconnect: true,
    },
  }),
  new WalletConnectConnector({
    chains: [avalanche],
    options: {
      projectId,
      showQrModal: true,
    },
  }),
];

const publicClient = createPublicClient({
  chain: avalanche,
  transport: http(),
});

export const config = createConfig({
  autoConnect: true,
  connectors,
  publicClient,
});
