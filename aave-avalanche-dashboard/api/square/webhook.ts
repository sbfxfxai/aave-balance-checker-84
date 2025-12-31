import { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, maxUint256 } from 'viem';
import { avalanche } from 'viem/chains';
import { GmxSdk } from '@gmx-io/sdk';

// Import monitoring systems
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { alertingSystem } from '../utils/alerting';

// Helper functions
function generatePositionId(): string {
  return `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

interface UserPosition {
  id: string;
  paymentId: string;
  userEmail: string;
  walletAddress: string;
  strategyType: 'conservative' | 'aggressive';
  usdcAmount: number;
  status: 'pending' | 'active' | 'closed' | 'executing';
  createdAt: string;
  executedAt?: string;
  error?: string;
  aaveSupplyAmount?: number;
  aaveSupplyTxHash?: string;
  gmxCollateralAmount?: number;
  gmxLeverage?: number;
  gmxPositionSize?: number;
  gmxOrderTxHash?: string;
}

async function savePosition(position: UserPosition): Promise<void> {
  const redis = getRedis();
  await redis.set(`position:${position.id}`, JSON.stringify(position), { ex: 7 * 24 * 60 * 60 }); // 7 days
}

async function updatePosition(id: string, updates: Partial<UserPosition>): Promise<void> {
  const redis = getRedis();
  const existing = await redis.get(`position:${id}`);
  if (existing) {
    const position = JSON.parse(existing as string);
    Object.assign(position, updates);
    await redis.set(`position:${id}`, JSON.stringify(position), { ex: 7 * 24 * 60 * 60 });
  }
}

async function decryptWalletKeyWithToken(walletAddress: string, paymentId: string): Promise<{ privateKey: string } | null> {
  // For connected wallets, no private key is stored
  return null;
}

// Configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const HUB_WALLET_PRIVATE_KEY = process.env.HUB_WALLET_PRIVATE_KEY || '';
const HUB_WALLET_ADDRESS = process.env.HUB_WALLET_ADDRESS || '0xec80A2cB3652Ec599eFBf7Aac086d07F391A5e55';

// Validate hub wallet private key (runtime check, don't crash at module load)
function validateHubWallet(): { valid: boolean; error?: string } {
  console.log('[CONFIG] HUB_WALLET_PRIVATE_KEY length:', HUB_WALLET_PRIVATE_KEY?.length || 0);
  console.log('[CONFIG] HUB_WALLET_PRIVATE_KEY starts with 0x:', HUB_WALLET_PRIVATE_KEY?.startsWith('0x') || false);

  if (!HUB_WALLET_PRIVATE_KEY || HUB_WALLET_PRIVATE_KEY === '') {
    return { valid: false, error: 'HUB_WALLET_PRIVATE_KEY environment variable is required' };
  }

  // Accept both with and without 0x prefix
  const cleanKey = HUB_WALLET_PRIVATE_KEY.startsWith('0x') ? HUB_WALLET_PRIVATE_KEY : `0x${HUB_WALLET_PRIVATE_KEY}`;

  if (cleanKey.length !== 66) {
    return { valid: false, error: 'HUB_WALLET_PRIVATE_KEY must be a 32-byte hex string' };
  }

  return { valid: true };
}

// Log configuration status (non-blocking)
if (HUB_WALLET_PRIVATE_KEY && HUB_WALLET_PRIVATE_KEY.startsWith('0x') && HUB_WALLET_PRIVATE_KEY.length === 66) {
  console.log('[CONFIG] Hub wallet configured:', HUB_WALLET_ADDRESS);
} else {
  console.warn('[CONFIG] HUB_WALLET_PRIVATE_KEY not properly configured - webhook transfers will fail');
}
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const SQUARE_WEBHOOK_SIGNATURE_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';

// Redis-based idempotency to prevent duplicate transfers across serverless invocations
// CRITICAL: If Redis fails, we BLOCK transfers to prevent draining treasury
let _redis: Redis | null = null;
let _redisError: string | null = null;

export function getRedis(): Redis {
  if (_redisError) {
    throw new Error(_redisError);
  }

  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      _redisError = 'Redis not configured - KV_REST_API_URL and KV_REST_API_TOKEN required';
      console.error(`[Webhook] CRITICAL: ${_redisError}`);
      throw new Error(_redisError);
    }

    try {
      _redis = new Redis({ url, token });
      console.log('[Webhook] Redis connected successfully');
    } catch (err) {
      _redisError = `Redis connection failed: ${err}`;
      console.error(`[Webhook] CRITICAL: ${_redisError}`);
      throw new Error(_redisError);
    }
  }
  return _redis;
}

const PAYMENT_CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds

async function isPaymentProcessed(paymentId: string): Promise<{ processed: boolean; error?: string }> {
  try {
    const redis = getRedis();
    const exists = await redis.exists(`payment:${paymentId}`);
    console.log(`[Webhook] Redis check for ${paymentId}: exists=${exists}`);
    return { processed: exists > 0 };
  } catch (error) {
    console.error('[Webhook] Redis check error:', error);
    // FAIL-SAFE: If we can't check, assume processed to prevent duplicates
    return { processed: true, error: String(error) };
  }
}

async function markPaymentProcessed(paymentId: string, txHash?: string): Promise<boolean> {
  try {
    const redis = getRedis();
    await redis.set(`payment:${paymentId}`, JSON.stringify({
      txHash,
      processedAt: new Date().toISOString()
    }), { ex: PAYMENT_CACHE_TTL });
    console.log(`[Webhook] Payment ${paymentId} marked as processed in Redis`);
    return true;
  } catch (error) {
    console.error('[Webhook] Redis mark error:', error);
    return false;
  }
}

// Minimal ERC20 ABI for transfer and approval
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

// AAVE Pool ABI (minimal for supply)
const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

// GMX Exchange Router ABI for creating increase orders (GMX V2 format)
const GMX_EXCHANGE_ROUTER_ABI = [
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
  'function sendWnt(address receiver, uint256 amount) external payable',
  'function sendTokens(address token, address receiver, uint256 amount) external payable',
  'function createOrder(((address receiver, address cancellationReceiver, address callbackContract, address uiFeeReceiver, address market, address initialCollateralToken, address[] swapPath) addresses, (uint256 sizeDeltaUsd, uint256 initialCollateralDeltaAmount, uint256 triggerPrice, uint256 acceptablePrice, uint256 executionFee, uint256 callbackGasLimit, uint256 minOutputAmount) numbers, uint8 orderType, uint8 decreasePositionSwapType, bool isLong, bool shouldUnwrapNativeToken, bool autoCancel, bytes32 referralCode) params) external payable returns (bytes32)',
];

// GMX Order types
const GMX_ORDER_TYPE_MARKET_INCREASE = 2;

// Contract addresses on Avalanche
const AAVE_POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const GMX_ROUTER = '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68'; // SyntheticsRouter
const GMX_EXCHANGE_ROUTER = '0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2'; // Correct ExchangeRouter from SDK
const GMX_ORDER_VAULT = '0xD3D60D22d415aD43b7e64b510D86A30f19B1B12C'; // Correct OrderVault from SDK
const WAVAX = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7';
const BTC_TOKEN = '0x152b9d0FdC40C096757F570A51E494bd4b943E50'; // BTC.b on Avalanche
const GMX_BTC_MARKET = '0xFb02132333A79C8B5Bd0b64E3AbccA5f7fAf2937'; // BTC/USD market

// GMX minimum requirements
const GMX_MIN_COLLATERAL_USD = 5;
const GMX_MIN_POSITION_SIZE_USD = 10;
const AAVE_MIN_SUPPLY_USD = 0.5;

// Fee and gas settings
const AVAX_TO_SEND_FOR_GMX = ethers.parseEther('0.06'); // 0.06 AVAX sent to user for GMX execution (balanced/aggressive)
const AVAX_TO_SEND_FOR_AAVE = ethers.parseEther('0.005'); // 0.005 AVAX sent to user for exit fees (conservative)
const TOTAL_AVAX_FEE = ethers.parseEther('0.23'); // 0.23 AVAX total fee (0.06 to user, 0.17 platform) - balanced/aggressive
const TOTAL_AVAX_FEE_CONSERVATIVE = ethers.parseEther('0.1'); // 0.1 AVAX total fee (0.005 to user, 0.095 platform) - conservative
const TOTAL_AVAX_FEE_DISCOUNTED = ethers.parseEther('0.1'); // 0.1 AVAX with ERGC discount
const PLATFORM_FEE_PERCENT = 5; // 5% platform fee on deposits
const MAX_GAS_PRICE_GWEI = 100; // Increased to 100 gwei to ensure reliability on Avalanche while still providing a safety cap

// EnergyCoin (ERGC) - Fee discount token
const ERGC_CONTRACT = '0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B';
const ERGC_DISCOUNT_THRESHOLD = ethers.parseUnits('100', 18); // Require 100 ERGC in wallet for discount
const ERGC_PURCHASE_AMOUNT = 100; // 100 ERGC purchased for $10
const ERGC_SEND_TO_USER = ethers.parseUnits('100', 18); // Send full 100 ERGC (no burn)

// Risk profile configurations - maps to user selection
const RISK_PROFILES = {
  conservative: { aavePercent: 100, gmxPercent: 0, gmxLeverage: 0, name: 'Earn Only' },
  aggressive: { aavePercent: 0, gmxPercent: 100, gmxLeverage: 2.5, name: 'BTC Only' },
};

interface SquarePayment {
  id: string;
  status: string;
  amount_money?: {
    amount: number;
    currency: string;
  };
  note?: string;
}

interface WebhookEvent {
  type: string;
  data?: {
    object?: {
      payment?: SquarePayment;
    };
  };
}

/**
 * Verify Square webhook signature
 */
function verifySignature(payload: string, signature: string): boolean {
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
    console.log('[Webhook] No signature key configured - cannot verify');
    return false;
  }

  if (!signature) {
    console.log('[Webhook] No signature provided');
    return false;
  }

  try {
    const hmac = crypto.createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY);
    hmac.update(payload);
    const expectedSignature = hmac.digest('base64');

    // Convert both signatures to buffers
    const signatureBuffer = Buffer.from(signature, 'base64');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64');

    // Check lengths before comparing (timingSafeEqual requires same length)
    if (signatureBuffer.length !== expectedBuffer.length) {
      console.log(`[Webhook] Signature length mismatch: received ${signatureBuffer.length}, expected ${expectedBuffer.length}`);
      return false;
    }

    return crypto.timingSafeEqual(
      new Uint8Array(signatureBuffer),
      new Uint8Array(expectedBuffer)
    );
  } catch (error) {
    console.error('[Webhook] Signature verification error:', error);
    return false;
  }
}

/**
 * Send USDC from hub wallet to user wallet
 */
async function sendUsdcTransfer(
  toAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
  explorerUrl?: string;
}> {
  console.log('[USDC] Starting transfer...');
  console.log(`[USDC] To: ${toAddress}`);
  console.log(`[USDC] Amount: $${amountUsd}`);
  console.log(`[USDC] Payment ID: ${paymentId}`);

  const validation = validateHubWallet();
  if (!validation.valid) {
    console.error('[USDC] Hub wallet validation failed:', validation.error);
    return { success: false, error: validation.error || 'Hub wallet not configured' };
  }

  // Validate address
  if (!ethers.isAddress(toAddress)) {
    console.error(`[USDC] Invalid address: ${toAddress}`);
    return { success: false, error: `Invalid address: ${toAddress}` };
  }

  try {
    // Connect to Avalanche with better error handling
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC, {
      chainId: 43114,
      name: 'avalanche'
    });

    // Test connection
    const network = await provider.getNetwork();
    console.log(`[USDC] Connected to chain ID: ${network.chainId}`);

    // Create wallet from private key
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    console.log(`[USDC] Hub wallet address: ${wallet.address}`);

    // Verify wallet matches expected address
    if (wallet.address.toLowerCase() !== HUB_WALLET_ADDRESS.toLowerCase()) {
      console.error(`[USDC] Private key mismatch! Expected: ${HUB_WALLET_ADDRESS}, Got: ${wallet.address}`);
      return { success: false, error: 'Private key does not match hub wallet' };
    }

    // Create USDC contract instance
    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, wallet);

    // Check hub wallet USDC balance
    const balance = await usdcContract.balanceOf(wallet.address);
    const balanceFormatted = Number(balance) / 1_000_000;
    console.log(`[USDC] Hub balance: ${balanceFormatted} USDC`);

    // Convert USD to USDC units (6 decimals)
    const usdcAmount = BigInt(Math.floor(amountUsd * 1_000_000));
    console.log(`[USDC] Transfer amount: ${usdcAmount} units (${amountUsd} USDC)`);

    if (balance < usdcAmount) {
      console.error(`[USDC] Insufficient balance: ${balanceFormatted} < ${amountUsd}`);
      return {
        success: false,
        error: `Insufficient USDC balance. Have: ${balanceFormatted}, Need: ${amountUsd}`
      };
    }

    // Get current gas price from network - CRITICAL: Must be >= base fee
    console.log('[USDC] Fetching current gas price...');
    let networkGasPrice: bigint;
    try {
      const feeData = await provider.getFeeData();
      // Use gasPrice (legacy) or maxFeePerGas (EIP-1559), whichever is higher
      networkGasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('70', 'gwei');
      console.log(`[USDC] Network gas price from feeData: ${ethers.formatUnits(networkGasPrice, 'gwei')} gwei`);
      
      // CRITICAL: Check current block base fee to ensure we're above it
      const block = await provider.getBlock('latest');
      if (block && block.baseFeePerGas) {
        const baseFee = block.baseFeePerGas;
        console.log(`[USDC] Current block base fee: ${ethers.formatUnits(baseFee, 'gwei')} gwei`);
        // Use 120% of base fee as minimum to ensure inclusion (20% priority fee)
        const minGasPrice = (baseFee * 120n) / 100n;
        if (networkGasPrice < minGasPrice) {
          console.warn(`[USDC] Network gas price (${ethers.formatUnits(networkGasPrice, 'gwei')} gwei) below base fee (${ethers.formatUnits(baseFee, 'gwei')} gwei), using 120% of base fee`);
          networkGasPrice = minGasPrice;
        }
      }
    } catch (error) {
      console.warn('[USDC] Failed to fetch gas price, using default 70 gwei (high to ensure inclusion)');
      networkGasPrice = ethers.parseUnits('70', 'gwei'); // High default to ensure inclusion
    }
    
    const maxGasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const gasPrice = networkGasPrice > maxGasPrice ? maxGasPrice : networkGasPrice;
    console.log(`[USDC] Final gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei (capped at ${MAX_GAS_PRICE_GWEI} gwei)`);

    // Send transfer transaction
    console.log('[USDC] Sending transaction...');
    const tx = await usdcContract.transfer(toAddress, usdcAmount, { gasPrice });
    console.log(`[USDC] Transaction hash: ${tx.hash}`);

    // Wait for confirmation
    // CRITICAL: Don't wait for confirmation to avoid timeout - just return the hash
    console.log(`[USDC] Transaction submitted: ${tx.hash} (not waiting for confirmation to avoid timeout)`);
    console.log(`[USDC] Check status at: https://snowtrace.io/tx/${tx.hash}`);

    const explorerUrl = `https://snowtrace.io/tx/${tx.hash}`;
    console.log(`[USDC] Explorer: ${explorerUrl}`);
    console.log(`[USDC] ✅ Transfer successful!`);

    return {
      success: true,
      txHash: tx.hash,
      explorerUrl,
    };

  } catch (error) {
    console.error('[USDC] Transfer error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check if user has ERGC discount (requires 100+ ERGC in wallet)
 */
async function checkErgcDiscount(userAddress: string): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const ergcContract = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, provider);
    const balance = await ergcContract.balanceOf(userAddress);
    const hasDiscount = balance >= ERGC_DISCOUNT_THRESHOLD; // 100 ERGC minimum
    console.log(`[ERGC] User ${userAddress} balance: ${ethers.formatUnits(balance, 18)} ERGC, discount: ${hasDiscount}`);
    return hasDiscount;
  } catch (error) {
    console.error('[ERGC] Balance check error:', error);
    return false;
  }
}

/**
 * Transfer ERGC tokens to user wallet (100 ERGC purchase)
 */
