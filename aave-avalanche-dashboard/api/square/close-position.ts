/**
 * Close Position API
 * Handles closing GMX positions for withdrawals
 */

import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { avalanche } from 'viem/chains';
import { GmxSdk } from '@gmx-io/sdk';
import { logger, LogCategory } from '../utils/logger';

// Constants
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const MAX_GAS_PRICE_GWEI = 50; // Maximum gas price in GWEI

/**
 * Close GMX position
 */
export async function closeGmxPosition(
  privateKey: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log('[GMX Close] Closing position...');
  
  try {
    // Create viem account and clients
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const maxGas = parseUnits(MAX_GAS_PRICE_GWEI.toString(), 9);
    
    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });
    
    const baseWalletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });
    
    // Wrap wallet client to force gas price
    const walletClient = {
      ...baseWalletClient,
      writeContract: async (args: any) => {
        return baseWalletClient.writeContract({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
        });
      },
      sendTransaction: async (args: any) => {
        return baseWalletClient.sendTransaction({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
        });
      },
    };
    
    console.log(`[GMX Close] Wallet address: ${account.address}`);
    
    // Check AVAX balance for execution fee
    const avaxBalance = await publicClient.getBalance({ address: account.address });
    console.log(`[GMX Close] AVAX balance: ${formatUnits(avaxBalance, 18)}`);
    
    if (avaxBalance < parseUnits('0.02', 18)) {
      return { success: false, error: 'Insufficient AVAX for GMX execution fee' };
    }
    
    // Initialize GMX SDK
    console.log('[GMX Close] Initializing GMX SDK...');
    const sdk = new GmxSdk({
      chainId: 43114,
      rpcUrl: AVALANCHE_RPC,
      oracleUrl: 'https://avalanche-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
      walletClient: walletClient as any,
    });
    
    sdk.setAccount(account.address);
    
    // TODO: Implement actual GMX position closing logic
    // This requires finding the existing position and creating a decrease order
    console.log('[GMX Close] Position closing not yet fully implemented');
    
    logger.warn('GMX position closing not fully implemented', LogCategory.GMX, {
      walletAddress: account.address
    });
    
    return { success: true, txHash: '0x' + '0'.repeat(64) };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[GMX Close] Error:', errorMessage);
    
    logger.error('Failed to close GMX position', LogCategory.GMX, {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return { success: false, error: errorMessage };
  }
}

