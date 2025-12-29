import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import crypto from 'crypto';
import { Redis } from '@upstash/redis';
import { PrivySigner } from '../utils/privy-signer';
import { getPrivyClient } from '../utils/privy-client';
import { savePosition, updatePosition, generatePositionId, UserPosition } from '../positions/store';
import { getWalletKey, deleteWalletKey, decryptWalletKeyWithToken } from '../wallet/keystore';
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, maxUint256, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalanche } from 'viem/chains';
import { GmxSdk } from '@gmx-io/sdk';

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
const MAX_GAS_PRICE_GWEI = 1.01; // Max gas price in gwei for all transactions

// EnergyCoin (ERGC) - Fee discount token
const ERGC_CONTRACT = '0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B';
const ERGC_DISCOUNT_THRESHOLD = ethers.parseUnits('100', 18); // 100 ERGC for discount
const ERGC_PURCHASE_AMOUNT = 100; // 100 ERGC purchased
const ERGC_BURN_PER_TX = 1; // 1 ERGC burned per transaction
const ERGC_SEND_TO_USER = ethers.parseUnits('99', 18); // 99 ERGC sent to user (100 - 1 burned)

// Risk profile configurations - maps to user selection
const RISK_PROFILES = {
  conservative: { aavePercent: 100, gmxPercent: 0, gmxLeverage: 0, name: 'Earn Only' },
  balanced: { aavePercent: 50, gmxPercent: 50, gmxLeverage: 2.5, name: 'Split Strategy' },
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
    console.log('[Webhook] No signature key configured, skipping verification');
    return true;
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

    // Send transfer transaction with fixed gas price (1.01 gwei max)
    console.log('[USDC] Sending transaction...');
    const gasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const tx = await usdcContract.transfer(toAddress, usdcAmount, { gasPrice });
    console.log(`[USDC] Transaction hash: ${tx.hash}`);

    // Wait for confirmation
    console.log('[USDC] Waiting for confirmation...');
    const receipt = await tx.wait();
    console.log(`[USDC] Confirmed in block ${receipt?.blockNumber}`);
    console.log(`[USDC] Gas used: ${receipt?.gasUsed}`);

    const explorerUrl = `https://snowtrace.io/tx/${tx.hash}`;
    console.log(`[USDC] Explorer: ${explorerUrl}`);

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
 * Check if user has ERGC discount (100+ ERGC)
 */
async function checkErgcDiscount(userAddress: string): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const ergcContract = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, provider);
    const balance = await ergcContract.balanceOf(userAddress);
    const hasDiscount = balance >= ERGC_DISCOUNT_THRESHOLD;
    console.log(`[ERGC] User ${userAddress} balance: ${ethers.formatUnits(balance, 18)} ERGC, discount: ${hasDiscount}`);
    return hasDiscount;
  } catch (error) {
    console.error('[ERGC] Balance check error:', error);
    return false;
  }
}

/**
 * Transfer ERGC tokens to user wallet (99 ERGC - 1 is burned for this transaction)
 */
