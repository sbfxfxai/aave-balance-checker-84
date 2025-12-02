import { createConfig } from 'wagmi';
import { avalanche } from 'wagmi/chains';
import { http } from 'viem';

// WalletConnect project ID - get one free at https://cloud.walletconnect.com
const projectId = 'c0daaf12b05ec82413fc8c92c1635a76'; // Your actual WalletConnect Project ID

export const config = createConfig({
  chains: [avalanche],
  transports: {
    [avalanche.id]: http(),
  },
});
