/**
 * Conservative Flow Fix
 * 
 * This script fixes the conservative flow to ensure both AVAX and Aave transfers are initiated
 * by the webhook. The main issues identified:
 * 
 * 1. Idempotency checks might prevent processing
 * 2. Amount calculation might fail and skip processing
 * 3. Error handling might be too strict
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { Redis } from '@upstash/redis';

// Configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const HUB_WALLET_PRIVATE_KEY = process.env.HUB_WALLET_PRIVATE_KEY || '';
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const CONSERVATIVE_AVAX_AMOUNT = ethers.parseUnits('0.005', 18);
const AAVE_POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';

// Helper functions
function centsToDollars(cents: number): number {
  return cents / 100;
}

function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

function centsToUsdcMicrounits(cents: number): bigint {
  return BigInt(cents * 10_000); // 6 decimals for USDC
}

async function getRedis(): Promise<Redis> {
  const url = process.env.KV_REST_API_URL || process.env.REDIS_URL;
  const token = process.env.KV_REST_API_TOKEN;
  
  if (!url || !token) {
    throw new Error('Redis configuration missing');
  }
  
  return new Redis({ url, token });
}

// Transfer functions (simplified versions)
async function sendAvaxTransfer(
  toAddress: string,
  amount: bigint,
  purpose: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[AVAX-FIX] Sending ${ethers.formatEther(amount)} AVAX to ${toAddress} for ${purpose}`);

  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`[AVAX-FIX] Hub AVAX balance: ${ethers.formatEther(balance)}`);
    
    if (balance < amount) {
      console.error(`[AVAX-FIX] Insufficient AVAX balance`);
      return { success: false, error: 'Insufficient AVAX in hub wallet' };
    }
    
    // Send transaction
    const gasPrice = await provider.getFeeData();
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: amount,
      gasPrice: gasPrice.gasPrice,
    });
    
    console.log(`[AVAX-FIX] Transaction submitted: ${tx.hash}`);
    const receipt = await tx.wait(1);
    
    if (!receipt || receipt.status !== 1) {
      console.error(`[AVAX-FIX] Transaction failed: ${tx.hash}`);
      return { success: false, error: 'Transaction failed on-chain' };
    }
    
    console.log(`[AVAX-FIX] ✅ AVAX sent successfully: ${tx.hash}`);
    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error('[AVAX-FIX] Transfer error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function executeAaveFromHubWallet(
  walletAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[AAVE-FIX] Supplying $${amountUsd} USDC to Aave from hub wallet for ${walletAddress}...`);

  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const hubWallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    
    // Contracts
    const ERC20_ABI = [
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function transfer(address to, uint256 amount) returns (bool)'
    ];
    
    const AAVE_POOL_ABI = [
      'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)'
    ];
    
    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, hubWallet);
    const aavePool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, hubWallet);
    
    // Convert amount
    const amountCents = dollarsToCents(amountUsd);
    const usdcAmount = centsToUsdcMicrounits(amountCents);
    
    // Check balance
    const balance = await usdcContract.balanceOf(hubWallet.address);
    console.log(`[AAVE-FIX] Hub USDC balance: ${Number(balance) / 1_000_000} USDC`);
    
    if (balance < usdcAmount) {
      return {
        success: false,
        error: `Insufficient USDC. Have: ${Number(balance) / 1_000_000}, Need: ${amountUsd}`
      };
    }
    
    // Check allowance
    const allowance = await usdcContract.allowance(hubWallet.address, AAVE_POOL);
    if (allowance < usdcAmount) {
      console.log('[AAVE-FIX] Approving USDC for Aave...');
      const approveTx = await usdcContract.approve(AAVE_POOL, ethers.MaxUint256);
      const approveReceipt = await approveTx.wait();
      if (approveReceipt?.status !== 1) {
        throw new Error('USDC approval failed');
      }
      console.log('[AAVE-FIX] ✅ USDC approved');
    }
    
    // Supply to Aave
    console.log('[AAVE-FIX] Supplying to Aave...');
    const supplyTx = await aavePool.supply(
      USDC_CONTRACT,
      usdcAmount,
      walletAddress, // onBehalfOf
      0 // referral code
    );
    
    const receipt = await supplyTx.wait();
    if (receipt?.status !== 1) {
      throw new Error('Aave supply failed');
    }
    
    console.log(`[AAVE-FIX] ✅ Aave supply successful: ${supplyTx.hash}`);
    return { success: true, txHash: supplyTx.hash };
  } catch (error) {
    console.error('[AAVE-FIX] Supply error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Main handler for testing conservative flow
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { walletAddress, amount, paymentId, force = false } = req.body;

  // Validate inputs
  if (!walletAddress || !amount) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: ['walletAddress', 'amount']
    });
  }

  if (!ethers.isAddress(walletAddress)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  const testPaymentId = paymentId || `fix-test-${Date.now()}`;
  console.log('[CONSERVATIVE-FIX] ===== TESTING CONSERVATIVE FLOW =====');
  console.log('[CONSERVATIVE-FIX] Wallet:', walletAddress);
  console.log('[CONSERVATIVE-FIX] Amount: $' + amount);
  console.log('[CONSERVATIVE-FIX] Payment ID:', testPaymentId);
  console.log('[CONSERVATIVE-FIX] Force:', force);

  try {
    // Check idempotency (unless force=true)
    if (!force) {
      const redis = await getRedis();
      const transferKey = `conservative_flow_executed:${testPaymentId}`;
      const existing = await redis.get(transferKey);
      
      if (existing) {
        console.log('[CONSERVATIVE-FIX] Transfers already processed for payment:', testPaymentId);
        return res.status(200).json({
          success: true,
          message: 'Transfers already processed',
          paymentId: testPaymentId
        });
      }
      
      // Set idempotency key
      await redis.set(transferKey, '1', { ex: 3600 }); // 1 hour TTL
    }

    const results: {
      avax: { success: boolean; txHash?: string; error?: string };
      aave: { success: boolean; txHash?: string; error?: string };
      summary: {
        avaxSent: boolean;
        aaveExecuted: boolean;
        bothSuccessful: boolean;
        avaxTxHash?: string;
        aaveTxHash?: string;
      };
    } = {
      avax: { success: false },
      aave: { success: false },
      summary: {
        avaxSent: false,
        aaveExecuted: false,
        bothSuccessful: false
      }
    };

    // Step 1: Send AVAX for gas
    console.log('[CONSERVATIVE-FIX] Step 1: Sending AVAX for gas...');
    const avaxResult = await sendAvaxTransfer(walletAddress, CONSERVATIVE_AVAX_AMOUNT, 'conservative deposit');
    results.avax = avaxResult;

    // Step 2: Execute Aave directly from hub wallet
    console.log('[CONSERVATIVE-FIX] Step 2: Executing Aave supply from hub wallet...');
    const aaveResult = await executeAaveFromHubWallet(walletAddress, amount, testPaymentId);
    results.aave = aaveResult;

    // Summary
    results.summary = {
      avaxSent: avaxResult.success,
      aaveExecuted: aaveResult.success,
      bothSuccessful: avaxResult.success && aaveResult.success,
      avaxTxHash: avaxResult.txHash,
      aaveTxHash: aaveResult.txHash
    };

    console.log('[CONSERVATIVE-FIX] ===== RESULTS =====');
    console.log('[CONSERVATIVE-FIX] AVAX Transfer:', avaxResult.success ? '✅ Success' : '❌ Failed');
    console.log('[CONSERVATIVE-FIX] Aave Supply:', aaveResult.success ? '✅ Success' : '❌ Failed');
    console.log('[CONSERVATIVE-FIX] Both Successful:', results.summary.bothSuccessful ? '✅ Yes' : '❌ No');

    return res.status(200).json({
      success: true,
      message: 'Conservative flow test complete',
      results
    });

  } catch (error) {
    console.error('[CONSERVATIVE-FIX] Test failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