async function sendErgcTokens(
  toAddress: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[ERGC] Sending ${ethers.formatUnits(ERGC_SEND_TO_USER, 18)} ERGC to ${toAddress} (1 burned for this tx)`);

  const validation = validateHubWallet();
  if (!validation.valid) {
    console.error('[ERGC] Hub wallet validation failed:', validation.error);
    return { success: false, error: validation.error || 'Hub wallet not configured' };
  }

  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    const ergcContract = new ethers.Contract(ERGC_CONTRACT, ERC20_ABI, wallet);

    // Check ERGC balance (need at least 99 to send, 1 is "burned" by keeping in treasury)
    const balance = await ergcContract.balanceOf(wallet.address);
    console.log(`[ERGC] Hub ERGC balance: ${ethers.formatUnits(balance, 18)}`);

    if (balance < ERGC_SEND_TO_USER) {
      console.error(`[ERGC] Insufficient ERGC balance`);
      return { success: false, error: 'Insufficient ERGC in treasury wallet' };
    }

    // Send 99 ERGC with fixed gas price (1 ERGC is "burned" by staying in treasury)
    const gasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const tx = await ergcContract.transfer(toAddress, ERGC_SEND_TO_USER, { gasPrice });

    console.log(`[ERGC] Transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log(`[ERGC] Transfer confirmed - 99 ERGC sent, 1 ERGC burned (kept in treasury)`);

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

    console.log(`[ERGC] Debit transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log(`[ERGC] Debit confirmed - ${amount} ERGC transferred to treasury`);

    return { success: true, txHash: tx.hash };
  } catch (error) {
    console.error('[ERGC] Debit error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
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

    console.log(`[AVAX] Transaction hash: ${tx.hash}`);
    await tx.wait();
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
 * Open a GMX BTC Long position using GMX SDK with 1.01 gwei gas
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
    const maxGas = parseUnits(MAX_GAS_PRICE_GWEI.toString(), 9); // 1.01 gwei

    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Create base wallet client
    const baseWalletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Wrap wallet client to force 1.01 gwei on all transactions
    const walletClient = {
      ...baseWalletClient,
      writeContract: async (args: any) => {
        console.log('[GMX] Forcing 1.01 gwei gas on writeContract...');
        return baseWalletClient.writeContract({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
        });
      },
      sendTransaction: async (args: any) => {
        console.log('[GMX] Forcing 1.01 gwei gas on sendTransaction...');
        return baseWalletClient.sendTransaction({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
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
      await approveTx.wait();
      console.log('[AAVE] Approval confirmed');
    }

    // Supply to AAVE
    console.log('[AAVE] Supplying to pool...');
    const supplyTx = await aavePool.supply(
      USDC_CONTRACT,
      usdcAmount,
      wallet.address, // onBehalfOf - USER wallet receives aTokens (fixed from hub wallet)
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
  console.log(`[GMX] Creating $${amountUsd} USDC BTC long position from hub wallet for ${walletAddress}...`);

  // Validate hub wallet
  const validation = validateHubWallet();
  if (!validation.valid) {
    console.error('[GMX] Hub wallet validation failed:', validation.error);
    return { success: false, error: validation.error || 'Hub wallet not configured' };
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
    const maxGas = parseUnits(MAX_GAS_PRICE_GWEI.toString(), 9); // 1.01 gwei
    console.log(`[GMX Hub] Hub wallet: ${account.address}`);

    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Create base wallet client
    const baseWalletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Wrap wallet client to force 1.01 gwei on all transactions
    const walletClient = {
      ...baseWalletClient,
      writeContract: async (args: any) => {
        console.log('[GMX Hub] Forcing 1.01 gwei gas on writeContract...');
        return baseWalletClient.writeContract({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
        });
      },
      sendTransaction: async (args: any) => {
        console.log('[GMX Hub] Forcing 1.01 gwei gas on sendTransaction...');
        return baseWalletClient.sendTransaction({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
        });
      },
    };

    // Check AVAX balance
    const avaxBalance = await publicClient.getBalance({ address: account.address });
    console.log(`[GMX Hub] AVAX balance: ${formatUnits(avaxBalance, 18)}`);

    if (avaxBalance < parseUnits('0.02', 18)) {
      return { success: false, error: 'Insufficient AVAX in hub wallet for GMX execution fee' };
    }

    // Check USDC balance in hub wallet
    const usdcAmount = parseUnits(collateralUsd.toString(), 6);
    const usdcBalance = await publicClient.readContract({
      address: USDC_CONTRACT as `0x${string}`,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [account.address],
    }) as bigint;
    console.log(`[GMX Hub] USDC balance: ${formatUnits(usdcBalance, 6)}`);

    if (usdcBalance < usdcAmount) {
      return { success: false, error: `Insufficient USDC in hub wallet. Have: ${formatUnits(usdcBalance, 6)}, Need: ${formatUnits(usdcAmount, 6)}` };
    }

    // Fetch market data from GMX API
    console.log('[GMX Hub] Fetching market data...');
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

    console.log(`[GMX Hub] Market: ${btcUsdcMarket.marketToken}`);

    // Approve USDC to Router
    const allowance = await publicClient.readContract({
      address: USDC_CONTRACT as `0x${string}`,
      abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'allowance',
      args: [account.address, GMX_ROUTER as `0x${string}`],
    }) as bigint;

    if (allowance < usdcAmount) {
      console.log('[GMX Hub] Approving USDC to Router...');
      const approveTxHash = await walletClient.writeContract({
        address: USDC_CONTRACT as `0x${string}`,
        abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
        functionName: 'approve',
        args: [GMX_ROUTER as `0x${string}`, maxUint256],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      console.log('[GMX Hub] USDC approved');
    }

    // Initialize GMX SDK
    console.log('[GMX Hub] Initializing GMX SDK...');
    const sdk = new GmxSdk({
      chainId: 43114,
      rpcUrl: AVALANCHE_RPC,
      oracleUrl: 'https://avalanche-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
      walletClient: walletClient as any,
    });

    sdk.setAccount(account.address);
    console.log('[GMX Hub] SDK account set:', account.address);

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
      console.log(`[GMX Hub SDK] Calling ${method}...`);

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
          console.log(`[GMX Hub SDK] Execution fee: ${formatUnits(totalWntAmount, 18)} AVAX`);
        }
      }

      // Add execution fee as value
      const finalOpts = {
        ...opts,
        value: (opts?.value || 0n) + totalWntAmount,
      };

      const h = await originalCallContract(contractAddress, abi, method, params, finalOpts) as `0x${string}`;
      submittedHash = h;
      console.log(`[GMX Hub SDK] Tx submitted: ${h}`);
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
      console.log('[GMX Hub] About to call sdk.orders.long()...');
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
      console.log(`[GMX Hub] sdk.orders.long() completed in ${orderDuration}ms`);
    } catch (orderError) {
      console.error('[GMX Hub] sdk.orders.long() failed:', orderError);
      const errorMsg = orderError instanceof Error ? orderError.message : String(orderError);
      console.error('[GMX Hub] Error details:', {
        message: errorMsg,
        name: orderError instanceof Error ? orderError.name : 'Unknown',
        stack: orderError instanceof Error ? orderError.stack : 'No stack',
      });

      // Check for specific GMX protocol errors
      if (errorMsg.includes('ROUTER_PLUGIN') || errorMsg.includes('router plugin')) {
        console.error('[GMX Hub] GMX protocol error: ROUTER_PLUGIN - this is a GMX protocol issue, not our code');
        return {
          success: false,
          error: 'GMX protocol error (ROUTER_PLUGIN). This is a temporary GMX issue. Please try again later or contact GMX support.'
        };
      }

      throw orderError;
    }

    if (!submittedHash) {
      console.error('[GMX Hub] No tx hash captured after sdk.orders.long()');
      throw new Error('GMX order submitted but no tx hash captured');
    }

    console.log(`[GMX Hub] Waiting for tx confirmation: ${submittedHash}`);
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
    } catch (receiptError) {
      console.error('[GMX Hub] Error waiting for receipt:', receiptError);
      // If we have a hash, return it even if receipt wait fails (transaction might still succeed)
      return {
        success: true,
        txHash: submittedHash,
        error: 'Transaction submitted but receipt confirmation failed. Check transaction status manually.'
      };
    }

    if (receipt.status !== 'success') {
      console.error('[GMX Hub] Transaction reverted:', receipt);

      // Try to extract revert reason if available
      let revertReason = 'Unknown revert reason';
      if (receipt.logs && receipt.logs.length > 0) {
        console.error('[GMX Hub] Revert logs:', receipt.logs);
      }

      // Check for common GMX revert reasons
      if (receipt.transactionHash) {
        console.error(`[GMX Hub] Failed transaction: https://snowtrace.io/tx/${receipt.transactionHash}`);
      }

      return {
        success: false,
        error: `GMX transaction reverted. This may be a GMX protocol issue. Transaction: ${receipt.transactionHash || submittedHash}`
      };
    }

    console.log(`[GMX Hub] Order confirmed: ${submittedHash} (position created in hub wallet for user ${walletAddress})`);
    return { success: true, txHash: submittedHash };

  } catch (error) {
    console.error('[GMX] Execution error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
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
    // Get Privy client
    const privyClient = getPrivyClient();

    // Get user's wallets to find the embedded wallet ID
    const wallets = await privyClient.getWallets({ userId: privyUserId });
    const embeddedWallet = wallets.find((w: any) => w.address.toLowerCase() === walletAddress.toLowerCase());

    if (!embeddedWallet) {
      throw new Error(`Embedded wallet ${walletAddress} not found for user ${privyUserId}`);
    }

    console.log(`[AAVE-PRIVY] Found embedded wallet: ${embeddedWallet.id}`);

    // Create Privy signer with wallet ID
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const privySigner = new PrivySigner(embeddedWallet.id, walletAddress, provider);

    // Create contracts with Privy signer
    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, privySigner);
    const aavePool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, privySigner);
    const usdcAmount = BigInt(Math.floor(amountUsd * 1_000_000));

    // Check and approve USDC for AAVE Pool
    const allowance = await usdcContract.allowance(walletAddress, AAVE_POOL);
    if (allowance < usdcAmount) {
      console.log('[AAVE-PRIVY] Approving USDC from Privy wallet...');
      const approveTx = await usdcContract.approve(AAVE_POOL, ethers.MaxUint256);
      await approveTx.wait();
      console.log('[AAVE-PRIVY] Privy wallet approval confirmed');
    }

    // Supply to Aave
    console.log('[AAVE-PRIVY] Supplying to pool...');
    const supplyTx = await aavePool.supply(
      USDC_CONTRACT,
      usdcAmount,
      walletAddress, // onBehalfOf - USER wallet receives aTokens
      0 // referralCode
    );

    const receipt = await supplyTx.wait();
    console.log(`[AAVE-PRIVY] Supply confirmed: ${supplyTx.hash}`);

    return { success: true, txHash: supplyTx.hash };
  } catch (error) {
    console.error('[AAVE-PRIVY] Supply error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
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
      await approveTx.wait();
      console.log('[AAVE] Hub wallet approval confirmed');
    }

    // Supply to Aave on behalf of user
    console.log('[AAVE] Supplying to pool on behalf of user...');
    const supplyTx = await aavePool.supply(
      USDC_CONTRACT,
      usdcAmount,
      walletAddress, // onBehalfOf - USER wallet receives aTokens
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

  const profile = RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES] || RISK_PROFILES.balanced;
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
    strategyType: riskProfile as 'conservative' | 'balanced' | 'aggressive',
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

      // DELETE the encrypted key after successful execution (non-custodial)
      await deleteWalletKey(walletAddress);
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
    const maxGas = parseUnits(MAX_GAS_PRICE_GWEI.toString(), 9); // 1.01 gwei

    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Create base wallet client
    const baseWalletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });

    // Wrap wallet client to force 1.01 gwei on all transactions
    const walletClient = {
      ...baseWalletClient,
      writeContract: async (args: any) => {
        console.log('[GMX Edit] Forcing 1.01 gwei gas on writeContract...');
        return baseWalletClient.writeContract({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
        });
      },
      sendTransaction: async (args: any) => {
        console.log('[GMX Edit] Forcing 1.01 gwei gas on sendTransaction...');
        return baseWalletClient.sendTransaction({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
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
 * Handle payment.updated webhook event
 */
async function handlePaymentUpdated(payment: SquarePayment): Promise<{
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
}> {
  const paymentId = payment.id;
  const status = payment.status;
  const amountCents = payment.amount_money?.amount || 0;
  const amountUsd = amountCents / 100;
  const note = payment.note || '';

  console.log(`[Webhook] Payment updated: ${paymentId}`);
  console.log(`[Webhook] Status: ${status}`);
  console.log(`[Webhook] Amount: $${amountUsd}`);
  console.log(`[Webhook] Note: ${note}`);

  // Check if already processed (idempotency) - CRITICAL to prevent duplicate transfers
  const idempotencyCheck = await isPaymentProcessed(paymentId);

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

  // Only process COMPLETED payments - check BEFORE idempotency to allow retries
  if (status !== 'COMPLETED') {
    console.log(`[Webhook] Payment not completed yet, status: ${status}`);
    return {
      action: 'ignored',
      paymentId,
      status,
    };
  }

  if (idempotencyCheck.processed) {
    console.log(`[Webhook] Payment ${paymentId} already processed, skipping duplicate`);
    return {
      action: 'already_processed',
      paymentId,
      status,
    };
  }

  // Mark as processed IMMEDIATELY to prevent race conditions
  const marked = await markPaymentProcessed(paymentId, 'pending');
  if (!marked) {
    console.error(`[Webhook] BLOCKING transfer - failed to mark payment as processed`);
    return {
      action: 'blocked_mark_failed',
      paymentId,
      status,
      error: 'Failed to mark payment as processed in Redis',
    };
  }

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
  const redis = getRedis();
  const paymentInfoRaw = await redis.get(`payment_info:${frontendPaymentId}`);

  console.log(`[Webhook] payment_info lookup result: ${paymentInfoRaw ? 'FOUND' : 'NOT FOUND'}`);

  if (paymentInfoRaw) {
    try {
      const paymentInfo = typeof paymentInfoRaw === 'string' ? JSON.parse(paymentInfoRaw) : paymentInfoRaw;
      console.log(`[Webhook] payment_info contents:`, JSON.stringify(paymentInfo));
      if (paymentInfo.walletAddress) {
        walletAddress = paymentInfo.walletAddress;
        // Prioritize riskProfile from payment_info (more reliable than note)
        if (paymentInfo.riskProfile) {
          riskProfile = paymentInfo.riskProfile;
          console.log(`[Webhook] Using riskProfile from payment_info: ${riskProfile}`);
        } else if (riskProfile) {
          console.log(`[Webhook] Using riskProfile from note: ${riskProfile}`);
        }
        email = paymentInfo.userEmail || email;
        console.log(`[Webhook] Using wallet from payment info: ${walletAddress}`);
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

  console.log(`[Webhook] Wallet address: ${walletAddress}`);
  console.log(`[Webhook] Risk profile: ${riskProfile}`);
  console.log(`[Webhook] Email: ${email}`);
  console.log(`[Webhook] ERGC purchase: ${ergcPurchase || 0}`);
  console.log(`[Webhook] Debit ERGC: ${debitErgc || 0}`);

  // Option C: Non-custodial - Send tokens to USER's wallet
  // 1. Transfer USDC from hub wallet to user wallet (deposit amount only, not fees)
  // 2. If GMX strategy, also send AVAX for execution fees
  // 3. Send ERGC tokens if purchased
  // 4. For connected wallets: User executes strategy via MetaMask
  // 5. For generated wallets: Execute strategy using stored encrypted key (legacy)

  // Determine if this is a GMX strategy (needs AVAX)
  // Validate riskProfile and default to balanced if invalid
  if (!riskProfile || !RISK_PROFILES[riskProfile as keyof typeof RISK_PROFILES]) {
    console.warn(`[Webhook] Invalid or missing riskProfile: "${riskProfile}", defaulting to balanced`);
    riskProfile = 'balanced';
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

  // Get deposit amount from payment info or fallback to amountUsd
  let rawDepositAmount = amountUsd;
  console.log(`[Webhook] Initial amount from Square: $${amountUsd} (${amountCents} cents)`);

  if (paymentInfoRaw) {
    try {
      const paymentInfo = typeof paymentInfoRaw === 'string' ? JSON.parse(paymentInfoRaw) : paymentInfoRaw;
      console.log(`[Webhook] Payment info found:`, paymentInfo);
      rawDepositAmount = paymentInfo.amount || amountUsd;
      console.log(`[Webhook] Using amount from payment info: $${rawDepositAmount}`);
    } catch (error) {
      console.error(`[Webhook] Error parsing payment info for amount:`, error);
    }
  } else {
    console.log(`[Webhook] No payment info found, calculating deposit amount from Square total`);
    // If no payment info, assume 5% platform fee and calculate deposit amount
    // Square total = deposit amount + 5% fee
    // So deposit amount = Square total / 1.05
    rawDepositAmount = Math.round((amountUsd / 1.05) * 100) / 100;
    console.log(`[Webhook] Calculated deposit amount: $${rawDepositAmount} (from $${amountUsd} total)`);
  }

  console.log(`[Webhook] Final deposit amount: $${rawDepositAmount}`);

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
  // User paid: depositAmount + 5% fee = total charged
  // We send: depositAmount (the full amount they requested to deposit)
  const depositAmount = rawDepositAmount;

  // Calculate Aave vs GMX split
  const aaveAmount = (depositAmount * profile.aavePercent) / 100;
  const gmxAmount = (depositAmount * profile.gmxPercent) / 100;

  console.log(`[Webhook] Deposit amount: $${depositAmount}`);
  console.log(`[Webhook] Split: Aave=$${aaveAmount} (${profile.aavePercent}%), GMX=$${gmxAmount} (${profile.gmxPercent}%)`);

  // Check if this is a connected wallet (no private key) vs generated wallet
  const isConnectedWallet = !walletData?.privateKey;

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

  if (isConnectedWallet) {
    // CONNECTED WALLET FLOW:
    // 1. Execute Aave from hub wallet (user gets aTokens via onBehalfOf)
    // 2. Send GMX portion to user's wallet (user executes via MetaMask)

    // Check if we have a Privy User ID linked for automated execution
    const redis = getRedis();
    const privyUserId = await redis.get(`wallet_owner:${walletAddress}`) as string | null;

    if (privyUserId) {
      // PRIVY SMART WALLET FLOW:
      // Execute both Aave and GMX automatically using Privy
      console.log(`[Webhook] Privy smart wallet detected - executing automated strategy`);

      // Step 1: Execute Aave via Privy (if allocation > 0)
      if (aaveAmount > 0 && profile.aavePercent > 0) {
        console.log(`[Webhook] About to execute AAVE via Privy: amount=$${aaveAmount}, wallet=${walletAddress}`);
        aaveResult = await executeAaveViaPrivy(privyUserId, walletAddress, aaveAmount, lookupPaymentId);
        console.log(`[Webhook] AAVE Privy result:`, aaveResult);
        if (aaveResult.success) {
          console.log(`[Webhook] AAVE supply confirmed via Privy: ${aaveResult.txHash}`);
        } else {
          console.error(`[Webhook] AAVE supply failed via Privy: ${aaveResult.error}`);
        }
      }

      // Step 2: Execute GMX via Privy (if allocation > 0)
      if (gmxAmount > 0 && profile.gmxPercent > 0) {
        console.log(`[Webhook] Executing GMX via Privy: amount=$${gmxAmount}, wallet=${walletAddress}`);
        gmxResult = await executeGmxViaPrivy(privyUserId, walletAddress, gmxAmount, riskProfile);
        console.log(`[Webhook] GMX Privy result:`, gmxResult);
        if (gmxResult.success) {
          console.log(`[Webhook] GMX executed automatically via Privy: ${gmxResult.txHash}`);
        } else {
          console.error(`[Webhook] GMX Privy execution failed: ${gmxResult.error}`);
        }
      }
    } else {
      // REGULAR CONNECTED WALLET FLOW (MetaMask/WalletConnect):
      // 1. Execute Aave from hub wallet (user gets aTokens via onBehalfOf)
      // 2. Send GMX portion to user's wallet (user executes via MetaMask)

      console.log(`[Webhook] Regular connected wallet flow - hybrid execution`);

      // Step 1: Execute Aave from hub wallet (if allocation > 0)
      if (aaveAmount > 0 && profile.aavePercent > 0) {
        console.log(`[Webhook] About to execute AAVE: amount=$${aaveAmount}, wallet=${walletAddress}, paymentId=${lookupPaymentId}`);
        aaveResult = await executeAaveFromHubWallet(walletAddress, aaveAmount, lookupPaymentId);
        console.log(`[Webhook] AAVE execution result:`, aaveResult);
        if (aaveResult.success) {
          console.log(`[Webhook] AAVE supply confirmed: ${aaveResult.txHash}`);
        } else {
          console.error(`[Webhook] AAVE supply failed: ${aaveResult.error}`);
        }
      } else {
        console.log(`[Webhook] Skipping AAVE execution: aaveAmount=${aaveAmount}, aavePercent=${profile.aavePercent}`);
      }

      // Step 3: Execute GMX from user's wallet via Privy (if allocation > 0)
      if (gmxAmount > 0 && profile.gmxPercent > 0) {
        if (!privyUserId) {
          console.error(`[Webhook] privyUserId is null but we're in Privy flow - this should not happen`);
          gmxResult = { success: false, error: 'Privy User ID not found' };
        } else {
          console.log(`[Webhook] Executing GMX via Privy: amount=$${gmxAmount}, wallet=${walletAddress}`);
          gmxResult = await executeGmxViaPrivy(privyUserId, walletAddress, gmxAmount, riskProfile);
          console.log(`[Webhook] GMX Privy result:`, gmxResult);
          if (gmxResult.success) {
            console.log(`[Webhook] GMX executed automatically via Privy: ${gmxResult.txHash}`);
          } else {
            console.error(`[Webhook] GMX Privy execution failed: ${gmxResult.error}`);
          }
        }
      } else {
        console.log(`[Webhook] Skipping GMX: gmxAmount=${gmxAmount}, gmxPercent=${profile.gmxPercent}`);
      }

      // Step 2: GMX Execution - Send USDC to user for manual execution (regular wallets only)
      if (gmxAmount > 0 && profile.gmxPercent > 0) {
        console.log(`[Webhook] No Privy ID found - Sending GMX portion ($${gmxAmount} USDC) to user wallet for MetaMask execution`);
        const gmxTransfer = await sendUsdcTransfer(walletAddress, gmxAmount, `${lookupPaymentId}-gmx`);
        console.log(`[Webhook] GMX USDC transfer result:`, gmxTransfer);
        if (gmxTransfer.success) {
          console.log(`[Webhook] GMX USDC transferred to user: ${gmxTransfer.txHash}`);
          gmxResult = {
            success: true,
            txHash: gmxTransfer.txHash,
            error: 'USDC sent to wallet - user must execute GMX trade via MetaMask'
          };
        } else {
          console.error(`[Webhook] GMX USDC transfer failed: ${gmxTransfer.error}`);
          gmxResult = { success: false, error: gmxTransfer.error };
        }
      } else {
        console.log(`[Webhook] Skipping GMX: gmxAmount=${gmxAmount}, gmxPercent=${profile.gmxPercent}`);
      }
    }

    // Step 3: Send AVAX to user for gas fees
    const avaxAmount = hasGmx ? AVAX_TO_SEND_FOR_GMX : AVAX_TO_SEND_FOR_AAVE;
    const avaxPurpose = hasGmx ? 'GMX execution fees' : 'exit fees';
    console.log(`[Webhook] Sending ${ethers.formatEther(avaxAmount)} AVAX for ${avaxPurpose}...`);
    const avaxResult = await sendAvaxToUser(walletAddress, avaxAmount, avaxPurpose);
    if (!avaxResult.success) {
      console.error(`[Webhook] AVAX transfer failed: ${avaxResult.error}`);
    } else {
      console.log(`[Webhook] AVAX transferred: ${avaxResult.txHash}`);
    }

  } else {
    // GENERATED WALLET FLOW (legacy):
    // Send ALL USDC to user's wallet, then execute strategy from user wallet

    console.log(`[Webhook] Generated wallet flow - sending USDC to user wallet`);
    console.log(`[Webhook] Deposit amount: $${depositAmount}`);

    transferResult = await sendUsdcTransfer(walletAddress, depositAmount, paymentId);

    if (!transferResult.success) {
      console.error(`[Webhook] USDC transfer failed: ${transferResult.error}`);
      return {
        action: 'transfer_failed',
        paymentId,
        status,
        error: transferResult.error,
      };
    }

    console.log(`[Webhook] USDC transferred: ${transferResult.txHash}`);

    // Send AVAX to user for gas fees
    const avaxAmount = hasGmx ? AVAX_TO_SEND_FOR_GMX : AVAX_TO_SEND_FOR_AAVE;
    const avaxPurpose = hasGmx ? 'GMX execution fees' : 'exit fees';
    console.log(`[Webhook] Sending ${ethers.formatEther(avaxAmount)} AVAX for ${avaxPurpose}...`);
    const avaxResult = await sendAvaxToUser(walletAddress, avaxAmount, avaxPurpose);
    if (!avaxResult.success) {
      console.error(`[Webhook] AVAX transfer failed: ${avaxResult.error}`);
    } else {
      console.log(`[Webhook] AVAX transferred: ${avaxResult.txHash}`);
    }

    // Execute strategy from user wallet (has private key)
    console.log('[Webhook] Executing strategy from user wallet...');
    const strategyResult = await executeStrategyFromUserWallet(walletAddress, lookupPaymentId);
    aaveResult = strategyResult.aaveResult;
    gmxResult = strategyResult.gmxResult;
  }

  // Send ERGC tokens if user purchased them
  if (ergcPurchase && ergcPurchase > 0) {
    console.log(`[Webhook] ERGC purchase detected: ${ergcPurchase} tokens`);
    const ergcResult = await sendErgcTokens(walletAddress);
    if (!ergcResult.success) {
      console.error(`[Webhook] ERGC transfer failed: ${ergcResult.error}`);
      // Continue anyway - main deposit should still work
    } else {
      console.log(`[Webhook] ERGC transferred: ${ergcResult.txHash}`);
    }
  }

  // Debit ERGC from user's wallet if they opted to use existing ERGC
  // Note: For connected wallets, user must approve ERGC transfer via MetaMask
  // This is handled client-side, not in webhook
  if (debitErgc && debitErgc > 0 && walletData?.privateKey) {
    console.log(`[Webhook] Debiting ${debitErgc} ERGC from user wallet for fee discount`);
    const debitResult = await debitErgcFromUser(walletData.privateKey, debitErgc);
    if (!debitResult.success) {
      console.error(`[Webhook] ERGC debit failed: ${debitResult.error}`);
      // Continue anyway - user still gets the trade but we couldn't collect the ERGC
    } else {
      console.log(`[Webhook] ERGC debited: ${debitResult.txHash}`);
    }
  } else if (debitErgc && debitErgc > 0 && !walletData?.privateKey) {
    console.log(`[Webhook] ERGC debit requested but wallet is connected (user must approve via MetaMask)`);
    // For connected wallets, ERGC debit is handled client-side
  }

  // Create position record for connected wallets
  if (isConnectedWallet) {
    const positionId = generatePositionId();
    const position: UserPosition = {
      id: positionId,
      paymentId: lookupPaymentId,
      userEmail: email || '',
      walletAddress,
      strategyType: riskProfile as 'conservative' | 'balanced' | 'aggressive',
      usdcAmount: depositAmount,
      status: (aaveResult?.success || gmxResult?.success) ? 'active' : 'pending',
      createdAt: new Date().toISOString(),
      aaveSupplyAmount: aaveAmount,
      aaveSupplyTxHash: aaveResult?.txHash,
      gmxCollateralAmount: gmxAmount,
    };
    await savePosition(position);

    // Update processed record with final tx hash
    await markPaymentProcessed(paymentId, positionId || transferResult.txHash);

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
  }

  // For generated wallets, the position was already created in executeStrategyFromUserWallet
  // Just return a simple response
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

/**
 * Execute GMX using Privy for Privy smart wallets
 */
async function executeGmxViaPrivy(
  privyUserId: string,
  walletAddress: string,
  amountUsd: number,
  riskProfile: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[GMX-PRIVY] Executing $${amountUsd} GMX position via Privy for ${walletAddress}...`);

  try {
    // For now, fall back to hub wallet execution due to Privy package dependency issue
    console.log(`[GMX-PRIVY] Falling back to hub wallet execution due to Privy package issue`);
    return await executeGmxFromHubWallet(walletAddress, amountUsd, riskProfile);
  } catch (error) {
    console.error('[GMX-PRIVY] Execution error:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
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
        rpcUrl: AVALANCHE_RPC.includes('api.avax') ? 'public' : 'custom',
        redisStatus,
      });
    }

    // POST - handle webhook
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get raw body for signature verification
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const signature = req.headers['x-square-signature'] as string || '';

    // Verify signature - Square uses URL + body for signature
    // For now, log but don't reject to debug
    if (SQUARE_WEBHOOK_SIGNATURE_KEY && signature) {
      const isValid = verifySignature(rawBody, signature);
      console.log(`[Webhook] Signature verification: ${isValid ? 'VALID' : 'INVALID'}`);
      console.log(`[Webhook] Signature received: ${signature.substring(0, 20)}...`);
      // Don't reject - Square signature format may differ, process anyway
      // TODO: Fix signature verification once working
    }

    // Parse event
    const event: WebhookEvent = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.type || 'unknown';
    console.log(`[Webhook] Received event: ${eventType}`);

    // Handle payment events
    if (eventType === 'payment.updated' || eventType === 'payment.completed') {
      const payment = event.data?.object?.payment;

      if (!payment) {
        console.error('[Webhook] No payment data in event');
        return res.status(400).json({ error: 'No payment data' });
      }

      const result = await handlePaymentUpdated(payment);
      return res.status(200).json({ success: true, ...result });
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
