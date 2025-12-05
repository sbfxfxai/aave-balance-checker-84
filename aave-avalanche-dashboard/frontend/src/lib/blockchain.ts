import { Chain } from 'viem';
import type { Config } from 'wagmi';

// Get explorer URL for a transaction
// TODO: Add support for more chains as needed
export function getExplorerTxLink(chainId: number, txHash: string): string {
  switch (chainId) {
    case 43114: // Avalanche Mainnet
      return `https://snowtrace.io/tx/${txHash}`;
    case 43113: // Avalanche Fuji Testnet
      return `https://testnet.snowtrace.io/tx/${txHash}`;
    case 1: // Ethereum Mainnet
      return `https://etherscan.io/tx/${txHash}`;
    case 5: // Goerli Testnet
      return `https://goerli.etherscan.io/tx/${txHash}`;
    default:
      return `https://snowtrace.io/tx/${txHash}`; // Default to Avalanche
  }
}

// Helper to wait for transaction receipt
export async function waitForTransactionReceipt(
  config: Config,
  hash: `0x${string}`
) {
  const { waitForTransactionReceipt } = await import('@wagmi/core');
  return waitForTransactionReceipt(config, { hash });
}
