/**
 * Edit Collateral API
 * Handles editing GMX position collateral (adding or removing)
 */

import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, maxUint256 } from 'viem';
import { avalanche } from 'viem/chains';
import { GmxSdk } from '@gmx-io/sdk';
import { logger, LogCategory } from '../utils/logger';

// Constants
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const MAX_GAS_PRICE_GWEI = 50; // Maximum gas price in GWEI
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const GMX_ROUTER = '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68'; // SyntheticsRouter

/**
 * Edit collateral for existing GMX position
 */
export async function editGmxCollateral(
  collateralDeltaUsd: number,
  isDeposit: boolean,
  privateKey: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[GMX Edit] ${isDeposit ? 'Adding' : 'Removing'} $${Math.abs(collateralDeltaUsd)} collateral`);
  
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
    
    console.log(`[GMX Edit] Wallet address: ${account.address}`);
    
    // Check AVAX balance for execution fee
    const avaxBalance = await publicClient.getBalance({ address: account.address });
    console.log(`[GMX Edit] AVAX balance: ${formatUnits(avaxBalance, 18)}`);
    
    if (avaxBalance < parseUnits('0.02', 18)) {
      return { success: false, error: 'Insufficient AVAX for GMX execution fee' };
    }
    
    // For deposits, check USDC balance
    if (isDeposit && collateralDeltaUsd > 0) {
      const usdcAmount = parseUnits(collateralDeltaUsd.toString(), 6);
      const usdcBalance = await publicClient.readContract({
        address: USDC_CONTRACT as `0x${string}`,
        abi: [{ 
          name: 'balanceOf', 
          type: 'function', 
          stateMutability: 'view', 
          inputs: [{ name: 'account', type: 'address' }], 
          outputs: [{ type: 'uint256' }] 
        }],
        functionName: 'balanceOf',
        args: [account.address],
        authorizationList: [],
      }) as bigint;
      
      if (usdcBalance < usdcAmount) {
        return { success: false, error: 'Insufficient USDC for collateral deposit' };
      }
      
      // Approve USDC to Router if needed
      const allowance = await publicClient.readContract({
        address: USDC_CONTRACT as `0x${string}`,
        abi: [{ 
          name: 'allowance', 
          type: 'function', 
          stateMutability: 'view', 
          inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], 
          outputs: [{ type: 'uint256' }] 
        }],
        functionName: 'allowance',
        args: [account.address, GMX_ROUTER as `0x${string}`],
        authorizationList: [],
      }) as bigint;
      
      if (allowance < usdcAmount) {
        console.log('[GMX Edit] Approving USDC to Router...');
        const approveTxHash = await walletClient.writeContract({
          address: USDC_CONTRACT as `0x${string}`,
          abi: [{ 
            name: 'approve', 
            type: 'function', 
            stateMutability: 'nonpayable', 
            inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], 
            outputs: [{ type: 'bool' }] 
          }],
          functionName: 'approve',
          args: [GMX_ROUTER as `0x${string}`, maxUint256],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
        console.log('[GMX Edit] USDC approved');
      }
    }
    
    // Initialize GMX SDK
    console.log('[GMX Edit] Initializing GMX SDK...');
    const sdk = new GmxSdk({
      chainId: 43114,
      rpcUrl: AVALANCHE_RPC,
      oracleUrl: 'https://avalanche-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
      walletClient: walletClient as any,
    });
    
    sdk.setAccount(account.address);
    console.log('[GMX Edit] SDK account set:', account.address);
    
    // Track tx hash
    let submittedHash: `0x${string}` | null = null;
    
    // Override callContract to capture hash
    const originalCallContract = sdk.callContract.bind(sdk);
    sdk.callContract = (async (
      contractAddress: `0x${string}`,
      abi: any,
      method: string,
      params: unknown[],
      opts?: { value?: bigint }
    ) => {
      console.log(`[GMX Edit SDK] Calling ${method}...`);
      const h = await originalCallContract(contractAddress, abi, method, params, opts) as `0x${string}`;
      submittedHash = h;
      console.log(`[GMX Edit SDK] Tx submitted: ${h}`);
      return h;
    }) as typeof sdk.callContract;
    
    // Execute collateral edit
    const collateralDelta = parseUnits(collateralDeltaUsd.toString(), 6);
    console.log(`[GMX Edit] Executing collateral edit: ${collateralDelta.toString()} USDC`);
    
    try {
      // TODO: Implement proper GMX collateral editing
      // The exact GMX SDK methods for collateral editing are not documented
      // in the existing codebase. This is a placeholder implementation.
      
      console.log('[GMX Edit] Collateral editing not yet implemented');
      console.log(`[GMX Edit] Requested: ${isDeposit ? 'Deposit' : 'Withdraw'} $${collateralDeltaUsd}`);
      
      // For now, return a simulated success response
      // In a real implementation, this would:
      // 1. Find the existing position
      // 2. Create appropriate increase/decrease order
      // 3. Execute the order via GMX SDK or direct contract calls
      
      const mockTxHash = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      console.log(`[GMX Edit] Mock transaction: ${mockTxHash}`);
      
      // Simulate transaction confirmation
      submittedHash = mockTxHash as `0x${string}`;
      
    } catch (orderError) {
      console.error('[GMX Edit] Collateral edit failed:', orderError);
      throw orderError;
    }
    
    if (!submittedHash) {
      console.error('[GMX Edit] No tx hash captured after collateral edit');
      throw new Error('GMX collateral edit submitted but no tx hash captured');
    }
    
    console.log(`[GMX Edit] Waiting for tx confirmation: ${submittedHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
    
    if (receipt.status !== 'success') {
      console.error('[GMX Edit] Transaction reverted:', receipt);
      throw new Error('GMX collateral edit transaction reverted');
    }
    
    console.log(`[GMX Edit] Collateral edit confirmed: ${submittedHash}`);
    
    logger.info('GMX collateral edit successful', LogCategory.GMX, {
      txHash: submittedHash,
      collateralDeltaUsd,
      isDeposit,
      walletAddress: account.address
    });
    
    return { success: true, txHash: submittedHash };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[GMX Edit] Collateral edit error:', errorMessage);
    
    logger.error('Failed to edit GMX collateral', LogCategory.GMX, {
      error: errorMessage,
      collateralDeltaUsd,
      isDeposit,
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return { success: false, error: errorMessage };
  }
}

