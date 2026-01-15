/**
 * Test Endpoint for Conservative Strategy Flow
 * 
 * This endpoint tests the complete conservative flow:
 * 1. USDC transfer to user wallet
 * 2. AVAX transfer for gas
 * 3. Aave supply execution
 * 
 * Usage:
 * POST /api/square/test-conservative
 * Body: {
 *   "walletAddress": "0x...",
 *   "amount": 10,  // USD amount
 *   "userEmail": "test@example.com",  // Optional, for position tracking
 *   "paymentId": "test-123"  // Optional, auto-generated if not provided
 * }
 * 
 * SECURITY: This should be disabled in production or protected with authentication
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { getRedis } from '../utils/redis';
import { executeAaveFromHubWallet } from './webhook-transfers';

// Import functions from webhook
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const HUB_WALLET_PRIVATE_KEY = process.env.HUB_WALLET_PRIVATE_KEY || '';
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
  console.log(`[Test] [USDC] Sending $${amountUsd} USDC to ${toAddress} for payment ${paymentId}`);

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
    
    console.log(`[Test] [USDC] Transaction submitted: ${tx.hash}`);
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
  console.log(`[Test] [AVAX] Sending ${ethers.formatEther(amount)} AVAX to ${toAddress} for ${purpose}`);

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
    
    // Get current nonce to avoid "replacement transaction underpriced" errors
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    console.log(`[Test] [AVAX] Using nonce: ${nonce}`);
    
    const gasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: amount,
      gasPrice,
      nonce, // Explicitly set nonce
    });
    
    console.log(`[Test] [AVAX] Transaction submitted: ${tx.hash}`);
    console.log(`[Test] [AVAX] Check status at: https://snowtrace.io/tx/${tx.hash}`);
    
    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error('[Test] [AVAX] Transfer error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function executeAaveViaPrivy(
  privyUserId: string,
  walletAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[Test] [AAVE-PRIVY] Supplying $${amountUsd} USDC to Aave via Privy for ${walletAddress}...`);

  if (amountUsd < AAVE_MIN_SUPPLY_USD) {
    return { success: false, error: `Minimum supply is $${AAVE_MIN_SUPPLY_USD}` };
  }

  try {
    let PrivySigner;
    try {
      const privyModule = await import('../utils/privy-signer.js');
      
      if (!(await privyModule.isPrivyAvailable())) {
        const error = await privyModule.getPrivyImportError();
        console.error('[Test] [AAVE-PRIVY] Privy not available:', error?.message);
        return { success: false, error: 'Privy not available' };
      }
      
      PrivySigner = privyModule.PrivySigner;
      console.log(`[Test] [AAVE-PRIVY] PrivySigner imported successfully`);
    } catch (importError) {
      console.error('[Test] [AAVE-PRIVY] Failed to import PrivySigner:', importError);
      return { success: false, error: 'Failed to import PrivySigner' };
    }

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
      console.log('[Test] [AAVE-PRIVY] Approving USDC from Privy wallet...');
      const approveTx = await usdcContract.approve(AAVE_POOL, ethers.MaxUint256);
      const approveReceipt = await approveTx.wait();
      if (approveReceipt?.status !== 1) {
        throw new Error(`USDC approval via Privy failed on-chain. Status: ${approveReceipt?.status}`);
      }
      console.log('[Test] [AAVE-PRIVY] Privy wallet approval confirmed');
    } else {
      console.log('[Test] [AAVE-PRIVY] USDC already approved');
    }

    console.log('[Test] [AAVE-PRIVY] Supplying to pool via Privy...');
    console.log(`[Test] [AAVE-PRIVY] ⚠️ CRITICAL: onBehalfOf=${walletAddress} (user wallet)`);
    
    const supplyTx = await aavePool.supply(
      USDC_CONTRACT,
      usdcAmount,
      walletAddress,
      0
    );

    const receipt = await supplyTx.wait();
    if (receipt?.status !== 1) {
      return { success: false, error: `Aave supply via Privy failed on-chain. Status: ${receipt?.status}` };
    }
    console.log(`[Test] [AAVE-PRIVY] Supply confirmed via Privy: ${supplyTx.hash}`);

    return { success: true, txHash: supplyTx.hash };
  } catch (error) {
    console.error('[Test] [AAVE-PRIVY] Supply error:', error);
    return {
      success: false,
      error: `Aave execution failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  // Security check: Only allow in development or with auth token
  const authToken = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.TEST_CONSERVATIVE_AUTH_TOKEN;
  
  if (expectedToken && authToken !== expectedToken) {
    res.status(401).json({ error: 'Unauthorized. Provide valid auth token.' });
    return;
  }

  // Parse request body
  const { walletAddress, amount, userEmail, paymentId } = req.body;

  // Validate required fields
  if (!walletAddress || !amount) {
    res.status(400).json({ 
      error: 'Missing required fields',
      required: ['walletAddress', 'amount'],
      received: {
        walletAddress: !!walletAddress,
        amount: !!amount,
        userEmail: !!userEmail,
        paymentId: paymentId || 'auto-generated'
      }
    });
    return;
  }

  // Validate wallet address format
  if (!ethers.isAddress(walletAddress)) {
    res.status(400).json({ 
      error: 'Invalid wallet address format. Must be a valid Ethereum address.' 
    });
    return;
  }

  // Validate amount is positive number
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    res.status(400).json({ error: 'amount must be a positive number' });
    return;
  }

  const testPaymentId = paymentId || `test-${Date.now()}`;

  console.log('[Test-Conservative] ===== TESTING CONSERVATIVE FLOW =====');
  console.log('[Test-Conservative] Wallet:', walletAddress);
  console.log('[Test-Conservative] Amount: $' + amountNum);
  console.log('[Test-Conservative] Payment ID:', testPaymentId);
  console.log('[Test-Conservative] User Email:', userEmail || 'not provided');

  try {
    const results: any = {
      transfers: {},
      aave: {},
      summary: {}
    };

    // CONSERVATIVE FLOW: USDC goes directly from hub wallet to Aave savings
    // DO NOT send USDC to user wallet - it goes straight to Aave
    
    // Step 1: Send AVAX for gas (user needs gas for future transactions)
    console.log('[Test-Conservative] Step 1: Sending AVAX for gas...');
    const avaxResult = await sendAvaxTransfer(walletAddress, CONSERVATIVE_AVAX_AMOUNT, 'conservative deposit');
    results.transfers.avax = avaxResult;
    
    if (!avaxResult.success) {
      console.warn('[Test-Conservative] AVAX transfer failed, but continuing with Aave execution...');
    }

    // Step 2: Execute Aave directly from hub wallet
    // This sends USDC from hub wallet directly to Aave, credited to user wallet
    // USDC does NOT go to user's regular wallet balance - it goes straight to Aave savings
    console.log('[Test-Conservative] Step 2: Executing Aave supply from hub wallet...');
    console.log('[Test-Conservative] 🏦 USDC will go directly from hub wallet to Aave savings (not to user wallet)');
    console.log('[Test-Conservative] ⚠️ User wallet will receive aTokens, not USDC');
    
    const aaveResult = await executeAaveFromHubWallet(walletAddress, amountNum, testPaymentId);
    results.aave = aaveResult;
    
    // Note: No USDC transfer to user wallet - USDC goes directly to Aave
    results.transfers.usdc = {
      success: true,
      message: 'USDC sent directly to Aave savings (not to user wallet)',
      aaveTxHash: aaveResult.success ? aaveResult.data.txHash : undefined
    };

    // Summary
    results.summary = {
      avaxTransferred: avaxResult.success,
      aaveExecuted: aaveResult.success,
      usdcToAave: aaveResult.success, // USDC went directly to Aave (not to wallet)
      allStepsCompleted: avaxResult.success && aaveResult.success
    };

    console.log('[Test-Conservative] ===== TEST COMPLETE =====');
    console.log('[Test-Conservative] Results:', JSON.stringify(results, null, 2));

    if (results.summary.allStepsCompleted) {
      return res.status(200).json({
        success: true,
        message: 'Conservative flow test completed successfully',
        results
      });
    } else {
      return res.status(200).json({
        success: false,
        message: 'Conservative flow test completed with some failures',
        results
      });
    }
  } catch (error) {
    console.error('[Test-Conservative] Exception:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default handler;