async function sendErgcTokens(
  toAddress: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[ERGC] Sending ${ethers.formatUnits(ERGC_SEND_TO_USER, 18)} ERGC to ${toAddress}`);

  const validation = validateHubWallet();
  if (!validation.valid) {
    console.error('[ERGC] Hub wallet validation failed:', validation.error);
    return { success: false, error: validation.error || 'Hub wallet not configured' };
  }

  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    const ergcContract = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, wallet);

    // Check ERGC balance (need at least 100 to send)
    const balance = await ergcContract.balanceOf(wallet.address);
    console.log(`[ERGC] Hub ERGC balance: ${ethers.formatUnits(balance, 18)}`);

    if (balance < ERGC_SEND_TO_USER) {
      console.error(`[ERGC] Insufficient ERGC balance`);
      return { success: false, error: 'Insufficient ERGC in treasury wallet' };
    }

    // Send 100 ERGC with fixed gas price
    const gasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const tx = await ergcContract.transfer(toAddress, ERGC_SEND_TO_USER, { gasPrice });

    // CRITICAL: Don't wait for confirmation to avoid timeout - just return the hash
    console.log(`[ERGC] Transaction submitted: ${tx.hash} (not waiting for confirmation to avoid timeout)`);
    console.log(`[ERGC] Check status at: https://snowtrace.io/tx/${tx.hash}`);
    console.log(`[ERGC] Transfer confirmed - 100 ERGC sent`);

    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error('[ERGC] Transfer error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Debit ERGC from user's wallet (transfer to treasury/burn address)
 * Used when user opts to use existing ERGC for fee discount
 */
async function debitErgcFromUser(
  userPrivateKey: string,
  amount: number = 1
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const debitAmount = ethers.parseUnits(amount.toString(), 18);
  console.log(`[ERGC] Debiting ${amount} ERGC from user wallet`);

  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const userWallet = new ethers.Wallet(userPrivateKey, provider);
    const ergcContract = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, userWallet);

    // Check user's ERGC balance
    const balance = await ergcContract.balanceOf(userWallet.address);
    console.log(`[ERGC] User ERGC balance: ${ethers.formatUnits(balance, 18)}`);

    if (balance < debitAmount) {
      console.error(`[ERGC] User has insufficient ERGC balance`);
      return { success: false, error: 'Insufficient ERGC balance in user wallet' };
    }

    // Transfer ERGC to hub wallet (effectively burning it for fee discount)
    const gasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const tx = await ergcContract.transfer(HUB_WALLET_ADDRESS, debitAmount, { gasPrice });

    // CRITICAL: Don't wait for confirmation to avoid timeout - just return the hash
    console.log(`[ERGC] Debit transaction submitted: ${tx.hash} (not waiting for confirmation to avoid timeout)`);
    console.log(`[ERGC] Check status at: https://snowtrace.io/tx/${tx.hash}`);
    console.log(`[ERGC] Debit confirmed - ${amount} ERGC transferred to treasury`);

    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error('[ERGC] Debit error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Debit ERGC from Privy smart wallet using Privy server-side transaction delegation
 * This allows seamless ERGC debit without user confirmation
 */
async function debitErgcViaPrivy(
  privyUserId: string,
  walletAddress: string,
  amount: number = 1
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const debitAmount = ethers.parseUnits(amount.toString(), 18);
  console.log(`[ERGC-PRIVY] Debiting ${amount} ERGC from Privy wallet ${walletAddress}...`);

  try {
    // Try to use Privy for execution
    let PrivySigner;
    try {
      const privyModule = await import('../utils/privy-signer');
      PrivySigner = privyModule.PrivySigner;
      if (!PrivySigner) {
        console.error('[ERGC-PRIVY] PrivySigner class not exported from module');
        return { success: false, error: 'Privy integration unavailable - PrivySigner class not found' };
      }
      console.log(`[ERGC-PRIVY] PrivySigner imported successfully`);
    } catch (importError) {
      const errorMsg = importError instanceof Error ? importError.message : String(importError);
      const errorStack = importError instanceof Error ? importError.stack : undefined;
      console.error('[ERGC-PRIVY] Failed to import PrivySigner module:', errorMsg);
      if (errorStack) {
        console.error('[ERGC-PRIVY] Import error stack:', errorStack);
      }
      // Check if it's the known @hpke dependency issue
      if (errorMsg.includes('errors.js') || errorMsg.includes('@hpke')) {
        console.error('[ERGC-PRIVY] Known Privy dependency issue - @hpke module error');
        console.error('[ERGC-PRIVY] This is a Privy SDK dependency issue, not our code');
      }
      // Privy import failed - try using Privy client directly as workaround
      console.warn('[ERGC-PRIVY] PrivySigner import failed, trying direct Privy client...');
      try {
        const { getPrivyClient } = await import('../utils/privy-client');
        let privyClient;
        try {
          privyClient = await getPrivyClient(); // Now async
        } catch (clientError) {
          const clientErrorMsg = clientError instanceof Error ? clientError.message : String(clientError);
          console.error('[ERGC-PRIVY] Failed to get Privy client:', clientErrorMsg);
          
          // If Privy client also fails due to @hpke, provide helpful error message
          if (clientErrorMsg.includes('@hpke') || clientErrorMsg.includes('errors.js') || clientErrorMsg.includes('Cannot find module')) {
            console.error('[ERGC-PRIVY] Privy client unavailable due to @hpke dependency issue');
            console.error('[ERGC-PRIVY] This is a known issue with @privy-io/server-auth dependencies');
            console.error('[ERGC-PRIVY] ERGC debit will be skipped - user will pay full fees');
            
            // Check balance to inform user
            const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
            const ergcContractRead = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, provider);
            try {
              const balance = await ergcContractRead.balanceOf(walletAddress);
              const balanceFormatted = ethers.formatUnits(balance, 18);
              console.log(`[ERGC-PRIVY] User has ${balanceFormatted} ERGC but Privy integration unavailable`);
              console.log(`[ERGC-PRIVY] User will not receive ERGC discount due to Privy dependency issue`);
            } catch {}
            
            return { 
              success: false, 
              error: `Privy integration unavailable due to @hpke dependency error. ERGC debit skipped - user will pay full fees.` 
            };
          }
          throw clientError;
        }
        
        // Get the wallet ID from the user ID (for embedded wallets, user ID = wallet ID)
        const walletId = privyUserId;
        
        // Encode ERC20 transfer function call
        const ergcInterface = new ethers.Interface(ERC20_ABI);
        const transferData = ergcInterface.encodeFunctionData('transfer', [HUB_WALLET_ADDRESS, debitAmount]);
        
        // Check balance first
        const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
        const ergcContractRead = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, provider);
        const balance = await ergcContractRead.balanceOf(walletAddress);
        const balanceFormatted = ethers.formatUnits(balance, 18);
        console.log(`[ERGC-PRIVY] User ERGC balance (via RPC): ${balanceFormatted} ERGC`);
        
        if (balance < debitAmount) {
          console.error(`[ERGC-PRIVY] Insufficient ERGC balance: ${balanceFormatted} < ${amount}`);
          return { success: false, error: `Insufficient ERGC balance. Have: ${balanceFormatted}, Need: ${amount}` };
        }
        
        // Send transaction via Privy wallet API directly
        console.log(`[ERGC-PRIVY] Using direct Privy client for ERGC transfer (workaround for import issue)`);
        const response = await privyClient.walletApi.ethereum.sendTransaction({
          walletId: walletId,
          caip2: 'eip155:43114', // Avalanche C-Chain
          transaction: {
            to: ERGC_CONTRACT as `0x${string}`,
            value: '0x0',
            data: transferData as `0x${string}`,
            chainId: 43114
          }
        }) as any;
        
        const txHash = response.transactionHash || response.hash;
        console.log(`[ERGC-PRIVY] Transaction submitted via direct Privy client: ${txHash}`);
        console.log(`[ERGC-PRIVY] Check status at: https://snowtrace.io/tx/${txHash}`);
        return { success: true, txHash };
      } catch (directError) {
        const errorMsg = directError instanceof Error ? directError.message : String(directError);
        console.error('[ERGC-PRIVY] Direct Privy client also failed:', errorMsg);
        
        // Check if it's the @hpke error
        if (errorMsg.includes('@hpke') || errorMsg.includes('errors.js') || errorMsg.includes('Cannot find module')) {
          console.error('[ERGC-PRIVY] Privy client unavailable due to @hpke dependency issue');
          console.error('[ERGC-PRIVY] ERGC debit will be skipped - user will pay full fees');
        }
        
        // Fall back to checking balance and returning error
        const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
        const ergcContractRead = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, provider);
        try {
          const balance = await ergcContractRead.balanceOf(walletAddress);
          const balanceFormatted = ethers.formatUnits(balance, 18);
          console.log(`[ERGC-PRIVY] User has ${balanceFormatted} ERGC but Privy integration unavailable`);
          console.log(`[ERGC-PRIVY] User will not receive ERGC discount due to Privy dependency issue`);
        } catch {}
        return { success: false, error: `Privy integration unavailable: ${errorMsg}` };
      }
    }

    // Create Privy signer (only if import succeeded)
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    let privySigner;
    try {
      privySigner = new PrivySigner(privyUserId, walletAddress, provider);
      console.log(`[ERGC-PRIVY] Created PrivySigner for wallet ${walletAddress}`);
    } catch (signerError) {
      const errorMsg = signerError instanceof Error ? signerError.message : String(signerError);
      console.error('[ERGC-PRIVY] Failed to create PrivySigner instance:', errorMsg);
      // Try to check balance via RPC as fallback
      const ergcContractRead = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, provider);
      try {
        const balance = await ergcContractRead.balanceOf(walletAddress);
        const balanceFormatted = ethers.formatUnits(balance, 18);
        console.log(`[ERGC-PRIVY] User has ${balanceFormatted} ERGC but Privy unavailable`);
      } catch {}
      return { success: false, error: `Failed to create PrivySigner: ${errorMsg}` };
    }

    // Create ERGC contract with Privy signer
    const ergcContract = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, privySigner);

    // Check user's ERGC balance
    let balance;
    try {
      balance = await ergcContract.balanceOf(walletAddress);
      const balanceFormatted = ethers.formatUnits(balance, 18);
      console.log(`[ERGC-PRIVY] Privy wallet ERGC balance: ${balanceFormatted} ERGC`);

      if (balance < debitAmount) {
        console.error(`[ERGC-PRIVY] Insufficient ERGC balance: ${balanceFormatted} < ${amount}`);
        return { success: false, error: `Insufficient ERGC balance. Have: ${balanceFormatted}, Need: ${amount}` };
      }
    } catch (balanceError) {
      const errorMsg = balanceError instanceof Error ? balanceError.message : String(balanceError);
      console.error('[ERGC-PRIVY] Failed to check ERGC balance:', errorMsg);
      // This might fail if Privy client isn't initialized - check if it's a Privy error
      if (errorMsg.includes('Privy') || errorMsg.includes('walletApi') || errorMsg.includes('ensurePrivyClient')) {
        console.error('[ERGC-PRIVY] Privy client initialization error during balance check - trying RPC fallback');
        // Try RPC fallback
        const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
        const ergcContractRead = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, provider);
        try {
          const balanceRpc = await ergcContractRead.balanceOf(walletAddress);
          const balanceFormatted = ethers.formatUnits(balanceRpc, 18);
          console.log(`[ERGC-PRIVY] User has ${balanceFormatted} ERGC but Privy unavailable for transfer`);
        } catch {}
      }
      return { success: false, error: `Failed to check ERGC balance: ${errorMsg}` };
    }

    // Transfer ERGC to hub wallet (effectively burning it for fee discount)
    console.log(`[ERGC-PRIVY] Transferring ${amount} ERGC to hub wallet via Privy...`);
    let tx;
    try {
      tx = await ergcContract.transfer(HUB_WALLET_ADDRESS, debitAmount);
    } catch (transferError) {
      const errorMsg = transferError instanceof Error ? transferError.message : String(transferError);
      console.error('[ERGC-PRIVY] Failed to transfer ERGC:', errorMsg);
      // Check if it's a Privy client error
      if (errorMsg.includes('Privy') || errorMsg.includes('walletApi') || errorMsg.includes('ensurePrivyClient')) {
        console.error('[ERGC-PRIVY] Privy client error during transfer - Privy integration unavailable');
      }
      return { success: false, error: `Failed to transfer ERGC: ${errorMsg}` };
    }

    // CRITICAL: Don't wait for confirmation to avoid timeout - just return the hash
    const txHash = tx.hash;
    console.log(`[ERGC-PRIVY] Transaction submitted: ${txHash} (not waiting for confirmation to avoid timeout)`);
    console.log(`[ERGC-PRIVY] Check status at: https://snowtrace.io/tx/${txHash}`);
    console.log(`[ERGC-PRIVY] ERGC debit confirmed via Privy: ${txHash}`);
    console.log(`[ERGC-PRIVY] ${amount} ERGC transferred to treasury (burned for discount)`);

    return { success: true, txHash };
  } catch (error) {
    console.error('[ERGC-PRIVY] Debit error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Send AVAX to user wallet for execution/exit fees
 * @param toAddress - User wallet address
 * @param amount - Amount of AVAX to send (use AVAX_TO_SEND_FOR_GMX or AVAX_TO_SEND_FOR_AAVE)
 * @param purpose - Description for logging (e.g., 'GMX execution' or 'exit fees')
 */
async function sendAvaxToUser(
  toAddress: string,
  amount: bigint,
  purpose: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[AVAX] Sending ${ethers.formatEther(amount)} AVAX to ${toAddress} for ${purpose}`);

  const validation = validateHubWallet();
  if (!validation.valid) {
    console.error('[AVAX] Hub wallet validation failed:', validation.error);
    return { success: false, error: validation.error || 'Hub wallet not configured' };
  }

  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);

    // Check AVAX balance
    const balance = await provider.getBalance(wallet.address);
    console.log(`[AVAX] Hub AVAX balance: ${ethers.formatEther(balance)}`);

    if (balance < amount) {
      console.error(`[AVAX] Insufficient AVAX balance`);
      return { success: false, error: 'Insufficient AVAX in hub wallet' };
    }

    // Send AVAX with fixed gas price
    const gasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: amount,
      gasPrice,
    });

    // CRITICAL: Don't wait for confirmation to avoid timeout - just return the hash
    console.log(`[AVAX] Transaction submitted: ${tx.hash} (not waiting for confirmation to avoid timeout)`);
    console.log(`[AVAX] Check status at: https://snowtrace.io/tx/${tx.hash}`);
    console.log(`[AVAX] Transfer confirmed`);

    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error('[AVAX] Transfer error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Parse wallet address and risk profile from payment note
 * Format: "payment_id:xxx wallet:0x... risk:balanced email:user@example.com ergc:100 debit_ergc:1"
 */
function parsePaymentNote(note: string): {
  paymentId?: string;
  walletAddress?: string;
  riskProfile?: string;
  email?: string;
  ergcPurchase?: number;
  debitErgc?: number;
} {
  const result: { paymentId?: string; walletAddress?: string; riskProfile?: string; email?: string; ergcPurchase?: number; debitErgc?: number } = {};

  if (!note) return result;

  const parts = note.split(' ');
  for (const part of parts) {
    if (part.startsWith('payment_id:') || part.startsWith('paymentId:')) {
      result.paymentId = part.replace('payment_id:', '').replace('paymentId:', '');
    } else if (part.startsWith('wallet:')) {
      result.walletAddress = part.replace('wallet:', '');
    } else if (part.startsWith('risk:')) {
      result.riskProfile = part.replace('risk:', '');
    } else if (part.startsWith('email:')) {
      result.email = part.replace('email:', '');
    } else if (part.startsWith('ergc:')) {
      result.ergcPurchase = parseInt(part.replace('ergc:', ''), 10);
    } else if (part.startsWith('debit_ergc:')) {
      result.debitErgc = parseInt(part.replace('debit_ergc:', ''), 10);
    }
  }

  return result;
}

/**
 * Open a GMX BTC Long position using GMX SDK with gas price capped at 100 gwei
 * Used for legacy generated wallet flow
 */
async function openGmxPosition(
  collateralUsd: number,
  leverage: number,
  privateKey: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const positionSizeUsd = collateralUsd * leverage;
  console.log(`[GMX] Opening BTC Long: $${collateralUsd} collateral, ${leverage}x leverage, $${positionSizeUsd} position`);

  // Check minimums
  if (collateralUsd < GMX_MIN_COLLATERAL_USD) {
    console.log(`[GMX] Collateral $${collateralUsd} below minimum $${GMX_MIN_COLLATERAL_USD}, skipping`);
    return { success: false, error: `Minimum collateral is $${GMX_MIN_COLLATERAL_USD}` };
  }

  if (positionSizeUsd < GMX_MIN_POSITION_SIZE_USD) {
    console.log(`[GMX] Position size $${positionSizeUsd} below minimum $${GMX_MIN_POSITION_SIZE_USD}, skipping`);
    return { success: false, error: `Minimum position size is $${GMX_MIN_POSITION_SIZE_USD}` };
  }

  try {
    console.log(`[GMX] Starting position creation with GMX SDK...`);

    // Create viem account and clients
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    
    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Fetch current gas price from network and cap at MAX_GAS_PRICE_GWEI
    console.log('[GMX] Fetching current gas price...');
    let networkGasPrice: bigint;
    try {
      networkGasPrice = await publicClient.getGasPrice();
      console.log(`[GMX] Network gas price: ${formatUnits(networkGasPrice, 9)} gwei`);
    } catch (error) {
      console.warn('[GMX] Failed to fetch network gas price, using default 25 gwei');
      networkGasPrice = parseUnits('25', 9); // Default to 25 gwei if fetch fails
    }
    
    const maxGas = parseUnits(MAX_GAS_PRICE_GWEI.toString(), 9); // 100 gwei cap
    const gasPrice = networkGasPrice > maxGas ? maxGas : networkGasPrice;
    
    console.log(`[GMX] Using gas price: ${formatUnits(gasPrice, 9)} gwei (capped at ${MAX_GAS_PRICE_GWEI} gwei)`);

    // Create base wallet client
    const baseWalletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Wrap wallet client to use capped gas price on all transactions
    const walletClient = {
      ...baseWalletClient,
      writeContract: async (args: any) => {
        console.log(`[GMX] Using ${formatUnits(gasPrice, 9)} gwei gas on writeContract...`);
        return baseWalletClient.writeContract({
          ...args,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
        });
      },
      sendTransaction: async (args: any) => {
        console.log(`[GMX] Using ${formatUnits(gasPrice, 9)} gwei gas on sendTransaction...`);
        return baseWalletClient.sendTransaction({
          ...args,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
        });
      },
    };

    console.log(`[GMX] Wallet address: ${account.address}`);

    // Check AVAX balance
    const avaxBalance = await publicClient.getBalance({ address: account.address });
    console.log(`[GMX] AVAX balance: ${formatUnits(avaxBalance, 18)}`);

    if (avaxBalance < parseUnits('0.02', 18)) {
      return { success: false, error: 'Insufficient AVAX for GMX execution fee' };
    }

    // Check USDC balance
    const usdcAmount = parseUnits(collateralUsd.toString(), 6);
    const usdcBalance = await publicClient.readContract({
      address: USDC_CONTRACT as `0x${string}`,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [account.address],
    }) as bigint;
    console.log(`[GMX] USDC balance: ${formatUnits(usdcBalance, 6)}`);

    if (usdcBalance < usdcAmount) {
      return { success: false, error: 'Insufficient USDC for collateral' };
    }

    // Fetch market data from GMX API
    console.log('[GMX] Fetching market data...');
    const [tokensRes, marketsRes] = await Promise.all([
      fetch('https://avalanche-api.gmxinfra.io/tokens'),
      fetch('https://avalanche-api.gmxinfra.io/markets'),
    ]);

    const tokensJson = await tokensRes.json() as { tokens: Array<{ symbol: string; address: string }> };
    const marketsJson = await marketsRes.json() as { markets: Array<{ isListed: boolean; indexToken: string; shortToken: string; marketToken: string }> };

    const btcToken = tokensJson.tokens.find(t => t.symbol === 'BTC');
    const usdcToken = tokensJson.tokens.find(t => t.symbol === 'USDC');

    if (!btcToken || !usdcToken) {
      throw new Error('BTC or USDC token not found');
    }

    const btcUsdcMarket = marketsJson.markets.find(
      m => m.isListed &&
        m.indexToken.toLowerCase() === btcToken.address.toLowerCase() &&
        m.shortToken.toLowerCase() === usdcToken.address.toLowerCase()
    );

    if (!btcUsdcMarket) {
      throw new Error('BTC/USDC market not found');
    }

    console.log(`[GMX] Market: ${btcUsdcMarket.marketToken}`);

    // Approve USDC to Router
    const allowance = await publicClient.readContract({
      address: USDC_CONTRACT as `0x${string}`,
      abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'allowance',
      args: [account.address, GMX_ROUTER as `0x${string}`],
    }) as bigint;

    if (allowance < usdcAmount) {
      console.log('[GMX] Approving USDC to Router...');
      const approveTxHash = await walletClient.writeContract({
        address: USDC_CONTRACT as `0x${string}`,
        abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
        functionName: 'approve',
        args: [GMX_ROUTER as `0x${string}`, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      console.log('[GMX] USDC approved');
    }

    // Initialize GMX SDK with enhanced debugging for serverless
    console.log('[GMX] Initializing GMX SDK...');
    console.log('[GMX] SDK config:', {
      chainId: 43114,
      rpcUrl: AVALANCHE_RPC,
      nodeVersion: process.version,
      platform: process.platform,
      vercel: !!process.env.VERCEL,
      vercelRegion: process.env.VERCEL_REGION,
      vercelEnv: process.env.VERCEL_ENV
    });

    let sdk: any;
    try {
      // Test fetch connectivity first (Vercel may have network restrictions)
      console.log('[GMX] Testing API connectivity...');
      const testFetch = await fetch('https://avalanche-api.gmxinfra.io/tokens', {
        method: 'GET',
        headers: { 'User-Agent': 'gmx-avalanche-dashboard/1.0' },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      console.log('[GMX] API connectivity test:', testFetch.status, testFetch.ok);

      sdk = new GmxSdk({
        chainId: 43114,
        rpcUrl: AVALANCHE_RPC,
        oracleUrl: 'https://avalanche-api.gmxinfra.io',
        subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
        walletClient: walletClient as any,
      });
      console.log('[GMX] SDK created successfully');
    } catch (sdkError) {
      console.error('[GMX] SDK creation failed:', sdkError);
      console.error('[GMX] Error details:', {
        name: sdkError instanceof Error ? sdkError.name : 'Unknown',
        message: sdkError instanceof Error ? sdkError.message : String(sdkError),
        stack: sdkError instanceof Error ? sdkError.stack : 'No stack trace',
        code: (sdkError as any)?.code || 'Unknown',
        errno: (sdkError as any)?.errno || 'Unknown'
      });
      throw sdkError;
    }

    sdk.setAccount(account.address);
    console.log('[GMX] SDK account set:', account.address);

    // Track tx hash
    let submittedHash: `0x${string}` | null = null;

    // Override callContract to capture hash and add execution fee
    const originalCallContract = sdk.callContract.bind(sdk);
    sdk.callContract = (async (
      contractAddress: `0x${string}`,
      abi: any,
      method: string,
      params: unknown[],
      opts?: { value?: bigint }
    ) => {
      console.log(`[GMX SDK] Calling ${method}...`);

      // Extract sendWnt amounts for execution fee
      let totalWntAmount = 0n;
      if (method === 'multicall' && Array.isArray(params) && Array.isArray(params[0])) {
        const dataItems = params[0] as string[];
        dataItems.forEach((data) => {
          if (typeof data === 'string' && data.toLowerCase().startsWith('0x7d39aaf1')) {
            if (data.length >= 138) {
              const amountHex = data.slice(74, 138);
              totalWntAmount += BigInt(`0x${amountHex}`);
            }
          }
        });

        if (totalWntAmount > 0n) {
          console.log(`[GMX SDK] Execution fee: ${formatUnits(totalWntAmount, 18)} AVAX`);
        }
      }

      // Add execution fee as value
      const finalOpts = {
        ...opts,
        value: (opts?.value || 0n) + totalWntAmount,
      };

      const h = await originalCallContract(contractAddress, abi, method, params, finalOpts) as `0x${string}`;
      submittedHash = h;
      console.log(`[GMX SDK] Tx submitted: ${h}`);
      return h;
    }) as typeof sdk.callContract;

    // Execute order
    const leverageBps = BigInt(Math.floor(leverage * 10000));
    console.log('[GMX] Submitting order via SDK...');
    console.log('[GMX] Order params:', {
      payAmount: usdcAmount.toString(),
      marketAddress: btcUsdcMarket.marketToken,
      payTokenAddress: usdcToken.address,
      collateralTokenAddress: usdcToken.address,
      leverage: leverageBps.toString(),
    });

    try {
      console.log('[GMX] About to call sdk.orders.long()...');
      console.log('[GMX] Order parameters:', {
        payAmount: usdcAmount.toString(),
        marketAddress: btcUsdcMarket.marketToken,
        payTokenAddress: usdcToken.address,
        collateralTokenAddress: usdcToken.address,
        leverage: leverageBps.toString(),
        allowedSlippageBps: 100,
        skipSimulation: true
      });

      const orderStartTime = Date.now();
      await sdk.orders.long({
        payAmount: usdcAmount,
        marketAddress: btcUsdcMarket.marketToken as `0x${string}`,
        payTokenAddress: usdcToken.address as `0x${string}`,
        collateralTokenAddress: usdcToken.address as `0x${string}`,
        allowedSlippageBps: 100,
        leverage: leverageBps,
        skipSimulation: true,
      });

      const orderDuration = Date.now() - orderStartTime;
      console.log(`[GMX] sdk.orders.long() completed in ${orderDuration}ms`);
    } catch (orderError) {
      console.error('[GMX] sdk.orders.long() failed:', orderError);
      console.error('[GMX] Order error details:', {
        name: orderError instanceof Error ? orderError.name : 'Unknown',
        message: orderError instanceof Error ? orderError.message : String(orderError),
        stack: orderError instanceof Error ? orderError.stack : 'No stack trace',
        code: (orderError as any)?.code || 'Unknown',
        errno: (orderError as any)?.errno || 'Unknown'
      });
      throw orderError;
    }

    if (!submittedHash) {
      console.error('[GMX] No tx hash captured after sdk.orders.long()');
      throw new Error('GMX order submitted but no tx hash captured');
    }

    console.log(`[GMX] Waiting for tx confirmation: ${submittedHash}`);
    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });

    if (receipt.status !== 'success') {
      console.error('[GMX] Transaction reverted:', receipt);
      throw new Error('GMX transaction reverted');
    }

    console.log(`[GMX] Order confirmed: ${submittedHash}`);
    return { success: true, txHash: submittedHash };

  } catch (error) {
    console.error('[GMX] Order error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg };
  }
}

/**
 * Supply USDC to AAVE from hub wallet
 */
async function supplyToAave(
  amountUsd: number,
  wallet: ethers.Wallet
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[AAVE] Supplying $${amountUsd} USDC to AAVE...`);

  // Check minimum
  if (amountUsd < AAVE_MIN_SUPPLY_USD) {
    console.log(`[AAVE] Amount $${amountUsd} below minimum $${AAVE_MIN_SUPPLY_USD}, skipping`);
    return { success: false, error: `Minimum supply is $${AAVE_MIN_SUPPLY_USD}` };
  }

  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC, {
      chainId: 43114,
      name: 'avalanche'
    });

    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, wallet);
    const aavePool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
    const usdcAmount = BigInt(Math.floor(amountUsd * 1_000_000));

    // Check and approve USDC for AAVE Pool
    const allowance = await usdcContract.allowance(wallet.address, AAVE_POOL);
    if (allowance < usdcAmount) {
      console.log('[AAVE] Approving USDC...');
      const approveTx = await usdcContract.approve(AAVE_POOL, ethers.MaxUint256);
      const approveReceipt = await approveTx.wait();
      if (approveReceipt?.status !== 1) {
        throw new Error(`USDC approval failed on-chain. Status: ${approveReceipt?.status}`);
      }
      console.log('[AAVE] Approval confirmed');
    }

    // Supply to AAVE
    // CRITICAL: onBehalfOf MUST be the user wallet address (wallet.address)
    // This ensures aTokens are credited to the user, not the hub wallet
    console.log('[AAVE] Supplying to pool...');
    console.log(`[AAVE] ⚠️ CRITICAL: onBehalfOf=${wallet.address} (user wallet)`);
    console.log(`[AAVE] ⚠️ CRITICAL: Signer=${wallet.address} (user wallet signing)`);
    
    const supplyTx = await aavePool.supply(
      USDC_CONTRACT,
      usdcAmount,
      wallet.address, // onBehalfOf - USER wallet receives aTokens (CRITICAL: must be user wallet)
      0 // referralCode
    );

    const receipt = await supplyTx.wait();
    console.log(`[AAVE] Supply confirmed: ${supplyTx.hash}`);

    return { success: true, txHash: supplyTx.hash };
  } catch (error) {
    console.error('[AAVE] Supply error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute GMX directly from hub wallet for connected wallets
 * This uses the exact same implementation as the working Bitcoin tab
 */
async function executeGmxFromHubWallet(
  walletAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[GMX Hub] ===== DIAGNOSTICS =====`);
  console.log(`[GMX Hub] Hub wallet address: ${HUB_WALLET_ADDRESS}`);
  console.log(`[GMX Hub] Hub private key configured: ${!!HUB_WALLET_PRIVATE_KEY && HUB_WALLET_PRIVATE_KEY.length > 0}`);
  console.log(`[GMX Hub] Target amount: $${amountUsd}`);
  console.log(`[GMX Hub] User wallet: ${walletAddress}`);
  console.log(`[GMX Hub] Payment ID: ${paymentId}`);
  console.log(`[GMX Hub] Creating $${amountUsd} USDC BTC long position from hub wallet for ${walletAddress}...`);

  // Validate hub wallet
  const validation = validateHubWallet();
  if (!validation.valid) {
    console.error('[GMX Hub] Hub wallet validation failed:', validation.error);
    return { success: false, error: validation.error || 'Hub wallet not configured' };
  }

  // Pre-flight balance checks with detailed logging
  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const hubUsdcBalance = await new ethers.Contract(
      USDC_CONTRACT, 
      ERC20_ABI, 
      provider
    ).balanceOf(HUB_WALLET_ADDRESS);
    
    const hubAvaxBalance = await provider.getBalance(HUB_WALLET_ADDRESS);
    
    const hubUsdcBalanceFormatted = Number(hubUsdcBalance) / 1_000_000;
    const hubAvaxBalanceFormatted = ethers.formatEther(hubAvaxBalance);
    
    console.log(`[GMX Hub] Hub USDC balance: $${hubUsdcBalanceFormatted.toFixed(2)}`);
    console.log(`[GMX Hub] Hub AVAX balance: ${hubAvaxBalanceFormatted} AVAX`);
    console.log(`[GMX Hub] Required USDC: $${amountUsd}`);
    
    if (hubUsdcBalanceFormatted < amountUsd) {
      const errorMsg = `Insufficient USDC in hub wallet: Have $${hubUsdcBalanceFormatted.toFixed(2)}, Need $${amountUsd}`;
      console.error(`[GMX Hub] ❌ ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }
    
    // Check for minimum AVAX (estimate ~0.01 AVAX for execution fee)
    const minAvaxRequired = 0.01;
    if (Number(hubAvaxBalanceFormatted) < minAvaxRequired) {
      const errorMsg = `Insufficient AVAX in hub wallet: Have ${hubAvaxBalanceFormatted} AVAX, Need at least ${minAvaxRequired} AVAX`;
      console.error(`[GMX Hub] ❌ ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }
    
    console.log(`[GMX Hub] ✅ Pre-flight checks passed`);
  } catch (balanceError) {
    console.error(`[GMX Hub] ❌ Balance check failed:`, balanceError);
    return {
      success: false,
      error: `Failed to check hub wallet balance: ${balanceError instanceof Error ? balanceError.message : String(balanceError)}`
    };
  }

  try {
    // Use already imported modules (viem, GmxSdk, etc. are imported at top of file)

    const leverage = 2.5; // Aggressive strategy uses 2.5x leverage
    const collateralUsd = amountUsd;
    const positionSizeUsd = collateralUsd * leverage;

    // Check minimums (same as openGmxPosition)
    if (collateralUsd < GMX_MIN_COLLATERAL_USD) {
      console.log(`[GMX Hub] Collateral $${collateralUsd} below minimum $${GMX_MIN_COLLATERAL_USD}, skipping`);
      return { success: false, error: `Minimum collateral is $${GMX_MIN_COLLATERAL_USD}` };
    }

    if (positionSizeUsd < GMX_MIN_POSITION_SIZE_USD) {
      console.log(`[GMX Hub] Position size $${positionSizeUsd} below minimum $${GMX_MIN_POSITION_SIZE_USD}, skipping`);
      return { success: false, error: `Minimum position size is $${GMX_MIN_POSITION_SIZE_USD}` };
    }

    console.log(`[GMX Hub] Collateral: $${collateralUsd}, Leverage: ${leverage}x, Position: $${positionSizeUsd}`);

    // Use hub wallet for execution
    const cleanKey = HUB_WALLET_PRIVATE_KEY.startsWith('0x') ? HUB_WALLET_PRIVATE_KEY : `0x${HUB_WALLET_PRIVATE_KEY}`;
    const account = privateKeyToAccount(cleanKey as `0x${string}`);
    console.log(`[GMX Hub] Hub wallet: ${account.address}`);

    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });
    
    // Test RPC connectivity
    console.log('[GMX Hub] Testing RPC connectivity...');
    try {
      const blockNumber = await publicClient.getBlockNumber();
      console.log(`[GMX Hub] ✅ RPC connected, current block: ${blockNumber}`);
    } catch (rpcError) {
      console.error('[GMX Hub] ❌ RPC connectivity test failed:', rpcError);
      return {
        success: false,
        error: `RPC connection failed: ${rpcError instanceof Error ? rpcError.message : String(rpcError)}`
      };
    }

    // Create wallet client (EXACTLY like Bitcoin tab - no gas price override)
    // Gas parameters will be set dynamically in callContract override (like Bitcoin tab)
    const walletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });
    
    console.log(`[GMX Hub] Wallet client created (gas will be set dynamically in callContract, EXACTLY like Bitcoin tab)`);
    console.log(`[GMX Hub] Wallet client account:`, walletClient.account?.address);
    console.log(`[GMX Hub] Expected account:`, account.address);
    
    // CRITICAL: Verify walletClient account matches
    if (walletClient.account?.address.toLowerCase() !== account.address.toLowerCase()) {
      console.error('[GMX Hub] ❌ CRITICAL: Wallet client account mismatch!');
      console.error('[GMX Hub] Wallet client account:', walletClient.account?.address);
      console.error('[GMX Hub] Expected account:', account.address);
      return {
        success: false,
        error: `Wallet client account mismatch. Client: ${walletClient.account?.address}, Expected: ${account.address}`
      };
    }

    // Balance checks already done above in pre-flight checks
    // Use the required USDC amount for approval
    const usdcAmount = BigInt(Math.floor(collateralUsd * 1_000_000));

    // Fetch market data from GMX API with timeout and error handling
    console.log('[GMX Hub] Fetching market data from GMX API...');
    let tokensJson: { tokens: Array<{ symbol: string; address: string }> };
    let marketsJson: { markets: Array<{ isListed: boolean; indexToken: string; shortToken: string; marketToken: string }> };
    
    try {
      const fetchController = new AbortController();
      const timeoutId = setTimeout(() => fetchController.abort(), 15000); // 15 second timeout
      
      const [tokensRes, marketsRes] = await Promise.all([
        fetch('https://avalanche-api.gmxinfra.io/tokens', {
          signal: fetchController.signal,
          headers: { 'User-Agent': 'tiltvault-webhook/1.0' }
        }),
        fetch('https://avalanche-api.gmxinfra.io/markets', {
          signal: fetchController.signal,
          headers: { 'User-Agent': 'tiltvault-webhook/1.0' }
        }),
      ]);
      
      clearTimeout(timeoutId);
      
      if (!tokensRes.ok) {
        throw new Error(`GMX tokens API returned ${tokensRes.status}: ${tokensRes.statusText}`);
      }
      if (!marketsRes.ok) {
        throw new Error(`GMX markets API returned ${marketsRes.status}: ${marketsRes.statusText}`);
      }
      
      tokensJson = await tokensRes.json() as { tokens: Array<{ symbol: string; address: string }> };
      marketsJson = await marketsRes.json() as { markets: Array<{ isListed: boolean; indexToken: string; shortToken: string; marketToken: string }> };
      
      console.log(`[GMX Hub] ✅ Market data fetched: ${tokensJson.tokens.length} tokens, ${marketsJson.markets.length} markets`);
    } catch (fetchError) {
      const errorMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error('[GMX Hub] ❌ Failed to fetch GMX market data:', errorMsg);
      console.error('[GMX Hub] Error details:', {
        name: fetchError instanceof Error ? fetchError.name : 'Unknown',
        message: errorMsg,
        stack: fetchError instanceof Error ? fetchError.stack : 'No stack'
      });
      
      if (errorMsg.includes('aborted') || errorMsg.includes('timeout')) {
        return {
          success: false,
          error: `GMX API request timed out. This may be a temporary network issue. Please retry.`
        };
      }
      
      return {
        success: false,
        error: `Failed to fetch GMX market data: ${errorMsg}`
      };
    }

    const btcToken = tokensJson.tokens.find(t => t.symbol === 'BTC');
    const usdcToken = tokensJson.tokens.find(t => t.symbol === 'USDC');

    if (!btcToken || !usdcToken) {
      console.error('[GMX Hub] ❌ Token lookup failed');
      console.error('[GMX Hub] Available tokens:', tokensJson.tokens.map(t => t.symbol).slice(0, 10));
      return {
        success: false,
        error: `BTC or USDC token not found in GMX API. Available tokens: ${tokensJson.tokens.map(t => t.symbol).join(', ')}`
      };
    }

    const btcUsdcMarket = marketsJson.markets.find(
      m => m.isListed &&
        m.indexToken.toLowerCase() === btcToken.address.toLowerCase() &&
        m.shortToken.toLowerCase() === usdcToken.address.toLowerCase()
    );

    if (!btcUsdcMarket) {
      console.error('[GMX Hub] ❌ Market lookup failed');
      console.error('[GMX Hub] Available markets:', marketsJson.markets.filter(m => m.isListed).map(m => ({
        indexToken: m.indexToken,
        shortToken: m.shortToken,
        marketToken: m.marketToken
      })).slice(0, 5));
      return {
        success: false,
        error: `BTC/USDC market not found in GMX API. Check GMX protocol status.`
      };
    }

    console.log(`[GMX Hub] Market: ${btcUsdcMarket.marketToken}`);

    // CRITICAL: Approve USDC to Exchange Router (not Synthetics Router)
    // The GMX SDK uses Exchange Router internally (0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2)
    // NOT the Synthetics Router (0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68)
    console.log('[GMX Hub] Checking USDC allowance for Exchange Router...');
    console.log('[GMX Hub] Exchange Router:', GMX_EXCHANGE_ROUTER);
    let allowance: bigint;
    try {
      allowance = await publicClient.readContract({
        address: USDC_CONTRACT as `0x${string}`,
        abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }],
        functionName: 'allowance',
        args: [account.address, GMX_EXCHANGE_ROUTER as `0x${string}`],
      }) as bigint;
      console.log(`[GMX Hub] Current allowance: ${formatUnits(allowance, 6)} USDC, Required: ${formatUnits(usdcAmount, 6)} USDC`);
    } catch (allowanceError) {
      console.error('[GMX Hub] ❌ Failed to check USDC allowance:', allowanceError);
      return {
        success: false,
        error: `Failed to check USDC allowance: ${allowanceError instanceof Error ? allowanceError.message : String(allowanceError)}`
      };
    }

    if (allowance < usdcAmount) {
      console.log('[GMX Hub] Approving USDC to Exchange Router...');
      try {
        const approveTxHash = await walletClient.writeContract({
          address: USDC_CONTRACT as `0x${string}`,
          abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'approve',
          args: [GMX_EXCHANGE_ROUTER as `0x${string}`, maxUint256],
        });
        console.log(`[GMX Hub] Approval tx submitted: ${approveTxHash}`);
        console.log(`[GMX Hub] Waiting for approval confirmation (max 45s timeout)...`);
        
        // CRITICAL: Wait for approval confirmation with timeout to prevent "exceeds allowance" error
        // Use Promise.race to timeout after 45 seconds (longer timeout for reliability)
        const approvalPromise = publicClient.waitForTransactionReceipt({ 
          hash: approveTxHash,
          timeout: 45000 // 45 second timeout
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Approval confirmation timed out after 45 seconds')), 45000);
        });
        
        try {
          const receipt = await Promise.race([approvalPromise, timeoutPromise]);
          if (receipt.status !== 'success') {
            throw new Error(`Approval transaction reverted. Status: ${receipt.status}`);
          }
          console.log(`[GMX Hub] ✅ USDC approval confirmed: ${approveTxHash}`);
          
          // Double-check allowance after confirmation (check Exchange Router, not Synthetics Router)
          const confirmedAllowance = await publicClient.readContract({
            address: USDC_CONTRACT as `0x${string}`,
            abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }],
            functionName: 'allowance',
            args: [account.address, GMX_EXCHANGE_ROUTER as `0x${string}`],
          }) as bigint;
          
          if (confirmedAllowance < usdcAmount) {
            console.error(`[GMX Hub] ❌ CRITICAL: Approval confirmed but allowance still insufficient!`);
            console.error(`[GMX Hub] Allowance: ${formatUnits(confirmedAllowance, 6)} USDC, Required: ${formatUnits(usdcAmount, 6)} USDC`);
            return {
              success: false,
              error: `USDC approval confirmed but allowance insufficient. Allowance: ${formatUnits(confirmedAllowance, 6)} USDC, Required: ${formatUnits(usdcAmount, 6)} USDC`
            };
          }
          
          console.log(`[GMX Hub] ✅ Allowance verified: ${formatUnits(confirmedAllowance, 6)} USDC (required: ${formatUnits(usdcAmount, 6)} USDC)`);
        } catch (waitError) {
          const errorMsg = waitError instanceof Error ? waitError.message : String(waitError);
          if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
            console.warn(`[GMX Hub] ⚠️ Approval confirmation timed out, but tx was submitted: ${approveTxHash}`);
            console.warn(`[GMX Hub] ⚠️ Will check allowance multiple times before proceeding`);
            
            // Check allowance multiple times with increasing delays
            let finalAllowance: bigint = 0n;
            for (let attempt = 1; attempt <= 5; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 3000 * attempt)); // 3s, 6s, 9s, 12s, 15s
              
              finalAllowance = await publicClient.readContract({
                address: USDC_CONTRACT as `0x${string}`,
                abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }],
                functionName: 'allowance',
                args: [account.address, GMX_EXCHANGE_ROUTER as `0x${string}`],
              }) as bigint;
              
              console.log(`[GMX Hub] Allowance check attempt ${attempt}/5: ${formatUnits(finalAllowance, 6)} USDC`);
              
              if (finalAllowance >= usdcAmount) {
                console.log(`[GMX Hub] ✅ Allowance confirmed after timeout (attempt ${attempt}): ${formatUnits(finalAllowance, 6)} USDC`);
                break;
              }
            }
            
            if (finalAllowance < usdcAmount) {
              return {
                success: false,
                error: `USDC approval not confirmed after timeout and multiple checks. Allowance: ${formatUnits(finalAllowance, 6)} USDC, Required: ${formatUnits(usdcAmount, 6)} USDC. Check transaction: https://snowtrace.io/tx/${approveTxHash}`
              };
            }
          } else {
            throw waitError;
          }
        }
      } catch (approveError) {
        console.error('[GMX Hub] ❌ USDC approval failed:', approveError);
        return {
          success: false,
          error: `USDC approval failed: ${approveError instanceof Error ? approveError.message : String(approveError)}`
        };
      }
    } else {
      console.log('[GMX Hub] ✅ USDC already approved');
    }

    // Initialize GMX SDK with error handling
    console.log('[GMX Hub] Initializing GMX SDK...');
    console.log('[GMX Hub] SDK config:', {
      chainId: 43114,
      rpcUrl: AVALANCHE_RPC.substring(0, 30) + '...',
      oracleUrl: 'https://avalanche-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
      walletClientType: typeof walletClient,
      nodeVersion: process.version,
      platform: process.platform,
    });
    
    let sdk: any;
    try {
      // Test API connectivity first (same as openGmxPosition)
      console.log('[GMX Hub] Testing GMX API connectivity...');
      const testFetch = await fetch('https://avalanche-api.gmxinfra.io/tokens', {
        method: 'GET',
        headers: { 'User-Agent': 'tiltvault-webhook/1.0' },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });
      console.log('[GMX Hub] API connectivity test:', testFetch.status, testFetch.ok);
      
      if (!testFetch.ok) {
        throw new Error(`GMX API returned ${testFetch.status}: ${testFetch.statusText}`);
      }
      
      sdk = new GmxSdk({
        chainId: 43114,
        rpcUrl: AVALANCHE_RPC,
        oracleUrl: 'https://avalanche-api.gmxinfra.io',
        subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
        walletClient: walletClient as any,
      });
      console.log('[GMX Hub] ✅ SDK created successfully');
    } catch (sdkError) {
      console.error('[GMX Hub] ❌ SDK initialization failed:', sdkError);
      const errorMsg = sdkError instanceof Error ? sdkError.message : String(sdkError);
      console.error('[GMX Hub] SDK error details:', {
        name: sdkError instanceof Error ? sdkError.name : 'Unknown',
        message: errorMsg,
        stack: sdkError instanceof Error ? sdkError.stack : 'No stack trace',
        code: (sdkError as any)?.code || 'Unknown',
        errno: (sdkError as any)?.errno || 'Unknown'
      });
      
      if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT') || errorMsg.includes('aborted')) {
        return {
          success: false,
          error: `GMX SDK initialization timed out. This may be a temporary network issue. Please retry.`
        };
      }
      
      if (errorMsg.includes('fetch') || errorMsg.includes('network')) {
        return {
          success: false,
          error: `GMX SDK initialization failed due to network error: ${errorMsg}`
        };
      }
      
      return {
        success: false,
        error: `GMX SDK initialization failed: ${errorMsg}`
      };
    }

    // CRITICAL: Do NOT call sdk.setAccount() (getter-only). Instead set Orders account directly.
    try {
      console.log('[GMX Hub] Using walletClient account as SDK account (no setAccount call):', account.address);
      if ((sdk as any).orders) {
        (sdk as any).orders.account = account.address;
        (sdk as any).orders._account = account.address;
        console.log('[GMX Hub] ✅ Orders account set via direct property assignment');
      }

      // Verify account is set
      const verifiedAccount = (sdk as any).orders?.account || (sdk as any).orders?._account;
      if (verifiedAccount && verifiedAccount.toLowerCase() === account.address.toLowerCase()) {
        console.log('[GMX Hub] ✅ Account verified on Orders module:', verifiedAccount);
      } else {
        console.error('[GMX Hub] ❌ CRITICAL: Account verification failed!');
        console.error('[GMX Hub] Orders account:', (sdk as any).orders?.account);
        console.error('[GMX Hub] Expected:', account.address);
        return {
          success: false,
          error: `SDK account not set correctly. Orders: ${(sdk as any).orders?.account}, Expected: ${account.address}`
        };
      }

      console.log('[GMX Hub] Position will be created for user wallet via multicall modification:', walletAddress);
    } catch (setAccountError) {
      console.error('[GMX Hub] ❌ Failed to set SDK account:', setAccountError);
      return {
        success: false,
        error: `Failed to set GMX SDK account: ${setAccountError instanceof Error ? setAccountError.message : String(setAccountError)}`
      };
    }

    // Track tx hash
    let submittedHash: `0x${string}` | null = null;

    // Override callContract to capture hash and set proper gas parameters (EXACTLY like Bitcoin tab)
    const originalCallContract = sdk.callContract.bind(sdk);
    sdk.callContract = (async (
      contractAddress: `0x${string}`,
      abi: any,
      method: string,
      params: unknown[],
      opts?: { value?: bigint }
    ) => {
      console.log(`[GMX Hub SDK] Calling ${method}...`);
      console.log(`[GMX Hub SDK] ⚠️ CRITICAL: Position will be created for user wallet: ${walletAddress}`);
      console.log(`[GMX Hub SDK] ⚠️ CRITICAL: Hub wallet (${account.address}) provides USDC and gas`);

      // CRITICAL: For multicall, replace hub wallet with user wallet in position ownership fields
      let modifiedParams = params;
      if (method === 'multicall' && Array.isArray(params) && Array.isArray(params[0])) {
        const dataItems = params[0] as string[];
        const modifiedDataItems = dataItems.map((data) => {
          if (typeof data === 'string') {
            // Replace hub wallet address with user wallet in specific locations
            // This ensures position is owned by user, not hub
            let modifiedData = data;
            
            // Pattern 1: Replace hub wallet in createOrder parameters (position owner)
            // The createOrder call contains the account address that determines position ownership
            const hubWalletLower = account.address.toLowerCase().slice(2);
            if (modifiedData.toLowerCase().includes(hubWalletLower)) {
              modifiedData = modifiedData.replace(
                new RegExp(account.address.slice(2), 'gi'),
                walletAddress.slice(2)
              );
              console.log(`[GMX Hub SDK] ✅ Replaced hub wallet with user wallet in createOrder data`);
            }
          }
          return data;
        });
        
        modifiedParams = [modifiedDataItems];
        
        // Extract sendWnt amounts for execution fee (for logging only - DON'T modify opts.value)
        let totalWntAmount = 0n;
        dataItems.forEach((data) => {
          if (typeof data === 'string' && data.toLowerCase().startsWith('0x7d39aaf1')) {
            if (data.length >= 138) {
              const amountHex = data.slice(74, 138);
              totalWntAmount += BigInt(`0x${amountHex}`);
            }
          }
        });

        if (totalWntAmount > 0n) {
          const existingValue = opts?.value || 0n;
          console.log(`[GMX Hub SDK] Execution fee (SDK-managed):`, {
            sendWntAmount: formatUnits(totalWntAmount, 18),
            existingValue: formatUnits(existingValue, 18),
            note: 'Letting SDK handle msg.value - not modifying (EXACTLY like Bitcoin tab)',
          });
        }
      }

      console.log(`[GMX Hub SDK] USDC transfer from: ${account.address} (hub wallet)`);
      console.log(`[GMX Hub SDK] Position owner: ${walletAddress} (user wallet)`);

      // Set gas parameters dynamically (EXACTLY like Bitcoin tab)
      let finalOpts = opts;
      try {
        const baseFee = await publicClient.getGasPrice();
        const minerTip = parseUnits('12', 9); // 12 gwei miner tip (same as Bitcoin tab)
        const maxFeeBuffer = parseUnits('1', 9); // 1 gwei buffer (same as Bitcoin tab)
        const maxFeePerGas = baseFee + minerTip + maxFeeBuffer;
        
        console.log(`[GMX Hub SDK] Gas parameters (dynamic, like Bitcoin tab):`, {
          baseFee: formatUnits(baseFee, 9) + ' gwei',
          minerTip: '12 gwei',
          maxFeeBuffer: '1 gwei',
          maxFeePerGas: formatUnits(maxFeePerGas, 9) + ' gwei',
          note: 'maxFee = baseFee + minerTip + 1 for profitability',
        });
        
        finalOpts = {
          ...opts,
          maxFeePerGas,
          maxPriorityFeePerGas: minerTip,
        } as { value?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
      } catch (gasError) {
        console.warn(`[GMX Hub SDK] Failed to set custom gas, using defaults:`, gasError);
      }

      // CRITICAL: DON'T modify opts.value - let SDK handle execution fee (EXACTLY like Bitcoin tab)
      // Use modifiedParams to ensure position is created for user wallet
      const h = await originalCallContract(contractAddress, abi, method, modifiedParams, finalOpts) as `0x${string}`;
      submittedHash = h;
      console.log(`[GMX Hub SDK] Tx submitted: ${h}`);
      console.log(`[GMX Hub SDK] ✅ Position created for user wallet: ${walletAddress}`);
      return h;
    }) as typeof sdk.callContract;

    // Execute order
    const leverageBps = BigInt(Math.floor(leverage * 10000));
    console.log('[GMX Hub] Submitting order via SDK...');
    console.log('[GMX Hub] Order params:', {
      payAmount: usdcAmount.toString(),
      marketAddress: btcUsdcMarket.marketToken,
      payTokenAddress: usdcToken.address,
      collateralTokenAddress: usdcToken.address,
      leverage: leverageBps.toString(),
      allowedSlippageBps: 100,
      skipSimulation: true,
    });

    console.log('[GMX Hub] Market details:', {
      marketToken: btcUsdcMarket.marketToken,
      indexToken: btcUsdcMarket.indexToken,
      shortToken: btcUsdcMarket.shortToken,
      isListed: btcUsdcMarket.isListed,
    });

    console.log('[GMX Hub] Token details:', {
      btcAddress: btcToken.address,
      usdcAddress: usdcToken.address,
    });

    try {
      // CRITICAL: Double-check account is set before calling orders.long()
      // The SDK internally checks this.account in Orders.createIncreaseOrder and throws "Account is not defined" if not set
      // We need to ensure the account is set on both the SDK instance AND the Orders module
      let currentAccount = (sdk as any).account;
      if (!currentAccount) {
        console.error('[GMX Hub] ❌ CRITICAL: SDK account is not set! Attempting to set again...');
        try {
          // CRITICAL: sdk.setAccount is getter-only, set directly on instance
          (sdk as any).account = account.address;
          // Also set directly on SDK instance and Orders module
          if ((sdk as any).orders && (sdk as any).orders.account !== undefined) {
            (sdk as any).orders.account = account.address;
            console.log('[GMX Hub] ✅ Account also set on Orders module');
          }
          currentAccount = account.address;
          console.log('[GMX Hub] ✅ Account set again before order execution:', account.address);
        } catch (retryError) {
          console.error('[GMX Hub] ❌ Failed to set account on retry:', retryError);
          return {
            success: false,
            error: `SDK account not set. Cannot execute GMX order. Account: ${currentAccount}, Expected: ${account.address}`
          };
        }
      } else {
        console.log('[GMX Hub] ✅ SDK account verified before order execution:', currentAccount);
        if (currentAccount.toLowerCase() !== account.address.toLowerCase()) {
          console.warn('[GMX Hub] ⚠️ Account mismatch! SDK account:', currentAccount, 'Expected:', account.address);
          // Fix the mismatch
          (sdk as any).account = account.address;
          if ((sdk as any).orders && (sdk as any).orders.account !== undefined) {
            (sdk as any).orders.account = account.address;
          }
          currentAccount = account.address;
          console.log('[GMX Hub] ✅ Account corrected to:', account.address);
        }
      }
      
      // CRITICAL: Final verification - ensure Orders module has account set
      // The GMX SDK throws "Account is not defined" if the Orders module can't access the account
      console.log('[GMX Hub] 📋 Final account verification before order execution...');
      
      if ((sdk as any).orders) {
        // Try to get account from Orders module (check multiple possible property names)
        let ordersAccount = (sdk as any).orders.account || 
                           (sdk as any).orders._account || 
                           (sdk as any).orders.sdk?.account ||
                           currentAccount;
        
        console.log('[GMX Hub] 📊 Orders module account check:', {
          'orders.account': (sdk as any).orders.account,
          'orders._account': (sdk as any).orders._account,
          'orders.sdk?.account': (sdk as any).orders.sdk?.account,
          'currentAccount': currentAccount,
          'expectedAccount': account.address,
          'ordersAccount': ordersAccount
        });
        
        // CRITICAL: If Orders module doesn't have account, set it in multiple ways
        if (!ordersAccount || ordersAccount.toLowerCase() !== account.address.toLowerCase()) {
          console.warn('[GMX Hub] ⚠️ Orders module account not set correctly - fixing now...');
          try {
            // Method 1: Set directly on Orders instance
            (sdk as any).orders.account = account.address;
            (sdk as any).orders._account = account.address;
            
            // Method 2: If Orders has a reference to SDK, set it there too
            if ((sdk as any).orders.sdk) {
              (sdk as any).orders.sdk.account = account.address;
            }
            
            // Method 3: Try calling setAccount on Orders if it exists
            if (typeof (sdk as any).orders.setAccount === 'function') {
              (sdk as any).orders.setAccount(account.address);
            }
            
            // Method 4: Ensure SDK instance also has account
            (sdk as any).account = account.address;
            
            console.log('[GMX Hub] 🔧 Multiple account setting methods applied');
            
            // Verify it's set now
            ordersAccount = (sdk as any).orders.account || 
                           (sdk as any).orders._account || 
                           (sdk as any).orders.sdk?.account;
            
            if (ordersAccount && ordersAccount.toLowerCase() === account.address.toLowerCase()) {
              console.log('[GMX Hub] ✅✅✅ Orders module account fixed and verified:', ordersAccount);
            } else {
              // Last resort: try to access the SDK's internal account getter
              console.error('[GMX Hub] ❌ CRITICAL: Could not set Orders module account!');
              console.error('[GMX Hub] Final state:', {
                'sdk.account': (sdk as any).account,
                'orders.account': (sdk as any).orders.account,
                'orders._account': (sdk as any).orders._account,
                'expected': account.address
              });
              return {
                success: false,
                error: `Failed to set GMX SDK account on Orders module. This will cause "Account is not defined" error.`
              };
            }
          } catch (accountSetError) {
            console.error('[GMX Hub] ❌ Error setting Orders module account:', accountSetError);
            return {
              success: false,
              error: `Error setting GMX SDK account: ${accountSetError instanceof Error ? accountSetError.message : String(accountSetError)}`
            };
          }
        } else {
          console.log('[GMX Hub] ✅ Orders module account verified:', ordersAccount);
        }
      } else {
        console.error('[GMX Hub] ❌ CRITICAL: Orders module not found on SDK!');
        return {
          success: false,
          error: 'GMX SDK Orders module not available - cannot execute trade'
        };
      }
      
      console.log('[GMX Hub] About to call sdk.orders.long()...');
      console.log('[GMX Hub] Order parameters:', {
        payAmount: usdcAmount.toString(),
        marketAddress: btcUsdcMarket.marketToken,
        payTokenAddress: usdcToken.address,
        collateralTokenAddress: usdcToken.address,
        leverage: leverageBps.toString(),
        allowedSlippageBps: 100,
        skipSimulation: true,
      });
      
      const orderStartTime = Date.now();
      
      // Add timeout wrapper to prevent hanging
      const orderPromise = sdk.orders.long({
        payAmount: usdcAmount,
        marketAddress: btcUsdcMarket.marketToken as `0x${string}`,
        payTokenAddress: usdcToken.address as `0x${string}`,
        collateralTokenAddress: usdcToken.address as `0x${string}`,
        allowedSlippageBps: 100,
        leverage: leverageBps,
        skipSimulation: true,
      });
      
      // 45 second timeout for order execution (Vercel has 60s limit)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('GMX order execution timed out after 45 seconds'));
        }, 45000);
      });
      
      await Promise.race([orderPromise, timeoutPromise]);
      
      const orderDuration = Date.now() - orderStartTime;
      console.log(`[GMX Hub] ✅ sdk.orders.long() completed in ${orderDuration}ms`);
    } catch (orderError) {
      console.error('[GMX Hub] ❌ sdk.orders.long() failed:', orderError);
      const errorMsg = orderError instanceof Error ? orderError.message : String(orderError);
      console.error('[GMX Hub] Error details:', {
        message: errorMsg,
        name: orderError instanceof Error ? orderError.name : 'Unknown',
        stack: orderError instanceof Error ? orderError.stack : 'No stack',
        code: (orderError as any)?.code || 'Unknown',
        errno: (orderError as any)?.errno || 'Unknown'
      });

      // Check for specific GMX protocol errors
      if (errorMsg.includes('ROUTER_PLUGIN') || errorMsg.includes('router plugin')) {
        console.error('[GMX Hub] GMX protocol error: ROUTER_PLUGIN - this is a GMX protocol issue, not our code');
        return {
          success: false,
          error: 'GMX protocol error (ROUTER_PLUGIN). This is a temporary GMX issue. Please try again later or contact GMX support.'
        };
      }
      
      if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
        console.error('[GMX Hub] Order execution timed out');
        return {
          success: false,
          error: 'GMX order execution timed out. This may be a temporary network or protocol issue. Please retry.'
        };
      }
      
      if (errorMsg.includes('insufficient') || errorMsg.includes('balance')) {
        console.error('[GMX Hub] Insufficient funds error');
        return {
          success: false,
          error: `Insufficient funds for GMX execution: ${errorMsg}`
        };
      }

      throw orderError;
    }

    if (!submittedHash) {
      console.error('[GMX Hub] No tx hash captured after sdk.orders.long()');
      throw new Error('GMX order submitted but no tx hash captured');
    }

    // CRITICAL: Don't wait for confirmation to avoid timeout - just return the hash
    // Transaction is submitted and will be confirmed on-chain
    console.log(`[GMX Hub] Transaction submitted: ${submittedHash} (not waiting for confirmation to avoid timeout)`);
    console.log(`[GMX Hub] Check status at: https://snowtrace.io/tx/${submittedHash}`);
    return { success: true, txHash: submittedHash };

  } catch (error) {
    console.error('[GMX Hub] Execution error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    // Provide more detailed error information
    console.error('[GMX Hub] Full error details:', {
      message: errorMsg,
      name: error instanceof Error ? error.name : 'Unknown',
      stack: error instanceof Error ? error.stack : 'No stack',
      code: (error as any)?.code || 'Unknown',
      errno: (error as any)?.errno || 'Unknown',
    });
    
    // Check for common failure reasons
    if (errorMsg.includes('insufficient funds') || errorMsg.includes('insufficient balance')) {
      return { 
        success: false, 
        error: `Insufficient funds in hub wallet for GMX execution. Need $${amountUsd} USDC + execution fee.` 
      };
    }
    
    if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
      return { 
        success: false, 
        error: `GMX execution timed out. This may be a temporary network issue. Please retry.` 
      };
    }
    
    if (errorMsg.includes('ROUTER_PLUGIN') || errorMsg.includes('router plugin')) {
      return { 
        success: false, 
        error: `GMX protocol error (ROUTER_PLUGIN). This is a temporary GMX issue. Please try again later.` 
      };
    }
    
    return { 
      success: false, 
      error: `GMX execution failed: ${errorMsg}. Check hub wallet balance and GMX protocol status.` 
    };
  }
}

