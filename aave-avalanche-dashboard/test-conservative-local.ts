/**
 * Local test script for conservative flow
 * Run with: npx tsx test-conservative-local.ts
 */

import { ethers } from 'ethers';

// Configuration
const WALLET_ADDRESS = '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67'; // Your logged-in wallet
const AMOUNT = 10; // $10 test payment
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
// Strip quotes from env var if present
const HUB_WALLET_PRIVATE_KEY = (process.env.HUB_WALLET_PRIVATE_KEY || '').replace(/^["']|["']$/g, '');
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const CONSERVATIVE_AVAX_AMOUNT = ethers.parseUnits('0.005', 18);
const AAVE_POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const AAVE_MIN_SUPPLY_USD = 1;
const MAX_GAS_PRICE_GWEI = 50;

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    outputs: [{ type: 'uint256' }]
  }
];

const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

async function sendUsdcTransfer(
  toAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[Test] [USDC] Sending $${amountUsd} USDC to ${toAddress}...`);

  if (!ethers.isAddress(toAddress)) {
    return { success: false, error: `Invalid address: ${toAddress}` };
  }

  if (!HUB_WALLET_PRIVATE_KEY) {
    return { success: false, error: 'HUB_WALLET_PRIVATE_KEY not configured' };
  }

  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, wallet);
    
    const balance = await usdcContract.balanceOf(wallet.address);
    const balanceFormatted = Number(balance) / 1_000_000;
    console.log(`[Test] [USDC] Hub USDC balance: ${balanceFormatted} USDC`);
    
    const usdcAmount = BigInt(Math.floor(amountUsd * 1_000_000));
    console.log(`[Test] [USDC] Transfer amount: ${usdcAmount} units (${amountUsd} USDC)`);
    
    if (balance < usdcAmount) {
      return { success: false, error: `Insufficient USDC balance. Have: ${balanceFormatted}, Need: ${amountUsd}` };
    }
    
    const gasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const tx = await usdcContract.transfer(toAddress, usdcAmount, { gasPrice });
    
    console.log(`[Test] [USDC] ✅ Transaction submitted: ${tx.hash}`);
    console.log(`[Test] [USDC] Check status at: https://snowtrace.io/tx/${tx.hash}`);
    
    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error('[Test] [USDC] Transfer error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sendAvaxTransfer(
  toAddress: string,
  amount: bigint,
  purpose: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[Test] [AVAX] Sending ${ethers.formatEther(amount)} AVAX to ${toAddress} for ${purpose}...`);

  if (!HUB_WALLET_PRIVATE_KEY) {
    return { success: false, error: 'HUB_WALLET_PRIVATE_KEY not configured' };
  }

  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    
    const balance = await provider.getBalance(wallet.address);
    console.log(`[Test] [AVAX] Hub AVAX balance: ${ethers.formatEther(balance)}`);
    
    if (balance < amount) {
      return { success: false, error: 'Insufficient AVAX in hub wallet' };
    }
    
    // Get current nonce to avoid conflicts
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    const gasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: amount,
      gasPrice,
      nonce,
    });
    
    console.log(`[Test] [AVAX] ✅ Transaction submitted: ${tx.hash}`);
    console.log(`[Test] [AVAX] Check status at: https://snowtrace.io/tx/${tx.hash}`);
    
    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error('[Test] [AVAX] Transfer error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getPrivyUserId(walletAddress: string): Promise<string | null> {
  try {
    const { getRedis } = await import('./api/utils/redis.js');
    const redis = await getRedis();
    const walletKey = `wallet_owner:${walletAddress.toLowerCase()}`;
    const privyUserId = await redis.get(walletKey) as string | null;
    
    return privyUserId;
  } catch (error) {
    console.warn('[Test] Failed to get Privy user ID:', error);
    return null;
  }
}

async function executeAaveViaPrivy(
  privyUserId: string,
  walletAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[Test] [AAVE-PRIVY] Supplying $${amountUsd} USDC to Aave via Privy...`);

  if (amountUsd < AAVE_MIN_SUPPLY_USD) {
    return { success: false, error: `Minimum supply is $${AAVE_MIN_SUPPLY_USD}` };
  }

  try {
    const privyModule = await import('./api/utils/privy-signer.js');
    
    if (!(await privyModule.isPrivyAvailable())) {
      return { success: false, error: 'Privy not available' };
    }
    
    const PrivySigner = privyModule.PrivySigner;
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const privySigner = new PrivySigner(privyUserId, walletAddress, provider);

    console.log(`[Test] [AAVE-PRIVY] Created PrivySigner for wallet ${walletAddress}`);

    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, privySigner);
    const aavePool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, privySigner);
    const usdcAmount = BigInt(Math.floor(amountUsd * 1_000_000));

    const balance = await usdcContract.balanceOf(walletAddress);
    const balanceFormatted = Number(balance) / 1_000_000;
    console.log(`[Test] [AAVE-PRIVY] Privy wallet USDC balance: ${balanceFormatted} USDC`);

    if (balance < usdcAmount) {
      return {
        success: false,
        error: `Insufficient USDC in Privy wallet. Have: ${balanceFormatted}, Need: ${amountUsd}`
      };
    }

    const allowance = await usdcContract.allowance(walletAddress, AAVE_POOL);
    if (allowance < usdcAmount) {
      console.log('[Test] [AAVE-PRIVY] Approving USDC...');
      const approveTx = await usdcContract.approve(AAVE_POOL, ethers.MaxUint256);
      const approveReceipt = await approveTx.wait();
      if (approveReceipt?.status !== 1) {
        throw new Error(`USDC approval failed. Status: ${approveReceipt?.status}`);
      }
      console.log('[Test] [AAVE-PRIVY] ✅ Approval confirmed');
    } else {
      console.log('[Test] [AAVE-PRIVY] USDC already approved');
    }

    console.log('[Test] [AAVE-PRIVY] Supplying to Aave pool...');
    const supplyTx = await aavePool.supply(USDC_CONTRACT, usdcAmount, walletAddress, 0);

    const receipt = await supplyTx.wait();
    if (receipt?.status !== 1) {
      return { success: false, error: `Aave supply failed. Status: ${receipt?.status}` };
    }
    console.log(`[Test] [AAVE-PRIVY] ✅ Supply confirmed: ${supplyTx.hash}`);

    return { success: true, txHash: supplyTx.hash };
  } catch (error) {
    console.error('[Test] [AAVE-PRIVY] Error:', error);
    return {
      success: false,
      error: `Aave execution failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function main() {
  console.log('==========================================');
  console.log('Testing Conservative Payment Flow');
  console.log('==========================================');
  console.log('Wallet:', WALLET_ADDRESS);
  console.log('Amount: $' + AMOUNT);
  console.log('');

  const paymentId = `test-${Date.now()}`;
  const results: any = {};

  try {
    // Step 1: Send AVAX for gas
    console.log('[Test] Step 1: Sending AVAX for gas...');
    const avaxResult = await sendAvaxTransfer(WALLET_ADDRESS, CONSERVATIVE_AVAX_AMOUNT, 'conservative deposit');
    results.avax = avaxResult;
    
    if (avaxResult.success) {
      console.log('[Test] ✅ AVAX transfer successful\n');
    } else {
      console.error('[Test] ❌ AVAX transfer failed:', avaxResult.error);
    }

    // Step 2: Execute Aave directly from hub wallet
    // USDC goes straight to Aave savings, not to wallet balance
    console.log('[Test] Step 2: Executing Aave directly from hub wallet...');
    console.log('[Test] USDC will go directly to Aave savings (not to wallet balance)');
    
    const { executeAaveFromHubWallet } = await import('./api/square/webhook-transfers.js');
    const aaveResult = await executeAaveFromHubWallet(WALLET_ADDRESS, AMOUNT, paymentId);
    results.aave = aaveResult;
    
    if (aaveResult.success) {
      console.log('[Test] ✅ Aave supply successful');
      console.log('[Test] ✅ USDC went directly to Aave savings');
      console.log('[Test] Transaction:', aaveResult.data.txHash);
      console.log('[Test] Check status at: https://snowtrace.io/tx/' + aaveResult.data.txHash + '\n');
    } else {
      console.error('[Test] ❌ Aave supply failed:', aaveResult.error);
    }

    // Summary
    console.log('==========================================');
    console.log('Test Results Summary:');
    console.log('==========================================');
    console.log(JSON.stringify(results, null, 2));
    console.log('');
    console.log('Verify on Snowtrace:');
    console.log(`  Wallet: https://snowtrace.io/address/${WALLET_ADDRESS}`);
    if (results.usdc?.txHash) {
      console.log(`  USDC: https://snowtrace.io/tx/${results.usdc.txHash}`);
    }
    if (results.avax?.txHash) {
      console.log(`  AVAX: https://snowtrace.io/tx/${results.avax.txHash}`);
    }
    if (results.aave?.txHash || results.aaveRetry?.txHash) {
      const tx = results.aave?.txHash || results.aaveRetry?.txHash;
      console.log(`  Aave: https://snowtrace.io/tx/${tx}`);
    }

  } catch (error) {
    console.error('[Test] Exception:', error);
  }
}

main().catch(console.error);