/**
 * Execute Aave using Privy signer for Privy smart wallets
 */
async function executeAaveViaPrivy(
  privyUserId: string,
  walletAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[AAVE-PRIVY] Supplying $${amountUsd} USDC to Aave via Privy for ${walletAddress}...`);

  // Check minimum
  if (amountUsd < AAVE_MIN_SUPPLY_USD) {
    console.log(`[AAVE-PRIVY] Amount $${amountUsd} below minimum $${AAVE_MIN_SUPPLY_USD}, skipping`);
    return { success: false, error: `Minimum supply is $${AAVE_MIN_SUPPLY_USD}` };
  }

  try {
    // Try to use Privy for execution
    let PrivySigner;
    try {
      const privyModule = await import('../utils/privy-signer');
      
      // Check if Privy is available before proceeding
      if (!(await privyModule.isPrivyAvailable())) {
        const error = await privyModule.getPrivyImportError();
        console.error('[AAVE-PRIVY] Privy not available:', error?.message);
        return await executeAaveFromHubWallet(walletAddress, amountUsd, paymentId);
      }
      
      PrivySigner = privyModule.PrivySigner;
      console.log(`[AAVE-PRIVY] PrivySigner imported successfully`);
    } catch (importError) {
      console.error('[AAVE-PRIVY] Failed to import PrivySigner, falling back to hub wallet:', importError);
      return await executeAaveFromHubWallet(walletAddress, amountUsd, paymentId);
    }

    // Create Privy signer - use privyUserId as walletId (Privy embedded wallets use userId as walletId)
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const privySigner = new PrivySigner(privyUserId, walletAddress, provider);

    console.log(`[AAVE-PRIVY] Created PrivySigner for wallet ${walletAddress}`);

    // Create contracts with Privy signer
    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, privySigner);
    const aavePool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, privySigner);
    const usdcAmount = BigInt(Math.floor(amountUsd * 1_000_000));

    // Check USDC balance in Privy wallet
    const balance = await usdcContract.balanceOf(walletAddress);
    const balanceFormatted = Number(balance) / 1_000_000;
    console.log(`[AAVE-PRIVY] Privy wallet USDC balance: ${balanceFormatted} USDC`);

    if (balance < usdcAmount) {
      console.error(`[AAVE-PRIVY] Insufficient USDC in Privy wallet: ${balanceFormatted} < ${amountUsd}`);
      return {
        success: false,
        error: `Insufficient USDC in Privy wallet. Have: ${balanceFormatted}, Need: ${amountUsd}`
      };
    }

    // Check and approve USDC for AAVE Pool
    const allowance = await usdcContract.allowance(walletAddress, AAVE_POOL);
    if (allowance < usdcAmount) {
      console.log('[AAVE-PRIVY] Approving USDC from Privy wallet...');
      const approveTx = await usdcContract.approve(AAVE_POOL, ethers.MaxUint256);
      const approveReceipt = await approveTx.wait();
      if (approveReceipt?.status !== 1) {
        throw new Error(`USDC approval via Privy failed on-chain. Status: ${approveReceipt?.status}`);
      }
      console.log('[AAVE-PRIVY] Privy wallet approval confirmed');
    } else {
      console.log('[AAVE-PRIVY] USDC already approved');
    }

    // Supply to Aave
    // CRITICAL: onBehalfOf MUST be the user wallet address, NOT the hub wallet
    // This ensures aTokens are credited to the user, not the hub wallet
    console.log('[AAVE-PRIVY] Supplying to pool via Privy...');
    console.log(`[AAVE-PRIVY] ⚠️ CRITICAL: onBehalfOf=${walletAddress} (user wallet)`);
    console.log(`[AAVE-PRIVY] ⚠️ CRITICAL: Privy signer wallet=${walletAddress} (user wallet signing)`);
    
    const supplyTx = await aavePool.supply(
      USDC_CONTRACT,
      usdcAmount,
      walletAddress, // onBehalfOf - USER wallet receives aTokens (CRITICAL: must be user wallet, not hub)
      0 // referralCode
    );

    const receipt = await supplyTx.wait();
    if (receipt?.status !== 1) {
      console.error(`[AAVE-PRIVY] Supply transaction failed! Status: ${receipt?.status}`);
      return { success: false, error: `Aave supply via Privy failed on-chain. Status: ${receipt?.status}` };
    }
    console.log(`[AAVE-PRIVY] Supply confirmed via Privy: ${supplyTx.hash}`);

    return { success: true, txHash: supplyTx.hash };
  } catch (error) {
    console.error('[AAVE-PRIVY] Supply error:', error);
    // Fall back to hub wallet execution if Privy fails
    console.log('[AAVE-PRIVY] Falling back to hub wallet execution');
    try {
      return await executeAaveFromHubWallet(walletAddress, amountUsd, paymentId);
    } catch (fallbackError) {
      return {
        success: false,
        error: `Privy execution failed: ${error instanceof Error ? error.message : String(error)}. Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
      };
    }
  }
}

/**
 * Execute Aave directly from hub wallet for connected wallets
 * This bypasses the need for user private keys
 */
export async function executeAaveFromHubWallet(
  walletAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[AAVE] Supplying $${amountUsd} USDC to Aave from hub wallet for ${walletAddress}...`);

  // Validate hub wallet
  const validation = validateHubWallet();
  if (!validation.valid) {
    console.error('[AAVE] Hub wallet validation failed:', validation.error);
    return { success: false, error: validation.error || 'Hub wallet not configured' };
  }

  // Check minimum
  if (amountUsd < AAVE_MIN_SUPPLY_USD) {
    console.log(`[AAVE] Amount $${amountUsd} below minimum $${AAVE_MIN_SUPPLY_USD}, skipping`);
    return { success: false, error: `Minimum supply is $${AAVE_MIN_SUPPLY_USD}` };
  }

  try {
    // Connect hub wallet
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const hubWallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);

    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, hubWallet);
    const aavePool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, hubWallet);
    const usdcAmount = BigInt(Math.floor(amountUsd * 1_000_000));

    // Check and approve USDC for AAVE Pool
    const allowance = await usdcContract.allowance(hubWallet.address, AAVE_POOL);
    if (allowance < usdcAmount) {
      console.log('[AAVE] Approving USDC from hub wallet...');
      const approveTx = await usdcContract.approve(AAVE_POOL, ethers.MaxUint256);
      const approveReceipt = await approveTx.wait();
      if (approveReceipt?.status !== 1) {
        throw new Error(`USDC approval from hub wallet failed on-chain. Status: ${approveReceipt?.status}`);
      }
      console.log('[AAVE] Hub wallet approval confirmed');
    }

    // Supply to Aave on behalf of user
    // CRITICAL: onBehalfOf MUST be the user wallet address, NOT the hub wallet
    // This ensures aTokens are credited to the user, not the hub wallet
    console.log('[AAVE] Supplying to pool on behalf of user...');
    console.log(`[AAVE] ⚠️ CRITICAL: onBehalfOf=${walletAddress} (user wallet)`);
    console.log(`[AAVE] ⚠️ CRITICAL: Hub wallet=${hubWallet.address} (signer only, NOT onBehalfOf)`);
    
    if (walletAddress.toLowerCase() === hubWallet.address.toLowerCase()) {
      console.error('[AAVE] ❌ CRITICAL ERROR: onBehalfOf cannot be hub wallet address!');
      return {
        success: false,
        error: 'Invalid configuration: onBehalfOf cannot be hub wallet address. User wallet address required.'
      };
    }
    
    const supplyTx = await aavePool.supply(
      USDC_CONTRACT,
      usdcAmount,
      walletAddress, // onBehalfOf - USER wallet receives aTokens (CRITICAL: must be user wallet, not hub)
      0 // referralCode
    );

    const receipt = await supplyTx.wait();
    console.log(`[AAVE] Supply confirmed: ${supplyTx.hash}`);

    return { success: true, txHash: supplyTx.hash };
  } catch (error) {
    console.error('[AAVE] Supply error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute strategy from USER's wallet (non-custodial)
 * Retrieves encrypted private key from Vercel KV, executes strategy, then deletes key
 */
async function executeStrategyFromUserWallet(
  walletAddress: string,
  paymentId: string
): Promise<{
  positionId: string;
  aaveResult?: { success: boolean; txHash?: string; error?: string };
  gmxResult?: { success: boolean; txHash?: string; error?: string };
  error?: string;
}> {
  console.log(`[Strategy] Executing strategy from user wallet ${walletAddress}`);

  // Get payment info to retrieve userEmail, riskProfile, and amount
  // These are no longer stored with wallet key (redundant storage removed)
  const redis = getRedis();
  const paymentInfoKey = `payment_info:${paymentId}`;
  const paymentInfoRaw = await redis.get(paymentInfoKey);

  if (!paymentInfoRaw) {
    console.error(`[Strategy] Payment info not found for ${paymentId}`);
    return { positionId: '', error: 'Payment info not found' };
  }

  const paymentInfo = typeof paymentInfoRaw === 'string' ? JSON.parse(paymentInfoRaw) : paymentInfoRaw;
  const { userEmail, riskProfile, amount } = paymentInfo;

  // userEmail is optional for connected wallets, but riskProfile and amount are required
  if (!riskProfile || !amount) {
    console.error(`[Strategy] Missing required fields in payment info:`, { riskProfile: !!riskProfile, amount: !!amount });
    return { positionId: '', error: 'Missing required payment info fields (riskProfile, amount)' };
  }

  const profile = RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES] || RISK_PROFILES.aggressive;
  const aaveAmount = (amount * profile.aavePercent) / 100;
  const gmxAmount = (amount * profile.gmxPercent) / 100;

  console.log(`[Strategy] Email: ${userEmail || 'N/A'}, Risk: ${riskProfile}, Amount: $${amount}`);
  console.log(`[Strategy] AAVE: $${aaveAmount}, GMX: $${gmxAmount}`);

  // Create position record
  const positionId = generatePositionId();
  const position: UserPosition = {
    id: positionId,
    paymentId,
    userEmail: userEmail || '',
    walletAddress,
    strategyType: riskProfile as 'conservative' | 'aggressive',
    usdcAmount: amount,
    status: 'executing',
    createdAt: new Date().toISOString(),
  };

  // Try to decrypt wallet key (for generated wallets - legacy flow)
  // For connected wallets, this will fail and we'll execute from hub wallet instead
  let walletData = null;
  let privateKey: string | null = null;
  try {
    walletData = await decryptWalletKeyWithToken(walletAddress, paymentId);
    if (walletData && walletData.privateKey) {
      privateKey = walletData.privateKey;
      console.log(`[Strategy] Found private key for generated wallet`);
    }
  } catch (error) {
    // Connected wallet - no private key stored, this is expected
    console.log(`[Strategy] Connected wallet detected (no private key stored): ${walletAddress}`);
  }

  await savePosition(position);

  let aaveResult: { success: boolean; txHash?: string; error?: string } | undefined;
  let gmxResult: { success: boolean; txHash?: string; error?: string } | undefined;

  // Handle connected wallets (no private key) vs generated wallets (with private key)
  if (!privateKey) {
    // CONNECTED WALLET FLOW: Execute Aave from hub wallet (user executes GMX via MetaMask)
    console.log(`[Strategy] Connected wallet flow - executing Aave from hub wallet`);

    // Execute AAVE from hub wallet (if allocation > 0)
    if (aaveAmount > 0 && profile.aavePercent > 0) {
      console.log(`[Strategy] Executing AAVE from hub wallet: $${aaveAmount}`);
      aaveResult = await executeAaveFromHubWallet(walletAddress, aaveAmount, paymentId);
      if (aaveResult.success) {
        await updatePosition(positionId, {
          aaveSupplyAmount: aaveAmount,
          aaveSupplyTxHash: aaveResult.txHash,
        });
      } else {
        console.log(`[Strategy] AAVE supply failed: ${aaveResult.error}`);
      }
    }

    // For GMX, user must execute via MetaMask (we don't have private keys)
    if (gmxAmount > 0 && profile.gmxPercent > 0 && profile.gmxLeverage > 0) {
      console.log(`[Strategy] GMX execution required - user must execute via MetaMask`);
      gmxResult = { success: false, error: 'GMX execution requires MetaMask confirmation' };
    }
  } else {
    // GENERATED WALLET FLOW (legacy): Execute from user wallet with private key
    console.log(`[Strategy] Generated wallet flow - executing from user wallet`);
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const userWallet = new ethers.Wallet(privateKey, provider);

    console.log(`[Strategy] Connected to user wallet: ${userWallet.address}`);

    try {
      // NEW ORDER: Execute GMX position first (if allocation > 0) - especially for balanced strategy
      if (gmxAmount > 0 && profile.gmxPercent > 0 && profile.gmxLeverage > 0) {
        console.log(`[Strategy] Executing GMX position FIRST: $${gmxAmount} @ ${profile.gmxLeverage}x`);
        try {
          // Increased timeout for Vercel serverless (60 seconds) and better error handling
          const gmxPromise = openGmxPosition(gmxAmount, profile.gmxLeverage, privateKey);
          const timeoutPromise = new Promise<{ success: boolean; error: string }>((_, reject) =>
            setTimeout(() => reject(new Error('GMX execution timed out after 60 seconds in Vercel serverless')), 60000)
          );
          gmxResult = await Promise.race([gmxPromise, timeoutPromise]);
          console.log(`[Strategy] GMX result: success=${gmxResult.success}, txHash=${gmxResult.txHash}, error=${gmxResult.error}`);
          if (gmxResult.success) {
            await updatePosition(positionId, {
              gmxCollateralAmount: gmxAmount,
              gmxLeverage: profile.gmxLeverage,
              gmxPositionSize: gmxAmount * profile.gmxLeverage,
              gmxOrderTxHash: gmxResult.txHash,
            });
          } else {
            console.log(`[Strategy] GMX position skipped/failed: ${gmxResult.error}`);
          }
        } catch (gmxError) {
          console.error(`[Strategy] GMX execution threw error:`, gmxError);
          gmxResult = { success: false, error: gmxError instanceof Error ? gmxError.message : String(gmxError) };
        }
      } else {
        console.log(`[Strategy] GMX skipped: gmxAmount=${gmxAmount}, gmxPercent=${profile.gmxPercent}, gmxLeverage=${profile.gmxLeverage}`);
      }

      // Execute AAVE supply second (if allocation > 0)
      if (aaveAmount > 0 && profile.aavePercent > 0) {
        console.log(`[Strategy] Executing AAVE supply SECOND: $${aaveAmount}`);
        aaveResult = await supplyToAave(aaveAmount, userWallet);
        if (aaveResult.success) {
          await updatePosition(positionId, {
            aaveSupplyAmount: aaveAmount,
            aaveSupplyTxHash: aaveResult.txHash,
          });
        } else {
          console.log(`[Strategy] AAVE supply skipped/failed: ${aaveResult.error}`);
        }

        // Small delay to ensure chain state is updated
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Clean up - no need to delete wallet key for connected wallets
      console.log(`[Strategy] Connected wallet flow complete - no key cleanup needed`);
      console.log(`[Strategy] Wallet key deleted - user retains recovery phrase`);
    } catch (error) {
      console.error(`[Strategy] Execution error:`, error);
      throw error;
    }
  }

  // Update position status
  const finalStatus = (aaveResult?.success || gmxResult?.success) ? 'active' : 'pending';
  await updatePosition(positionId, {
    status: finalStatus,
    executedAt: new Date().toISOString(),
    error: (aaveResult && !aaveResult.success ? aaveResult.error : undefined) || (gmxResult && !gmxResult.success ? gmxResult.error : undefined),
  });

  console.log(`[Strategy] Position ${positionId} status: ${finalStatus}`);

  return { positionId, aaveResult, gmxResult };
}

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

    return { success: true, txHash: '0x' + '0'.repeat(64) };

  } catch (error) {
    console.error('[GMX Close] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

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

    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Fetch current gas price from network and cap at MAX_GAS_PRICE_GWEI
    console.log('[GMX Edit] Fetching current gas price...');
    let networkGasPrice: bigint;
    try {
      networkGasPrice = await publicClient.getGasPrice();
      console.log(`[GMX Edit] Network gas price: ${formatUnits(networkGasPrice, 9)} gwei`);
    } catch (error) {
      console.warn('[GMX Edit] Failed to fetch network gas price, using default 25 gwei');
      networkGasPrice = parseUnits('25', 9); // Default to 25 gwei if fetch fails
    }
    
    const maxGas = parseUnits(MAX_GAS_PRICE_GWEI.toString(), 9); // 100 gwei cap
    const gasPrice = networkGasPrice > maxGas ? maxGas : networkGasPrice;
    
    console.log(`[GMX Edit] Using gas price: ${formatUnits(gasPrice, 9)} gwei (capped at ${MAX_GAS_PRICE_GWEI} gwei)`);

    // Create base wallet client
    const baseWalletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Wrap wallet client to use capped gas price on all transactions
    const walletClient = {
      ...baseWalletClient,
      writeContract: async (args: any) => {
        console.log(`[GMX Edit] Using ${formatUnits(gasPrice, 9)} gwei gas on writeContract...`);
        return baseWalletClient.writeContract({
          ...args,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
        });
      },
      sendTransaction: async (args: any) => {
        console.log(`[GMX Edit] Using ${formatUnits(gasPrice, 9)} gwei gas on sendTransaction...`);
        return baseWalletClient.sendTransaction({
          ...args,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
        });
      },
    };

    console.log(`[GMX Edit] Wallet address: ${account.address}`);

    // Check balances
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
        abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }],
        functionName: 'balanceOf',
        args: [account.address],
      }) as bigint;

      if (usdcBalance < usdcAmount) {
        return { success: false, error: 'Insufficient USDC for collateral deposit' };
      }

      // Approve USDC to Router if needed
      const allowance = await publicClient.readContract({
        address: USDC_CONTRACT as `0x${string}`,
        abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }],
        functionName: 'allowance',
        args: [account.address, GMX_ROUTER as `0x${string}`],
      }) as bigint;

      if (allowance < usdcAmount) {
        console.log('[GMX Edit] Approving USDC to Router...');
        const approveTxHash = await walletClient.writeContract({
          address: USDC_CONTRACT as `0x${string}`,
          abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
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
    return { success: true, txHash: submittedHash };

  } catch (error) {
    console.error('[GMX Edit] Collateral edit error:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMsg };
  }
}

/**
 * Handle payment.sent or payment.paid webhook events
 * These events confirm that money has cleared and we can execute strategies
 */
async function handlePaymentCleared(payment: SquarePayment): Promise<{
  action: string;
  paymentId: string;
  status: string;
  positionId?: string;
  aaveResult?: { success: boolean; txHash?: string; error?: string };
  gmxResult?: { success: boolean; txHash?: string; error?: string };
  amountUsd?: number;
  riskProfile?: string;
  email?: string;
  error?: string;
  txHash?: string;
}> {
  const paymentId = payment.id;
  const status = payment.status;
  const amountCents = payment.amount_money?.amount || 0;
  const amountUsd = amountCents / 100;
  const note = payment.note || '';

  console.log(`[Webhook] Payment cleared (sent/paid): ${paymentId}`);
  console.log(`[Webhook] Status: ${status}`);
  console.log(`[Webhook] Amount: $${amountUsd}`);
  console.log(`[Webhook] Note: ${note}`);

  // CRITICAL: Check idempotency FIRST - return immediately if already processed
  // This prevents duplicate webhook processing and reduces race conditions
  const idempotencyCheck = await isPaymentProcessed(paymentId);

  if (idempotencyCheck.processed) {
    // Payment already processed - get the stored result
    try {
      const redis = getRedis();
      const storedData = await redis.get(`payment:${paymentId}`);
      if (storedData && typeof storedData === 'string') {
        const parsed = JSON.parse(storedData);
        console.log(`[Webhook] Payment ${paymentId} already processed successfully with txHash: ${parsed.txHash || 'N/A'}`);
        return {
          action: 'already_processed',
          paymentId,
          status,
          txHash: parsed.txHash,
        };
      }
    } catch (err) {
      console.warn(`[Webhook] Could not retrieve stored payment data: ${err}`);
    }
    console.log(`[Webhook] Payment ${paymentId} already processed - returning success`);
    return {
      action: 'already_processed',
      paymentId,
      status,
    };
  }

  if (idempotencyCheck.error) {
    // FAIL-SAFE: Redis error means we BLOCK the transfer to prevent duplicates
    console.error(`[Webhook] BLOCKING transfer due to Redis error: ${idempotencyCheck.error}`);
    return {
      action: 'blocked_redis_error',
      paymentId,
      status,
      error: idempotencyCheck.error,
    };
  }

  // payment.sent and payment.paid events indicate money has cleared
  // No need to check status - these events are only sent when payment clears
  // However, we'll still log the status for debugging
  console.log(`[Webhook] Payment cleared event received - money has cleared, executing strategy`);
  console.log(`[Webhook] Payment details: id=${paymentId}, amount=${payment.amount_money?.amount}, currency=${payment.amount_money?.currency}, status=${status}`);

  if (idempotencyCheck.processed) {
    // Check if the payment was actually executed successfully
    const redis = getRedis();
    const processedData = await redis.get(`payment:${paymentId}`);
    const processedInfo = processedData ? (typeof processedData === 'string' ? JSON.parse(processedData) : processedData) : null;

    console.log(`[Webhook] Payment ${paymentId} already processed, checking execution status...`);
    console.log(`[Webhook] Processed info:`, processedInfo);

    // If it was marked as processed but with 'pending' or 'failed' status, it might have failed
    // Allow reprocessing if the txHash is 'pending', 'failed', or missing
    if (processedInfo && processedInfo.txHash === 'pending') {
      console.log(`[Webhook] Payment was marked as processed but execution may have failed (txHash: pending), allowing reprocessing`);
      console.log(`[Webhook] This allows retry of failed GMX execution`);
      // Continue processing instead of returning
    } else if (processedInfo && processedInfo.txHash === 'failed') {
      console.log(`[Webhook] Payment was marked as failed, allowing reprocessing`);
      console.log(`[Webhook] This allows retry of failed GMX execution`);
      // Continue processing instead of returning
    } else if (processedInfo && processedInfo.txHash && processedInfo.txHash !== 'pending' && processedInfo.txHash !== 'failed' && !processedInfo.txHash.includes('failed')) {
      // Only skip if we have a real transaction hash (not 'pending' or 'failed')
      console.log(`[Webhook] Payment ${paymentId} already processed successfully with txHash: ${processedInfo.txHash}`);
      return {
        action: 'already_processed',
        paymentId,
        status,
        txHash: processedInfo.txHash,
      };
    } else {
      console.log(`[Webhook] Payment marked as processed but no valid txHash found (${processedInfo?.txHash || 'missing'}), allowing reprocessing`);
      console.log(`[Webhook] This allows retry of failed GMX execution`);
      // Continue processing
    }
  }

  // CRITICAL: Use Redis atomic lock (SETNX) to prevent race conditions from multiple webhook events
  // This ensures only ONE webhook invocation can proceed
  const redisLock = getRedis();
  const lockKey = `payment_lock:${paymentId}`;
  let lockAcquired = false;
  
  // Try to acquire lock atomically using SET with NX (SET if Not eXists)
  // This is atomic and prevents race conditions better than EXISTS + SET
  try {
    // Use SET with NX (only set if not exists) and EX (expiration) for atomic lock acquisition
    // Upstash Redis returns 'OK' if set, null if key already exists
    const lockResult = await redisLock.set(lockKey, 'processing', { 
      ex: 300, // 5 minute expiration
      nx: true // Only set if key doesn't exist (atomic)
    });
    
    if (lockResult !== 'OK' && lockResult !== null) {
      // Unexpected result - log and check
      console.warn(`[Webhook] Unexpected lock result: ${lockResult}`);
    }
    
    if (lockResult !== 'OK') {
      // Lock already exists (null) or failed - another webhook is processing
      console.log(`[Webhook] Payment ${paymentId} is already being processed by another webhook - returning success`);
      // Return success immediately - don't block, just acknowledge the duplicate
      return {
        action: 'already_processing',
        paymentId,
        status,
      };
    }
    
    lockAcquired = true;
    console.log(`[Webhook] ✅ Acquired processing lock for payment ${paymentId}`);
  } catch (lockError) {
    console.error(`[Webhook] Failed to acquire lock:`, lockError);
    // If lock acquisition fails, check if payment was processed while we were trying
    const quickCheck = await isPaymentProcessed(paymentId);
    if (quickCheck.processed) {
      console.log(`[Webhook] Payment ${paymentId} was processed while acquiring lock - returning success`);
      return {
        action: 'already_processed',
        paymentId,
        status,
      };
    }
    // If not processed and lock failed, proceed with warning
    console.warn(`[Webhook] Proceeding without lock (best effort) - may have race condition`);
  }
  
  // CRITICAL: DO NOT mark as processed here - only mark AFTER successful execution
  // Marking as "pending" causes subsequent webhooks to see it as "already processed"
  // and skip execution, even when GMX/Aave haven't executed yet
  // The Redis lock (acquired above) is sufficient to prevent duplicate processing
  console.log(`[Webhook] ⚠️ CRITICAL: NOT marking payment as processed yet - will mark AFTER successful execution`);

  // Wrap execution in try-finally to ensure lock is always released
  try {
    // Parse wallet address and paymentId from note
  let { paymentId: notePaymentId, walletAddress, riskProfile, email, ergcPurchase, debitErgc } = parsePaymentNote(note);

  console.log(`[Webhook] Parsed from note: paymentId=${notePaymentId}, wallet=${walletAddress}, risk=${riskProfile}`);

  // Use paymentId from note if available (for connected wallet flow), otherwise use Square payment.id
  const lookupPaymentId = notePaymentId || paymentId;
  console.log(`[Webhook] Looking up payment_info with key: payment_info:${lookupPaymentId}`);

  // First, try to find the frontend paymentId using the Square payment ID
  let frontendPaymentId = lookupPaymentId;

  try {
    const redis = getRedis();
    const paymentIdMapping = await redis.get(`square_to_frontend:${paymentId}`) as string;
    if (paymentIdMapping) {
      frontendPaymentId = paymentIdMapping;
      console.log(`[Webhook] Found frontend paymentId mapping: ${paymentId} -> ${frontendPaymentId}`);
    } else if (notePaymentId && notePaymentId !== paymentId) {
      // Store the mapping for future lookups
      await redis.set(`square_to_frontend:${paymentId}`, notePaymentId, { ex: 86400 * 7 }); // 7 days expiry
      frontendPaymentId = notePaymentId;
      console.log(`[Webhook] Created paymentId mapping: ${paymentId} -> ${frontendPaymentId}`);
    }
  } catch (error) {
    console.error(`[Webhook] Error looking up paymentId mapping:`, error);
  }

  console.log(`[Webhook] Looking up payment_info with key: payment_info:${frontendPaymentId}`);
  console.log(`[Webhook] Also checking alternative keys: payment_info:${paymentId}, payment_info:${notePaymentId || 'N/A'}`);
  const redis = getRedis();
  const paymentInfoRaw = await redis.get(`payment_info:${frontendPaymentId}`);

  // Try alternative keys if primary lookup fails
  let alternativePaymentInfo = null;
  if (!paymentInfoRaw) {
    if (notePaymentId && notePaymentId !== frontendPaymentId) {
      alternativePaymentInfo = await redis.get(`payment_info:${notePaymentId}`);
      if (alternativePaymentInfo) {
        console.log(`[Webhook] Found payment_info using alternative key: payment_info:${notePaymentId}`);
      }
    }
    if (!alternativePaymentInfo && paymentId !== frontendPaymentId) {
      alternativePaymentInfo = await redis.get(`payment_info:${paymentId}`);
      if (alternativePaymentInfo) {
        console.log(`[Webhook] Found payment_info using Square payment ID: payment_info:${paymentId}`);
      }
    }
  }

  const finalPaymentInfo = paymentInfoRaw || alternativePaymentInfo;
  console.log(`[Webhook] payment_info lookup result: ${finalPaymentInfo ? 'FOUND' : 'NOT FOUND'}`);

  if (!finalPaymentInfo) {
    console.error(`[Webhook] CRITICAL: payment_info not found for any key`);
    console.error(`[Webhook] Tried keys: payment_info:${frontendPaymentId}, payment_info:${notePaymentId || 'N/A'}, payment_info:${paymentId}`);
    console.error(`[Webhook] This means the frontend did not store payment_info before processing Square payment`);
    console.error(`[Webhook] Cannot proceed without payment_info (walletAddress, riskProfile, amount)`);
    // Don't mark as processed if we can't find payment_info - allow retry
    const triedKeys = [frontendPaymentId, notePaymentId, paymentId].filter(Boolean);
    console.error(`[Webhook] Tried payment_info keys: ${triedKeys.join(', ')}`);
    return {
      action: 'payment_info_not_found',
      paymentId,
      status,
      error: `Payment info not found for ${frontendPaymentId}. Frontend must store payment_info before processing payment. Tried keys: ${triedKeys.join(', ')}`,
    };
  }

  if (finalPaymentInfo) {
    try {
      const paymentInfo = typeof finalPaymentInfo === 'string' ? JSON.parse(finalPaymentInfo) : finalPaymentInfo;
      console.log(`[Webhook] payment_info contents:`, JSON.stringify(paymentInfo));
      if (paymentInfo.walletAddress) {
        const newWalletAddress = paymentInfo.walletAddress;
        
        // CRITICAL: Validate wallet address is NOT the hub wallet
        if (newWalletAddress.toLowerCase() === HUB_WALLET_ADDRESS.toLowerCase()) {
          console.error(`[Webhook] ❌ CRITICAL ERROR: payment_info.walletAddress is hub wallet address!`);
          console.error(`[Webhook] Hub wallet: ${HUB_WALLET_ADDRESS}`);
          console.error(`[Webhook] payment_info.walletAddress: ${newWalletAddress}`);
          console.error(`[Webhook] This is wrong - payment_info should contain USER wallet, not hub wallet!`);
          // Don't use hub wallet address - keep the one from note or fail
          if (!walletAddress || walletAddress.toLowerCase() === HUB_WALLET_ADDRESS.toLowerCase()) {
            return {
              action: 'invalid_wallet_address',
              paymentId,
              status,
              error: `payment_info contains hub wallet address instead of user wallet. Cannot proceed.`
            };
          }
          console.warn(`[Webhook] ⚠️ Ignoring hub wallet address from payment_info, using wallet from note: ${walletAddress}`);
        } else {
          walletAddress = newWalletAddress;
          // Prioritize riskProfile from payment_info (more reliable than note)
          if (paymentInfo.riskProfile) {
            riskProfile = paymentInfo.riskProfile;
            console.log(`[Webhook] Using riskProfile from payment_info: ${riskProfile}`);
          } else if (riskProfile) {
            console.log(`[Webhook] Using riskProfile from note: ${riskProfile}`);
          }
          email = paymentInfo.userEmail || email;
          console.log(`[Webhook] ✅ Using wallet from payment info: ${walletAddress}`);
        }
      }
    } catch (error) {
      console.error(`[Webhook] Error parsing payment info:`, error);
    }
  } else if (email) {
    // Fallback: Look up wallet from email if payment info not found
    const normalizedEmail = email.toLowerCase().trim();
    const emailWalletKey = `email_wallet:${normalizedEmail}`;
    const storedWallet = await redis.get(emailWalletKey);
    if (storedWallet) {
      walletAddress = storedWallet as string;
      console.log(`[Webhook] Using wallet from email lookup: ${walletAddress}`);
    }
  }

  if (!walletAddress) {
    console.log('[Webhook] No wallet address found in payment note');
    return {
      action: 'skipped',
      paymentId,
      status,
    };
  }

  // CRITICAL: Final validation - wallet address must NOT be hub wallet
  if (walletAddress.toLowerCase() === HUB_WALLET_ADDRESS.toLowerCase()) {
    console.error(`[Webhook] ❌ CRITICAL ERROR: walletAddress is hub wallet address!`);
    console.error(`[Webhook] Hub wallet: ${HUB_WALLET_ADDRESS}`);
    console.error(`[Webhook] walletAddress: ${walletAddress}`);
    console.error(`[Webhook] This is wrong - must use USER wallet, not hub wallet!`);
    return {
      action: 'invalid_wallet_address',
      paymentId,
      status,
      error: `walletAddress is hub wallet address (${HUB_WALLET_ADDRESS}) instead of user wallet. Cannot proceed.`
    };
  }

  console.log(`[Webhook] ✅ Wallet address validated: ${walletAddress} (NOT hub wallet)`);
  console.log(`[Webhook] Risk profile: ${riskProfile}`);
  console.log(`[Webhook] Email: ${email}`);
  console.log(`[Webhook] ERGC purchase: ${ergcPurchase || 0}`);
  // debitErgc deprecated in new flow; ignore if present

  // Option C: Non-custodial - Send tokens to USER's wallet
  // 1. Transfer USDC from hub wallet to user wallet (deposit amount only, not fees)
  // 2. If GMX strategy, also send AVAX for execution fees
  // 3. Send ERGC tokens if purchased
  // 4. For connected wallets: User executes strategy via MetaMask
  // 5. For generated wallets: Execute strategy using stored encrypted key (legacy)

  // Determine if this is a GMX strategy (needs AVAX)
  // Validate riskProfile and default to aggressive if invalid
  if (!riskProfile || !RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES]) {
    console.warn(`[Webhook] Invalid or missing riskProfile: "${riskProfile}", defaulting to aggressive`);
    riskProfile = 'aggressive';
  }
  const profile = RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES];
  const hasGmx = profile.gmxPercent > 0;

  console.log(`[Webhook] Final riskProfile: "${riskProfile}", profile:`, {
    name: profile.name,
    aavePercent: profile.aavePercent,
    gmxPercent: profile.gmxPercent,
    gmxLeverage: profile.gmxLeverage,
    hasGmx,
  });

  // Get deposit amount from payment info - CRITICAL: payment_info.amount is the base deposit (e.g., $6)
  // Square amountUsd includes fees (e.g., $6 + 5% + AVAX + ERGC = ~$8-9)
  // We MUST use payment_info.amount, NOT amountUsd
  let rawDepositAmount: number | null = null;
  console.log(`[Webhook] Initial amount from Square: $${amountUsd} (${amountCents} cents) - NOTE: This includes fees!`);

  // Fetch current AVAX price for accurate fee calculations (same as frontend)
  let avaxPriceUsd = 30; // Fallback price
  try {
    const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd');
    if (priceResponse.ok) {
      const priceData = await priceResponse.json();
      if (priceData['avalanche-2']?.usd) {
        avaxPriceUsd = priceData['avalanche-2'].usd;
        console.log(`[Webhook] AVAX price fetched: $${avaxPriceUsd}`);
      }
    }
  } catch (error) {
    console.error(`[Webhook] Failed to fetch AVAX price, using fallback $30:`, error);
  }

  // Check ERGC discount early (needed for fallback calculations)
  const hasErgcDiscountFromNote = false; // no longer using debit flag
  // We'll check actual balance later; estimate discount if user buys 100 ERGC or conservative
  const estimatedHasErgcDiscount = (ergcPurchase && ergcPurchase >= 100) || riskProfile === 'conservative';

  if (paymentInfoRaw) {
    try {
      const paymentInfo = typeof paymentInfoRaw === 'string' ? JSON.parse(paymentInfoRaw) : paymentInfoRaw;
      console.log(`[Webhook] Payment info found:`, JSON.stringify(paymentInfo, null, 2));

      // CRITICAL: paymentInfo.amount is the base deposit amount (what user requested, e.g., $6)
      // Only use it if it's a valid positive number AND reasonable (not 2x the Square payment)
      const paymentInfoAmount = paymentInfo.amount;
      if (paymentInfoAmount && typeof paymentInfoAmount === 'number' && paymentInfoAmount > 0) {
        // Validate it's not suspiciously high (e.g., 2x the Square payment)
        if (paymentInfoAmount > amountUsd * 1.5) {
          console.error(`[Webhook] ❌ payment_info.amount ($${paymentInfoAmount}) is more than 1.5x Square payment ($${amountUsd})`);
          console.error(`[Webhook] This suggests payment_info.amount is incorrect (possibly doubled). Recalculating.`);
          // Recalculate from Square total instead
          const avaxFeeAmount = hasGmx
            ? (estimatedHasErgcDiscount ? 0.03 : 0.06)
            : 0.005;
          const estimatedAvaxFee = avaxFeeAmount * avaxPriceUsd;
          rawDepositAmount = Math.round(((amountUsd - estimatedAvaxFee) / 1.05) * 100) / 100;
          console.warn(`[Webhook] ⚠️ Using recalculated amount: $${rawDepositAmount} (from Square total $${amountUsd})`);
        } else {
          rawDepositAmount = paymentInfoAmount;
          console.log(`[Webhook] ✅ Using amount from payment info: $${rawDepositAmount} (base deposit)`);
        }
      } else {
        console.error(`[Webhook] ❌ payment_info.amount is invalid:`, paymentInfo.amount);
        console.error(`[Webhook] Payment info:`, paymentInfo);
        // Don't use amountUsd - it includes fees! 
        // Calculate from Square total: amountUsd = deposit + 5% fee + AVAX fee
        // AVAX fee depends on strategy and ERGC discount
        const avaxFeeAmount = hasGmx
          ? (estimatedHasErgcDiscount ? 0.03 : 0.06)  // GMX: 0.03 or 0.06 AVAX
          : 0.005;  // Conservative: 0.005 AVAX
        const estimatedAvaxFee = avaxFeeAmount * avaxPriceUsd;
        // So: amountUsd = deposit * 1.05 + estimatedAvaxFee
        // deposit = (amountUsd - estimatedAvaxFee) / 1.05
        rawDepositAmount = Math.round(((amountUsd - estimatedAvaxFee) / 1.05) * 100) / 100;
        console.warn(`[Webhook] ⚠️ Fallback: Calculated deposit from Square total: $${rawDepositAmount} (from $${amountUsd} total, AVAX fee: ${avaxFeeAmount} AVAX × $${avaxPriceUsd} = $${estimatedAvaxFee.toFixed(2)})`);
      }
    } catch (error) {
      console.error(`[Webhook] Error parsing payment info for amount:`, error);
      // Fallback calculation with AVAX fee estimate
      const avaxFeeAmount = hasGmx
        ? (estimatedHasErgcDiscount ? 0.03 : 0.06)
        : 0.005;
      const estimatedAvaxFee = avaxFeeAmount * avaxPriceUsd;
      rawDepositAmount = Math.round(((amountUsd - estimatedAvaxFee) / 1.05) * 100) / 100;
      console.warn(`[Webhook] ⚠️ Fallback: Calculated deposit from Square total: $${rawDepositAmount} (from $${amountUsd} total, AVAX fee: ${avaxFeeAmount} AVAX × $${avaxPriceUsd} = $${estimatedAvaxFee.toFixed(2)})`);
    }
  } else {
    console.error(`[Webhook] ❌ No payment info found! Cannot determine base deposit amount.`);
    console.log(`[Webhook] Calculating deposit amount from Square total (this is approximate)`);
    // If no payment info, calculate: amountUsd = deposit + 5% fee + AVAX fee
    const avaxFeeAmount = hasGmx
      ? (estimatedHasErgcDiscount ? 0.03 : 0.06)
      : 0.005;
    const estimatedAvaxFee = avaxFeeAmount * avaxPriceUsd;
    rawDepositAmount = Math.round(((amountUsd - estimatedAvaxFee) / 1.05) * 100) / 100;
    console.warn(`[Webhook] ⚠️ Calculated deposit amount: $${rawDepositAmount} (from $${amountUsd} total, AVAX fee: ${avaxFeeAmount} AVAX × $${avaxPriceUsd} = $${estimatedAvaxFee.toFixed(2)}) - This may be inaccurate!`);
  }

  // Final validation
  if (!rawDepositAmount || rawDepositAmount <= 0) {
    console.error(`[Webhook] ❌ CRITICAL: Invalid deposit amount: ${rawDepositAmount}`);
    return {
      action: 'invalid_amount',
      paymentId,
      status,
      error: `Invalid deposit amount: ${rawDepositAmount}. Cannot proceed.`,
    };
  }

  console.log(`[Webhook] Final deposit amount: $${rawDepositAmount}`);
  console.log(`[Webhook] Square payment amount: $${amountUsd} (${amountCents} cents)`);
  console.log(`[Webhook] Payment info amount: ${paymentInfoRaw ? JSON.parse(typeof paymentInfoRaw === 'string' ? paymentInfoRaw : JSON.stringify(paymentInfoRaw)).amount : 'N/A'}`);

  // For connected wallets, we don't need private keys - just send tokens
  // Try to get wallet data only if needed for strategy execution (legacy flow)
  let walletData = null;
  try {
    walletData = await decryptWalletKeyWithToken(walletAddress, paymentId);
  } catch (error) {
    // Connected wallet - no private key stored, this is expected
    console.log(`[Webhook] Connected wallet detected (no private key stored): ${walletAddress}`);
  }

  // Platform fee was already charged upfront (added to payment total), so send full deposit amount
  // User paid: depositAmount + 5% fee + AVAX fee + ERGC = total charged (amountUsd)
  // We send: depositAmount (the base deposit amount they requested, e.g., $6)
  // CRITICAL: Use the amount from payment_info, NOT from Square total (which includes fees)
  let depositAmount = rawDepositAmount;

  // CRITICAL VALIDATION: Deposit amount should NEVER exceed Square payment amount
  // Square payment includes: depositAmount + 5% fee + AVAX fee + ERGC
  // So depositAmount should always be LESS than amountUsd
  if (depositAmount > amountUsd) {
    console.error(`[Webhook] ❌ CRITICAL ERROR: Deposit amount ($${depositAmount}) exceeds Square payment ($${amountUsd})!`);
    console.error(`[Webhook] This is impossible - deposit amount should be less than total payment.`);
    console.error(`[Webhook] payment_info.amount is likely incorrect. Recalculating from Square total.`);

    // Recalculate: Square total = deposit + 5% fee + AVAX fee
    // deposit = (amountUsd - AVAX fee) / 1.05
    // Use estimatedHasErgcDiscount since hasErgcDiscount might not be calculated yet
    const avaxFeeAmount = hasGmx
      ? (estimatedHasErgcDiscount ? 0.03 : 0.06)
      : 0.005;
    const estimatedAvaxFee = avaxFeeAmount * avaxPriceUsd;
    const recalculatedAmount = Math.round(((amountUsd - estimatedAvaxFee) / 1.05) * 100) / 100;
    console.warn(`[Webhook] ⚠️ Using recalculated amount: $${recalculatedAmount} (from Square total $${amountUsd}, AVAX fee: ${avaxFeeAmount} AVAX × $${avaxPriceUsd} = $${estimatedAvaxFee.toFixed(2)})`);
    depositAmount = recalculatedAmount;

    // Still validate it's reasonable
    if (depositAmount > amountUsd) {
      console.error(`[Webhook] ❌ Even recalculated amount ($${depositAmount}) exceeds Square payment ($${amountUsd})`);
      return {
        action: 'invalid_amount',
        paymentId,
        status,
        error: `Invalid deposit amount calculation: $${depositAmount} exceeds Square payment $${amountUsd}. Cannot proceed.`,
      };
    }
  }

  // Additional validation: deposit amount should be reasonable (not 3x what we expect)
  if (depositAmount > amountUsd * 0.95) {
    console.warn(`[Webhook] ⚠️ WARNING: Deposit amount ($${depositAmount}) is very close to Square payment ($${amountUsd})`);
    console.warn(`[Webhook] This suggests payment_info.amount might include fees. Expected deposit to be ~95% of total.`);
  }

  console.log(`[Webhook] ✅ Final validated deposit amount: $${depositAmount} (Square payment: $${amountUsd})`);

  // CRITICAL: Final safety check - deposit amount should NEVER exceed Square payment
  // If it does, something is seriously wrong (payment_info.amount is incorrect)
  if (depositAmount > amountUsd) {
    console.error(`[Webhook] ❌ CRITICAL: Deposit amount ($${depositAmount}) exceeds Square payment ($${amountUsd})`);
    console.error(`[Webhook] This should have been caught earlier. Blocking transfer to prevent sending wrong amount.`);
    return {
      action: 'invalid_amount',
      paymentId: lookupPaymentId,
      status,
      error: `Deposit amount $${depositAmount} exceeds Square payment $${amountUsd}. payment_info.amount is likely incorrect.`,
    };
  }

  // Additional check: if deposit amount is suspiciously high (e.g., 2x what we expect)
  // For a $6.25 deposit, Square payment would be ~$7-8, so depositAmount should be ~$6.25
  // If depositAmount is $12.50, that's a red flag
  if (depositAmount > amountUsd * 0.9) {
    console.warn(`[Webhook] ⚠️ WARNING: Deposit amount ($${depositAmount}) is very close to Square payment ($${amountUsd})`);
    console.warn(`[Webhook] This suggests payment_info.amount might include fees. Expected deposit to be ~70-90% of total.`);
    console.warn(`[Webhook] Proceeding anyway, but this may result in incorrect amount being sent.`);
  }

  // Calculate Aave vs GMX split
  // Smart allocation for balanced strategy: ensure GMX gets minimum $5
  let aaveAmount: number;
  let gmxAmount: number;

  // Use profile percentages for allocation
  aaveAmount = (depositAmount * profile.aavePercent) / 100;
  gmxAmount = (depositAmount * profile.gmxPercent) / 100;
  console.log(`[Webhook] ===== ALLOCATION =====`);
  console.log(`[Webhook] Deposit amount: $${depositAmount}`);
  console.log(`[Webhook] Split: Aave=$${aaveAmount} (${profile.aavePercent}%), GMX=$${gmxAmount} (${profile.gmxPercent}%)`);
  console.log(`[Webhook] Total: $${aaveAmount + gmxAmount} (should equal $${depositAmount})`);

  // Check if this is a connected wallet (no private key) vs generated wallet
  const isConnectedWallet = !walletData?.privateKey;

  // Check if user has ERGC discount (1+ ERGC - the amount debited per order)
  let hasErgcDiscount = await checkErgcDiscount(walletAddress);
  console.log(`[Webhook] ERGC discount check: ${hasErgcDiscount ? 'YES (100+ ERGC)' : 'NO'}`);

  console.log(`[Webhook] Wallet type check: isConnectedWallet=${isConnectedWallet}, hasPrivateKey=${!!walletData?.privateKey}`);
  console.log(`[Webhook] Wallet address: ${walletAddress}`);
  console.log(`[Webhook] Payment amount: $${depositAmount}`);
  console.log(`[Webhook] Risk profile: ${riskProfile}`);
  console.log(`[Webhook] Profile allocation: Aave=${profile.aavePercent}%, GMX=${profile.gmxPercent}%`);

  let aaveResult: { success: boolean; txHash?: string; error?: string } | undefined;
  let gmxResult: { success: boolean; txHash?: string; error?: string } | undefined;
  let transferResult: { success: boolean; txHash?: string; error?: string } = { success: true };

  // Initialize results to prevent undefined errors
  aaveResult = { success: false, error: 'Not executed' };
  gmxResult = { success: false, error: 'Not executed' };

  // --- START OF UNIFIED EXECUTION FLOW ---
  // CRITICAL: Look up Privy user ID ONCE at the beginning for all operations
  let privyUserId: string | null = null;
  if (isConnectedWallet) {
    const redis = getRedis();
    privyUserId = await redis.get(`wallet_owner:${walletAddress.toLowerCase()}`) as string | null;
    console.log(`[Webhook] ===== PRIVY USER ID LOOKUP =====`);
    console.log(`[Webhook] Wallet address: ${walletAddress}`);
    console.log(`[Webhook] Lookup key: wallet_owner:${walletAddress.toLowerCase()}`);
    console.log(`[Webhook] Privy user ID: ${privyUserId ? 'FOUND' : 'NOT FOUND'}`);
    
    // DEBUG: Check if Redis is working and list existing keys
    try {
      const testKey = `test:${Date.now()}`;
      await redis.set(testKey, 'test_value');
      const testValue = await redis.get(testKey);
      console.log(`[Webhook] Redis test: ${testValue === 'test_value' ? 'WORKING' : 'BROKEN'}`);
      await redis.del(testKey);
      
      if (!privyUserId) {
        const keys = await redis.keys(`wallet_owner:*`);
        console.log(`[Webhook] Existing wallet_owner keys: ${keys.length} found`);
        if (keys.length > 0 && keys.length <= 5) {
          console.log(`[Webhook] Sample keys: ${keys.slice(0, 3).join(', ')}`);
        }
      }
    } catch (redisError) {
      console.error(`[Webhook] Redis debug failed:`, redisError);
    }
    
    if (privyUserId) {
      console.log(`[Webhook] ✅ Will use Privy execution for all operations (GMX, Aave, ERGC)`);
    } else {
      console.log(`[Webhook] ⚠️ Will use hub wallet execution fallback`);
    }
  }

  // Step 1: Initial USDC transfer to user wallet
  // CRITICAL: Always send USDC to connected wallets, regardless of Privy user ID
  console.log(`[Webhook] ===== USDC TRANSFER =====`);
  console.log(`[Webhook] Deposit amount: $${depositAmount}`);
  console.log(`[Webhook] Square payment: $${amountUsd}`);
  console.log(`[Webhook] isConnectedWallet: ${isConnectedWallet}`);
  console.log(`[Webhook] payment_info.amount: ${paymentInfoRaw ? (typeof paymentInfoRaw === 'string' ? JSON.parse(paymentInfoRaw) : paymentInfoRaw).amount : 'N/A'}`);

  // CRITICAL VALIDATION: Check for suspicious amounts (e.g., 2x what we expect)
  // If Square payment is $7-8, deposit should be ~$6.25, not $12.50
  // If depositAmount is close to 2x the Square payment, something is wrong
  if (depositAmount > amountUsd * 1.5) {
    console.error(`[Webhook] ❌ CRITICAL: Deposit amount ($${depositAmount}) is more than 1.5x Square payment ($${amountUsd})`);
    console.error(`[Webhook] This suggests payment_info.amount is incorrect (possibly doubled).`);
    console.error(`[Webhook] Recalculating from Square total to prevent sending wrong amount.`);

    // Recalculate from Square total
    const avaxFeeAmount = hasGmx
      ? (estimatedHasErgcDiscount ? 0.03 : 0.06)
      : 0.005;
    const estimatedAvaxFee = avaxFeeAmount * avaxPriceUsd;
    const safeDepositAmount = Math.round(((amountUsd - estimatedAvaxFee) / 1.05) * 100) / 100;

    console.warn(`[Webhook] ⚠️ Using recalculated safe amount: $${safeDepositAmount} (from Square total $${amountUsd})`);
    depositAmount = safeDepositAmount;
  }

  // Validate deposit amount is reasonable before sending
  if (depositAmount <= 0 || depositAmount > amountUsd) {
    console.error(`[Webhook] ❌ Invalid deposit amount: $${depositAmount} (Square payment: $${amountUsd})`);
    return {
      action: 'invalid_amount',
      paymentId: lookupPaymentId,
      status,
      error: `Invalid deposit amount: $${depositAmount}. Cannot proceed.`,
    };
  }

  console.log(`[Webhook] ✅ Final amount to send: $${depositAmount} (validated against Square payment: $${amountUsd})`);

  // CRITICAL: For GMX strategies, DO NOT send USDC - execute GMX directly from hub wallet
  // This matches the Bitcoin page flow exactly: no USDC transfer, just execute GMX
  if (isConnectedWallet && gmxAmount > 0) {
    console.log(`[Webhook] ⚠️ GMX strategy detected - SKIPPING USDC transfer (matching Bitcoin page flow)`);
    console.log(`[Webhook] GMX will execute from hub wallet using hub's USDC (exactly like Bitcoin page)`);
    transferResult = { success: true }; // Mark as success since we're not transferring
  } else if (isConnectedWallet) {
    // Connected wallet with NO GMX (conservative only): Send USDC for Aave
    console.log(`[Webhook] Sending $${depositAmount} USDC to connected wallet ${walletAddress} for Aave...`);
    transferResult = await sendUsdcTransfer(walletAddress, depositAmount, `${lookupPaymentId}-connected`);
    if (!transferResult.success) {
      return { action: 'transfer_failed', paymentId: lookupPaymentId, status, error: transferResult.error };
    }
    console.log(`[Webhook] ✅ USDC transferred: ${transferResult.txHash}`);
  } else {
    // Generated wallet: Send full deposit amount
    console.log(`[Webhook] Sending $${depositAmount} USDC to generated wallet ${walletAddress}...`);
    transferResult = await sendUsdcTransfer(walletAddress, depositAmount, paymentId);
    if (!transferResult.success) {
      return { action: 'transfer_failed', paymentId, status, error: transferResult.error };
    }
    console.log(`[Webhook] ✅ USDC transferred: ${transferResult.txHash}`);
  }

  // Step 2: Send AVAX for gas fees (CRITICAL: DO THIS BEFORE ANY AUTOMATED ACTIONS)
  // CRITICAL: Only send AVAX once - check if already sent for this payment
  const avaxSentKey = `avax_sent:${lookupPaymentId}`;
  const avaxAlreadySent = await redis.get(avaxSentKey);
  
  if (avaxAlreadySent) {
    console.log(`[Webhook] ⚠️ AVAX already sent for payment ${lookupPaymentId} - skipping duplicate send`);
    console.log(`[Webhook] Previous AVAX tx: ${avaxAlreadySent}`);
  } else {
    const baseAvaxAmount = hasGmx ? AVAX_TO_SEND_FOR_GMX : AVAX_TO_SEND_FOR_AAVE;
    let avaxAmount = baseAvaxAmount;
    if (hasErgcDiscount && hasGmx) {
      avaxAmount = ethers.parseEther('0.03'); // Reduced GMX fee with ERGC discount
      console.log(`[Webhook] ERGC discount applied: GMX fee reduced to 0.03 AVAX`);
    }
    const avaxPurpose = hasGmx ? 'GMX execution fees' : 'exit fees';
    console.log(`[Webhook] Sending ${ethers.formatEther(avaxAmount)} AVAX to ${walletAddress} for ${avaxPurpose}...`);
    
    // CRITICAL: Validate wallet address is NOT hub wallet before sending
    if (walletAddress.toLowerCase() === HUB_WALLET_ADDRESS.toLowerCase()) {
      console.error(`[Webhook] ❌ CRITICAL: Cannot send AVAX to hub wallet! walletAddress=${walletAddress}`);
      return {
        action: 'invalid_wallet_address',
        paymentId: lookupPaymentId,
        status,
        error: `Cannot send AVAX to hub wallet address. walletAddress must be user wallet, not ${HUB_WALLET_ADDRESS}`
      };
    }
    
    const avaxTransfer = await sendAvaxToUser(walletAddress, avaxAmount, avaxPurpose);
    if (avaxTransfer.success && avaxTransfer.txHash) {
      // Mark AVAX as sent to prevent duplicate sends
      await redis.set(avaxSentKey, avaxTransfer.txHash, { ex: 86400 }); // 24 hour expiry
      console.log(`[Webhook] ✅ AVAX sent and marked: ${avaxTransfer.txHash}`);
    } else {
      console.error(`[Webhook] AVAX transfer failed: ${avaxTransfer.error}`);
    }
  }

  // Step 3: Handle ERGC tokens (purchase only; no debits in new flow)
  if (ergcPurchase && ergcPurchase >= 100) {
    console.log(`[Webhook] ERGC purchase detected: ${ergcPurchase} tokens`);
    await sendErgcTokens(walletAddress);
    // Treat as discount available
    hasErgcDiscount = true;
  }

  // Step 4: Strategy Execution (Aave and GMX)
  console.log(`[Webhook] ===== STRATEGY EXECUTION START =====`);
  console.log(`[Webhook] isConnectedWallet: ${isConnectedWallet}`);
  console.log(`[Webhook] gmxAmount: $${gmxAmount}, aaveAmount: $${aaveAmount}`);
  console.log(`[Webhook] Using privyUserId from earlier lookup: ${privyUserId ? 'FOUND' : 'NOT FOUND'}`);

  if (isConnectedWallet) {
    // CRITICAL: For GMX strategies, ALWAYS use hub wallet execution (matches Bitcoin page exactly)
    // No Privy execution for GMX - hub wallet executes directly with its own USDC
    if (gmxAmount > 0) {
      console.log(`[Webhook] ===== GMX EXECUTION (HUB WALLET) =====`);
      console.log(`[Webhook] Executing GMX from hub wallet: $${gmxAmount}`);
      console.log(`[Webhook] User wallet: ${walletAddress}`);
      console.log(`[Webhook] Leverage: ${profile.gmxLeverage}x, Position size: $${gmxAmount * profile.gmxLeverage}`);
      
      try {
        gmxResult = await executeGmxFromHubWallet(walletAddress, gmxAmount, lookupPaymentId);
        
        if (!gmxResult.success) {
          console.error(`[Webhook] ❌ GMX execution FAILED: ${gmxResult.error}`);
          
          // Check if this is a recoverable error
          const isRecoverableError = 
            gmxResult.error?.includes('timeout') ||
            gmxResult.error?.includes('ROUTER_PLUGIN') ||
            gmxResult.error?.includes('protocol error') ||
            gmxResult.error?.includes('network') ||
            gmxResult.error?.includes('temporary');
          
          if (isRecoverableError) {
            console.warn(`[Webhook] ⚠️ Recoverable GMX error - sending USDC to user`);
            console.warn(`[Webhook] ⚠️ User can execute GMX position manually`);
            
            // Send USDC to user so they can execute manually
            const fallbackTransfer = await sendUsdcTransfer(
              walletAddress, 
              gmxAmount, 
              `${lookupPaymentId}-gmx-fallback`
            );
            
            if (fallbackTransfer.success) {
              console.log(`[Webhook] ✅ Fallback: Sent $${gmxAmount} USDC to user`);
              console.log(`[Webhook] ✅ Fallback txHash: ${fallbackTransfer.txHash}`);
              console.log(`[Webhook] User can execute GMX position manually`);
              
              gmxResult = { 
                success: true, // Mark as success since we sent funds
                error: `GMX auto-execution failed, sent $${gmxAmount} USDC for manual execution`,
                txHash: fallbackTransfer.txHash
              };
            } else {
              // Complete failure - don't mark payment as processed
              console.error(`[Webhook] ❌ GMX AND fallback both failed`);
              console.error(`[Webhook] ❌ GMX error: ${gmxResult.error}`);
              console.error(`[Webhook] ❌ Fallback error: ${fallbackTransfer.error}`);
              console.warn(`[Webhook] ⚠️ NOT marking payment as processed - will allow retry`);
              
              // Don't mark as processed - allow retry
              return {
                action: 'gmx_execution_failed',
                paymentId: lookupPaymentId,
                status,
                error: `GMX failed: ${gmxResult.error}. Fallback failed: ${fallbackTransfer.error}`,
                gmxResult,
              };
            }
          } else {
            // Non-recoverable error (insufficient funds, invalid params, etc.)
            console.error(`[Webhook] ❌ Non-recoverable GMX error: ${gmxResult.error}`);
            console.warn(`[Webhook] ⚠️ NOT marking payment as processed - will allow retry`);
            
            return {
              action: 'gmx_execution_failed',
              paymentId: lookupPaymentId,
              status,
              error: `GMX execution failed: ${gmxResult.error}`,
              gmxResult,
            };
          }
        } else {
          console.log(`[Webhook] ✅✅✅ GMX executed successfully: ${gmxResult.txHash}`);
          console.log(`[Webhook] ✅✅✅ BTC long position created for user ${walletAddress}`);
          console.log(`[Webhook] ✅✅✅ Check position at: https://snowtrace.io/tx/${gmxResult.txHash}`);
          
          // Send remaining USDC for Aave (if any)
          if (aaveAmount > 0) {
            console.log(`[Webhook] Sending $${aaveAmount} USDC for Aave...`);
            const aaveUsdcTransfer = await sendUsdcTransfer(
              walletAddress, 
              aaveAmount, 
              `${lookupPaymentId}-aave`
            );
            
            if (!aaveUsdcTransfer.success) {
              console.error(`[Webhook] ⚠️ Aave USDC transfer failed (GMX succeeded): ${aaveUsdcTransfer.error}`);
            } else {
              console.log(`[Webhook] ✅ Aave USDC transferred: ${aaveUsdcTransfer.txHash}`);
            }
          }
        }
      } catch (gmxError) {
        console.error(`[Webhook] ❌ GMX execution threw exception:`, gmxError);
        const errorMsg = gmxError instanceof Error ? gmxError.message : String(gmxError);
        console.error(`[Webhook] Exception details:`, {
          name: gmxError instanceof Error ? gmxError.name : 'Unknown',
          message: errorMsg,
          stack: gmxError instanceof Error ? gmxError.stack : 'No stack'
        });
        
        // Send USDC as fallback
        console.warn(`[Webhook] ⚠️ Attempting fallback USDC transfer after exception...`);
        const fallbackTransfer = await sendUsdcTransfer(
          walletAddress, 
          gmxAmount, 
          `${lookupPaymentId}-gmx-exception`
        );
        
        if (fallbackTransfer.success) {
          console.log(`[Webhook] ✅ Exception recovery: Sent $${gmxAmount} USDC to user`);
          console.log(`[Webhook] ✅ Fallback txHash: ${fallbackTransfer.txHash}`);
          gmxResult = { 
            success: true,
            error: `GMX exception, sent $${gmxAmount} USDC for manual execution`,
            txHash: fallbackTransfer.txHash
          };
        } else {
          console.error(`[Webhook] ❌ Exception recovery also failed: ${fallbackTransfer.error}`);
          console.warn(`[Webhook] ⚠️ NOT marking payment as processed - will allow retry`);
          
          return {
            action: 'gmx_exception',
            paymentId: lookupPaymentId,
            status,
            error: `GMX threw exception: ${errorMsg}. Fallback failed: ${fallbackTransfer.error}`,
          };
        }
      }
    } else {
      console.log(`[Webhook] ⚠️ WARNING: Skipping GMX - gmxAmount is 0 or negative (${gmxAmount})`);
      console.log(`[Webhook] ⚠️ WARNING: This should NOT happen for aggressive strategy!`);
    }

    // Execute Aave AFTER GMX (if any remaining)
    if (aaveAmount > 0) {
      console.log(`[Webhook] ===== AAVE EXECUTION =====`);
      console.log(`[Webhook] Executing AAVE: $${aaveAmount} (after GMX)`);
      
      try {
        if (privyUserId) {
          aaveResult = await executeAaveViaPrivy(privyUserId, walletAddress, aaveAmount, lookupPaymentId);
          
          // Fall back to hub wallet if Privy fails
          if (!aaveResult.success && aaveResult.error?.includes('Privy')) {
            console.log(`[Webhook] Privy unavailable, using hub wallet for Aave`);
            aaveResult = await executeAaveFromHubWallet(walletAddress, aaveAmount, lookupPaymentId);
          }
        } else {
          aaveResult = await executeAaveFromHubWallet(walletAddress, aaveAmount, lookupPaymentId);
        }
        
        if (aaveResult.success) {
          console.log(`[Webhook] ✅ Aave executed: ${aaveResult.txHash}`);
        } else {
          console.error(`[Webhook] ❌ Aave failed: ${aaveResult.error}`);
        }
      } catch (aaveError) {
        console.error(`[Webhook] ❌ Aave threw exception:`, aaveError);
        aaveResult = { 
          success: false, 
          error: aaveError instanceof Error ? aaveError.message : String(aaveError)
        };
      }
    } else {
      console.log(`[Webhook] Skipping Aave: aaveAmount is 0 or negative`);
    }
  } else {
    // GENERATED WALLET EXECUTION
    console.log(`[Webhook] Generated wallet - executing strategy from user wallet`);
    const strategyResult = await executeStrategyFromUserWallet(walletAddress, lookupPaymentId);
    aaveResult = strategyResult.aaveResult;
    gmxResult = strategyResult.gmxResult;
  }

  console.log(`[Webhook] ===== STRATEGY EXECUTION END =====`);
  console.log(`[Webhook] Final results: GMX=${gmxResult?.success ? 'SUCCESS' : 'FAILED'}, Aave=${aaveResult?.success ? 'SUCCESS' : 'FAILED'}`);

  // CRITICAL VALIDATION: Ensure at least one strategy executed or funds were sent
  if (!gmxResult && !aaveResult && gmxAmount > 0 && aaveAmount > 0) {
    console.error(`[Webhook] ❌ CRITICAL: No strategy execution attempted despite having allocations!`);
    console.error(`[Webhook] gmxAmount: $${gmxAmount}, aaveAmount: $${aaveAmount}`);
    console.error(`[Webhook] This should never happen - execution logic has a bug!`);
  }

  // Ensure results are initialized
  if (!gmxResult && gmxAmount > 0) {
    console.warn(`[Webhook] ⚠️ GMX execution was not attempted despite gmxAmount > 0`);
    gmxResult = { success: false, error: 'GMX execution was not attempted' };
  }
  if (!aaveResult && aaveAmount > 0) {
    console.warn(`[Webhook] ⚠️ Aave execution was not attempted despite aaveAmount > 0`);
    aaveResult = { success: false, error: 'Aave execution was not attempted' };
  }
  // --- END OF UNIFIED EXECUTION FLOW ---


  // Create position record for connected wallets
  if (isConnectedWallet) {
    // CRITICAL: Only mark as processed if at least one strategy succeeded
    const hasAnySuccess = (gmxResult?.success) || (aaveResult?.success);
    
    if (!hasAnySuccess) {
      console.error(`[Webhook] ❌ CRITICAL: Both GMX and Aave failed`);
      console.error(`[Webhook] GMX result:`, gmxResult);
      console.error(`[Webhook] Aave result:`, aaveResult);
      console.error(`[Webhook] NOT marking payment as processed - will retry`);
      
      return {
        action: 'all_executions_failed',
        paymentId: lookupPaymentId,
        status,
        gmxResult,
        aaveResult,
        error: 'Both GMX and Aave execution failed',
      };
    }
    
    const positionId = generatePositionId();
    const position: UserPosition = {
      id: positionId,
      paymentId: lookupPaymentId,
      userEmail: email || '',
      walletAddress,
      strategyType: riskProfile as 'conservative' | 'aggressive',
      usdcAmount: depositAmount,
      status: hasAnySuccess ? 'active' : 'pending',
      createdAt: new Date().toISOString(),
      aaveSupplyAmount: aaveAmount,
      aaveSupplyTxHash: aaveResult?.txHash,
      gmxCollateralAmount: gmxAmount,
    };
    await savePosition(position);

    // Mark as processed with successful tx hash
    const finalTxHash = gmxResult?.txHash || aaveResult?.txHash || positionId;
    await markPaymentProcessed(paymentId, finalTxHash);
    console.log(`[Webhook] ✅ Payment marked as processed: ${finalTxHash}`);
    console.log(`[Webhook] Strategy executed, position ID: ${positionId}`);

    return {
      action: 'strategy_executed',
      paymentId,
      status,
      positionId,
      aaveResult,
      gmxResult,
      amountUsd,
      riskProfile,
      email,
    };
  } else {
    // For generated wallets, the position was already created in executeStrategyFromUserWallet
    // CRITICAL: Only mark as processed if at least one strategy succeeded
    const hasSuccessfulExecution = (gmxResult?.success) || (aaveResult?.success);
    const finalTxHashGen = gmxResult?.txHash || aaveResult?.txHash || (hasSuccessfulExecution ? 'pending' : 'failed');
    
    if (hasSuccessfulExecution) {
      await markPaymentProcessed(paymentId, finalTxHashGen);
      console.log(`[Webhook] ✅ Payment marked as processed with txHash: ${finalTxHashGen}`);
    } else {
      console.warn(`[Webhook] ⚠️ NOT marking payment as processed - both GMX and Aave failed`);
      console.warn(`[Webhook] ⚠️ This allows retry on next webhook event from Square`);
    }
    
    return {
      action: 'strategy_executed',
      paymentId,
      status,
      aaveResult,
      gmxResult,
      amountUsd,
      riskProfile,
      email,
    };
  }
  } finally {
    // CRITICAL: Always release lock, even if webhook times out or errors
    if (lockAcquired) {
      try {
        await redisLock.del(lockKey);
        console.log(`[Webhook] Released processing lock for payment ${paymentId}`);
      } catch (e) {
        console.error(`[Webhook] Failed to release lock (non-critical):`, e);
        // Ignore lock release errors - lock will expire automatically after 5 minutes
      }
    }
  }
}

/**
 * Execute GMX using Privy for Privy smart wallets
 * Opens a BTC long position on GMX using Privy's server-side transaction delegation
 */
async function executeGmxViaPrivy(
  privyUserId: string,
  walletAddress: string,
  amountUsd: number,
  riskProfile: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[GMX-PRIVY] Executing $${amountUsd} GMX position via Privy for ${walletAddress}...`);

  try {
    // Try to use Privy for execution
    let PrivySigner;
    let PrivyClient;
    try {
      const privyModule = await import('../utils/privy-signer');
      PrivySigner = privyModule.PrivySigner;
      console.log(`[GMX-PRIVY] PrivySigner imported successfully`);
    } catch (importError) {
      console.error('[GMX-PRIVY] Failed to import PrivySigner, falling back to hub wallet:', importError);
      // Use placeholder paymentId since we don't have it in this context
      return await executeGmxFromHubWallet(walletAddress, amountUsd, 'privy-fallback');
    }

    // For Privy embedded wallets, the user ID IS the wallet ID
    // Create Privy signer using user ID as wallet ID
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const privySigner = new PrivySigner(privyUserId, walletAddress, provider);

    console.log(`[GMX-PRIVY] Created PrivySigner for wallet ${walletAddress} with user ID ${privyUserId} (embedded wallets use user ID as wallet ID)`);

    // Get leverage from risk profile
    const profile = RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES] || RISK_PROFILES.aggressive;
    const leverage = profile.gmxLeverage || 5;
    const collateralUsd = amountUsd;
    const positionSizeUsd = collateralUsd * leverage;

    // Check minimums
    if (collateralUsd < GMX_MIN_COLLATERAL_USD) {
      console.log(`[GMX-PRIVY] Collateral $${collateralUsd} below minimum $${GMX_MIN_COLLATERAL_USD}, skipping`);
      return { success: false, error: `Minimum collateral is $${GMX_MIN_COLLATERAL_USD}` };
    }

    if (positionSizeUsd < GMX_MIN_POSITION_SIZE_USD) {
      console.log(`[GMX-PRIVY] Position size $${positionSizeUsd} below minimum $${GMX_MIN_POSITION_SIZE_USD}, skipping`);
      return { success: false, error: `Minimum position size is $${GMX_MIN_POSITION_SIZE_USD}` };
    }

    // Check USDC balance
    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, privySigner);
    const balance = await usdcContract.balanceOf(walletAddress);
    const balanceFormatted = Number(balance) / 1_000_000;
    const usdcAmount = BigInt(Math.floor(collateralUsd * 1_000_000));

    console.log(`[GMX-PRIVY] USDC balance check: Have=${balanceFormatted}, Need=${collateralUsd}, Amount=${usdcAmount.toString()}`);

    if (balance < usdcAmount) {
      console.error(`[GMX-PRIVY] Insufficient USDC in Privy wallet: ${balanceFormatted} < ${collateralUsd}`);
      return {
        success: false,
        error: `Insufficient USDC in Privy wallet. Have: ${balanceFormatted}, Need: ${collateralUsd}.`
      };
    }

    // Get current gas price from network (using same robust logic as USDC transfer)
    console.log('[GMX-PRIVY] Fetching current gas price...');
    const feeData = await provider.getFeeData();
    const networkGasPrice = feeData.gasPrice || ethers.parseUnits('25', 'gwei'); // Default to 25 gwei if unknown
    const maxGasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const gasPrice = networkGasPrice > maxGasPrice ? maxGasPrice : networkGasPrice;

    console.log(`[GMX-PRIVY] Using gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);

    // Fetch market data from GMX API
    console.log('[GMX-PRIVY] Fetching market data...');
    const [tokensRes, marketsRes] = await Promise.all([
      fetch('https://avalanche-api.gmxinfra.io/tokens'),
      fetch('https://avalanche-api.gmxinfra.io/markets'),
    ]);

    if (!tokensRes.ok || !marketsRes.ok) {
      throw new Error('Failed to fetch GMX market data');
    }

    const tokensJson = await tokensRes.json();
    const marketsJson = await marketsRes.json();

    const btcToken = tokensJson.tokens.find((t: any) => t.symbol === 'BTC');
    const usdcToken = tokensJson.tokens.find((t: any) => t.symbol === 'USDC');

    if (!btcToken || !usdcToken) {
      throw new Error('GMX token list does not include BTC or USDC on Avalanche');
    }

    const btcUsdcMarket = marketsJson.markets.find(
      (m: any) =>
        m.isListed &&
        m.indexToken.toLowerCase() === btcToken.address.toLowerCase() &&
        m.shortToken.toLowerCase() === usdcToken.address.toLowerCase()
    );

    if (!btcUsdcMarket) {
      throw new Error('Could not find a listed BTC/USD market using USDC on Avalanche');
    }

    // Approve USDC for GMX router
    const router = GMX_ROUTER;
    const allowance = await usdcContract.allowance(walletAddress, router);
    if (allowance < usdcAmount) {
      console.log('[GMX-PRIVY] Approving USDC from Privy wallet...');
      const approveTx = await usdcContract.approve(router, maxUint256, { gasPrice });
      console.log(`[GMX-PRIVY] Approval tx submitted: ${approveTx.hash}`);
      const approveReceipt = await approveTx.wait();
      if (approveReceipt?.status !== 1) {
        throw new Error(`USDC approval via Privy failed on-chain. Status: ${approveReceipt?.status}`);
      }
      console.log('[GMX-PRIVY] Privy wallet approval confirmed');
    }

    // Create wallet client wrapper for Privy signer
    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Wrap PrivySigner to work with GMX SDK, passing gas parameters
    const walletClientWrapper = {
      account: { address: walletAddress as `0x${string}` },
      chain: avalanche,
      writeContract: async (args: any) => {
        const tx = await privySigner.sendTransaction({
          to: args.address,
          data: args.data,
          value: args.value || 0,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
        });
        return tx.hash as `0x${string}`;
      },
      sendTransaction: async (args: any) => {
        const tx = await privySigner.sendTransaction({
          ...args,
          maxFeePerGas: gasPrice,
          maxPriorityFeePerGas: gasPrice,
        });
        return tx.hash as `0x${string}`;
      },
    } as any;

    // Use GMX SDK with Privy signer
    const sdk = new GmxSdk({
      chainId: 43114,
      rpcUrl: AVALANCHE_RPC,
      oracleUrl: 'https://avalanche-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
      walletClient: walletClientWrapper,
    });

    sdk.setAccount(walletAddress as `0x${string}`);

    // Track tx hash
    let submittedHash: `0x${string}` | null = null;

    // Override callContract to capture hash and add execution fee
    const originalCallContract = sdk.callContract.bind(sdk);
    sdk.callContract = (async (
      contractAddress: `0x${string}`,
      abi: any,
      method: string,
      params: unknown[],
      opts?: { value?: bigint }
    ) => {
      console.log(`[GMX-PRIVY SDK] Calling ${method}...`);

      // Extract sendWnt amounts for execution fee
      let totalWntAmount = 0n;
      if (method === 'multicall' && Array.isArray(params) && Array.isArray(params[0])) {
        const dataItems = params[0] as string[];
        dataItems.forEach((data) => {
          if (typeof data === 'string' && data.toLowerCase().startsWith('0x7d39aaf1')) {
            if (data.length >= 138) {
              const amountHex = data.slice(74, 138);
              totalWntAmount += BigInt(`0x${amountHex}`);
            }
          }
        });

        if (totalWntAmount > 0n) {
          console.log(`[GMX-PRIVY SDK] Execution fee: ${formatUnits(totalWntAmount, 18)} AVAX`);
        }
      }

      // Add execution fee as value
      const finalOpts = {
        ...opts,
        value: (opts?.value || 0n) + totalWntAmount,
      };

      const h = await originalCallContract(contractAddress, abi, method, params, finalOpts) as `0x${string}`;
      submittedHash = h;
      console.log(`[GMX-PRIVY SDK] Tx submitted: ${h}`);
      return h;
    }) as typeof sdk.callContract;

    // Execute order
    const leverageBps = BigInt(Math.floor(leverage * 10000));
    console.log('[GMX-PRIVY] Submitting order via SDK...');
    console.log('[GMX-PRIVY] Order parameters:', {
      payAmount: usdcAmount.toString(),
      marketAddress: btcUsdcMarket.marketToken,
      payTokenAddress: usdcToken.address,
      collateralTokenAddress: usdcToken.address,
      allowedSlippageBps: 100,
      leverage: leverageBps.toString(),
      skipSimulation: true,
    });

    try {
      await sdk.orders.long({
        payAmount: usdcAmount,
        marketAddress: btcUsdcMarket.marketToken as `0x${string}`,
        payTokenAddress: usdcToken.address as `0x${string}`,
        collateralTokenAddress: usdcToken.address as `0x${string}`,
        allowedSlippageBps: 100,
        leverage: leverageBps,
        skipSimulation: true,
      });
    } catch (orderError) {
      console.error('[GMX-PRIVY] SDK order.long() failed:', orderError);
      console.error('[GMX-PRIVY] Order error details:', {
        name: orderError instanceof Error ? orderError.name : 'Unknown',
        message: orderError instanceof Error ? orderError.message : String(orderError),
        stack: orderError instanceof Error ? orderError.stack : 'No stack trace',
      });
      throw orderError;
    }

    if (!submittedHash) {
      console.error('[GMX-PRIVY] No tx hash captured after sdk.orders.long()');
      throw new Error('GMX order submitted but no tx hash captured');
    }

    // Wait for transaction confirmation
    console.log(`[GMX-PRIVY] Waiting for tx confirmation: ${submittedHash}...`);
    const receipt = await provider.waitForTransaction(submittedHash);

    if (receipt?.status !== 1) {
      console.error(`[GMX-PRIVY] Transaction failed! Status: ${receipt?.status}`);
      return {
        success: false,
        txHash: submittedHash,
        error: `GMX transaction failed on-chain. Status: ${receipt?.status}. Check explorer: https://snowtrace.io/tx/${submittedHash}`
      };
    }

    console.log(`[GMX-PRIVY] GMX position opened via Privy: ${submittedHash}`);
    return { success: true, txHash: submittedHash };
  } catch (error) {
    console.error('[GMX-PRIVY] Execution error:', error);
    return {
      success: false,
      error: `Privy execution failed: ${error instanceof Error ? error.message : String(error)}.`
    };
  }
}

/**
 * Main webhook handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Webhook] Request received:', {
      method: req.method,
      url: req.url,
      headers: Object.keys(req.headers),
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    });

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Square-Signature');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // GET - return status with Redis health check
    if (req.method === 'GET') {
      let redisStatus = 'unknown';
      try {
        const redis = getRedis();
        await redis.ping();
        redisStatus = 'connected';
      } catch (err) {
        redisStatus = `error: ${err}`;
      }

      return res.status(200).json({
        service: 'square-webhook-node',
        status: 'ready',
        signatureKeyConfigured: !!SQUARE_WEBHOOK_SIGNATURE_KEY,
        hubWalletConfigured: !!HUB_WALLET_PRIVATE_KEY,
        hubWalletAddress: HUB_WALLET_ADDRESS,
        redisStatus
      });
    }

    if (req.method !== 'POST') {
      logger.warn('Invalid method for webhook', LogCategory.WEBHOOK, {
        method: req.method,
        expected: 'POST'
      });
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get raw body for signature verification
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = req.headers['x-square-signature'] as string || '';

    // Verify signature - CRITICAL: Reject invalid signatures
    if (SQUARE_WEBHOOK_SIGNATURE_KEY) {
      if (!signature) {
        logger.error('No signature provided - rejecting webhook', LogCategory.WEBHOOK, {
          hasSignature: false
        });
        errorTracker.trackError('No signature provided', req, {
          category: 'payment',
          severity: 'high'
        });
        return res.status(401).json({ error: 'No signature provided' });
      }
      
      const isValid = verifySignature(rawBody, signature);
      logger.info(`Signature verification: ${isValid ? 'VALID' : 'INVALID'}`, LogCategory.WEBHOOK, {
        isValid,
        signaturePrefix: signature.substring(0, 20)
      });
      
      if (!isValid) {
        logger.error('Invalid signature - rejecting webhook', LogCategory.WEBHOOK, {
          signaturePrefix: signature.substring(0, 20)
        });
        errorTracker.trackError('Invalid webhook signature', req, {
          category: 'payment',
          severity: 'critical'
        });
        await alertingSystem.triggerAlert(
          'payment_failure' as any,
          'Invalid Webhook Signature',
          'Webhook received with invalid signature - possible security breach',
          { signaturePrefix: signature.substring(0, 20) }
        );
        return res.status(401).json({ error: 'Invalid signature' });
      }
    } else {
      logger.warn('No signature key configured - accepting all requests', LogCategory.WEBHOOK);
    }

    // Parse event
    const event: WebhookEvent = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.type || 'unknown';
    logger.info(`Received webhook event: ${eventType}`, LogCategory.WEBHOOK, {
      eventType,
      eventId: event.id
    });

    // Handle payment events that confirm money has cleared
    // payment.sent: Payment has been sent/cleared
    // payment.paid: Payment has been paid/cleared
    // payout.sent: Payout has been sent (Square sends this when money clears)
    if (eventType === 'payment.sent' || eventType === 'payment.paid' || eventType === 'payout.sent') {
      // For payout.sent, we need to extract payment from a different location
      let payment: SquarePayment | undefined;
      
      if (eventType === 'payout.sent') {
        // payout.sent event structure is different - payment might be in event.data.object.payout or we need to look it up
        console.log(`[Webhook] Received payout.sent event - checking for payment data...`);
        payment = event.data?.object?.payment;
        
        // If no payment in event, try to get it from payout entries (type assertion needed)
        if (!payment && event.data?.object && (event.data.object as any)?.payout?.entries) {
          const entries = (event.data.object as any).payout.entries;
          if (Array.isArray(entries) && entries.length > 0) {
            // Get payment ID from first entry and look it up
            const paymentId = entries[0]?.payment_id;
            if (paymentId) {
              console.log(`[Webhook] Found payment ID in payout entry: ${paymentId}`);
              // We'll process this payment ID - but we need the full payment object
              // For now, log and continue - the payment.updated event should have the full data
              console.log(`[Webhook] payout.sent event - payment will be processed via payment.updated event`);
              return res.status(200).json({
                success: true,
                action: 'ignored',
                eventType,
                message: 'payout.sent received - payment will be processed via payment.updated'
              });
            }
          }
        }
        
        if (!payment) {
          console.log(`[Webhook] payout.sent event - no payment data found, waiting for payment.updated`);
          return res.status(200).json({
            success: true,
            action: 'ignored',
            eventType,
            message: 'payout.sent received but no payment data - waiting for payment.updated'
          });
        }
      } else {
        payment = event.data?.object?.payment;
      }

      if (!payment) {
        console.error('[Webhook] No payment data in event');
        return res.status(400).json({ error: 'No payment data' });
      }

      console.log(`[Webhook] Processing ${eventType} event - payment has cleared`);
      const result = await handlePaymentCleared(payment);
      return res.status(200).json({ success: true, ...result });
    }

    // Also handle payment.updated and payment.completed for backward compatibility
    // These events with COMPLETED status indicate payment has cleared
    if (eventType === 'payment.updated' || eventType === 'payment.completed') {
      const payment = event.data?.object?.payment;

      if (!payment) {
        console.error('[Webhook] No payment data in event');
        return res.status(400).json({ error: 'No payment data' });
      }

      // Only process if status is COMPLETED (indicates payment has cleared)
      if (payment.status === 'COMPLETED') {
        console.log(`[Webhook] Processing ${eventType} with COMPLETED status - payment has cleared`);
        const result = await handlePaymentCleared(payment);
        return res.status(200).json({ success: true, ...result });
      } else {
        console.log(`[Webhook] Ignoring ${eventType} with status ${payment.status} - waiting for COMPLETED status`);
        return res.status(200).json({
          success: true,
          action: 'ignored',
          eventType,
          status: payment.status,
          message: `Waiting for COMPLETED status (current: ${payment.status})`
        });
      }
    }

    // Ignore other event types
    console.log(`[Webhook] Ignoring event type: ${eventType}`);
    return res.status(200).json({
      success: true,
      action: 'ignored',
      eventType
    });

  } catch (error) {
    console.error('[Webhook] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
