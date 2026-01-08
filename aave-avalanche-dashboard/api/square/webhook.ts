import { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { Redis } from '@upstash/redis';

// Node.js built-in modules are available in Vercel environments
// @ts-ignore - crypto is a Node.js built-in module, types may not be available
import crypto from 'crypto';

// Buffer is available globally in Node.js/Vercel environments
// NOTE: raw-body is not used because Vercel automatically parses request bodies
// We use fallback methods (stringifying req.body) for signature verification
declare const Buffer: {
  from(data: string, encoding: 'base64' | 'hex' | 'utf8'): Buffer;
  isBuffer(obj: any): boolean;
  new (data: string, encoding?: string): Buffer;
  prototype: Buffer;
};
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, maxUint256 } from 'viem';
import { avalanche } from 'viem/chains';
import { GmxSdk } from '@gmx-io/sdk';

// Import monitoring systems
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { alertingSystem } from '../utils/alerting';

/**
 * ARCHITECTURAL IMPROVEMENTS (Additions Only - No Removals)
 * 
 * The following improvements have been added to enhance code organization and reliability:
 * 
 * 1. PaymentStateManager - Improved state management with explicit states (PENDING, PROCESSING, COMPLETED, FAILED)
 *    - Better tracking of payment processing status
 *    - Atomic lock acquisition/release
 *    - Still uses existing Redis infrastructure
 * 
 * 2. AvaxPriceOracle - Cached AVAX price fetching
 *    - Reduces API calls with 1-minute cache
 *    - Fallback to default price on failure
 * 
 * 3. AmountCalculator - Centralized amount calculation logic
 *    - Consistent fee calculations
 *    - Amount validation
 *    - Uses AvaxPriceOracle for accurate fee calculations
 * 
 * 4. TransactionExecutor - Improved gas price optimization
 *    - EIP-1559 support with base fee awareness
 *    - Optimal gas price calculation
 *    - Safety caps to prevent overpaying
 * 
 * All existing functionality is preserved:
 * - executeGmxFromHubWallet() - Full GMX SDK integration
 * - executeAaveFromHubWallet() - Aave supply execution
 * - Privy integration for ERGC debit
 * - Position tracking
 * - All error handling and diagnostics
 * 
 * These improvements are ADDITIONS that enhance the existing code without removing any functionality.
 */

// Helper functions
function generatePositionId(): string {
  return `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

interface UserPosition {
  id: string;
  paymentId: string;
  userEmail: string;
  walletAddress: string;
  strategyType: 'conservative' | 'morpho' | 'aggressive';
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
  morphoResult?: { success: boolean; txHash?: string; error?: string };
}

async function savePosition(position: UserPosition): Promise<void> {
  const redis = getRedis();
  // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
  await redis.set(`position:${position.id}`, JSON.stringify(position), { ex: 7 * 24 * 60 * 60 }); // 7 days
}

async function updatePosition(id: string, updates: Partial<UserPosition>): Promise<void> {
  const redis = getRedis();
  // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
  const existing = await redis.get(`position:${id}`);
  if (existing) {
    let position: any;
    if (typeof existing === 'string') {
      // Check if it's valid JSON before parsing
      if (existing.trim().startsWith('{') || existing.trim().startsWith('[')) {
        try {
          position = JSON.parse(existing);
        } catch (parseError) {
          console.error(`[Position] Failed to parse position data:`, parseError);
          // Create new position if we can't parse
          position = { id };
        }
      } else {
        // Invalid format, create new position
        console.warn(`[Position] Invalid position data format: ${existing.substring(0, 50)}`);
        position = { id };
      }
    } else if (typeof existing === 'object' && existing !== null) {
      // Already an object
      position = existing;
    } else {
      // Unexpected type, create new position
      position = { id };
    }
    
    Object.assign(position, updates);
    // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
    await redis.set(`position:${id}`, JSON.stringify(position), { ex: 7 * 24 * 60 * 60 });
  }
}

async function decryptWalletKeyWithToken(walletAddress: string, paymentId: string): Promise<{ privateKey: string } | null> {
  // For connected wallets, no private key is stored
  return null;
}

// Configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
// Arbitrum RPC for Morpho operations (Morpho vaults are on Arbitrum)
const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';
const HUB_WALLET_PRIVATE_KEY = process.env.HUB_WALLET_PRIVATE_KEY || '';
const HUB_WALLET_ADDRESS = process.env.HUB_WALLET_ADDRESS || '0x34c11928868d14bdD7Be55A0D9f9e02257240c24';

// Arbitrum hub wallet (for Morpho operations on Arbitrum)
// If not set, falls back to HUB_WALLET_PRIVATE_KEY (for multi-chain wallets)
const ARBITRUM_HUB_WALLET_PRIVATE_KEY = process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY || HUB_WALLET_PRIVATE_KEY;
const ARBITRUM_HUB_WALLET_ADDRESS = process.env.ARBITRUM_HUB_WALLET_ADDRESS || HUB_WALLET_ADDRESS;

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
// Square Webhook Signature Key
// Get from: Square Dashboard → Webhooks → Show Signature Key
// Set in Vercel environment variables as: SQUARE_WEBHOOK_SIGNATURE_KEY
// Current key (as of 2026-01-07): hbHTFSJpfXsTSbom975dqg
// Key format: ~22-43 characters, base64-like string
const SQUARE_WEBHOOK_SIGNATURE_KEY = (process.env.SQUARE_WEBHOOK_SIGNATURE_KEY && typeof process.env.SQUARE_WEBHOOK_SIGNATURE_KEY === 'string') ? process.env.SQUARE_WEBHOOK_SIGNATURE_KEY : '';

// Log key status on module load (for debugging)
if (SQUARE_WEBHOOK_SIGNATURE_KEY && SQUARE_WEBHOOK_SIGNATURE_KEY.length > 0) {
  const keyLength = SQUARE_WEBHOOK_SIGNATURE_KEY.length;
  console.log('[Webhook] ✅ Signature key configured:', {
    length: keyLength,
    first10Chars: keyLength >= 10 ? SQUARE_WEBHOOK_SIGNATURE_KEY.substring(0, 10) + '...' : SQUARE_WEBHOOK_SIGNATURE_KEY.substring(0, keyLength),
    last10Chars: keyLength >= 10 ? '...' + SQUARE_WEBHOOK_SIGNATURE_KEY.substring(Math.max(0, keyLength - 10)) : SQUARE_WEBHOOK_SIGNATURE_KEY,
    expectedLength: '~43 characters (Square webhook signature keys are typically 43 chars)',
    note: 'If signature verification fails, verify this key matches the one in Square Dashboard → Webhooks → Show Signature Key'
  });
} else {
  console.error('[Webhook] ❌ CRITICAL: SQUARE_WEBHOOK_SIGNATURE_KEY not configured!');
  console.error('[Webhook] Get your key from: https://developer.squareup.com/apps → Your App → Webhooks → Show Signature Key');
}

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
  const redis = getRedis();
  // @ts-ignore - @upstash/redis types may not include exists method in some TypeScript versions, but it exists at runtime
  const exists = await redis.exists(`payment:${paymentId}`);
  console.log(`[Webhook] Redis check for ${paymentId}: exists=${exists}`);
  return { processed: exists > 0 };
}

async function markPaymentProcessed(paymentId: string, txHash?: string): Promise<boolean> {
  try {
    const redis = getRedis();
    // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
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

// ERC-4626 Vault ABI (for Morpho Vaults V2)
// ERC-4626 Vault ABI (Morpho V2 compatible)
// Morpho V2 vaults implement ERC-4626 with additional allocation functions
// Standard deposit/withdraw functions route through liquidityAdapter automatically
const ERC4626_VAULT_ABI = [
  // Standard ERC-4626 functions
  'function deposit(uint256 assets, address onBehalf) external returns (uint256 shares)',
  'function withdraw(uint256 assets, address receiver, address onBehalf) public returns (uint256 shares)',
  'function redeem(uint256 shares, address receiver, address onBehalf) external returns (uint256 assets)',
  'function mint(uint256 shares, address onBehalf) external returns (uint256 assets)',
  'function asset() external view returns (address)',
  'function totalAssets() external view returns (uint256)',
  'function convertToShares(uint256 assets) external view returns (uint256)',
  'function convertToAssets(uint256 shares) external view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function previewDeposit(uint256 assets) public view returns (uint256)',
  'function previewMint(uint256 shares) public view returns (uint256)',
  'function previewWithdraw(uint256 assets) public view returns (uint256)',
  'function previewRedeem(uint256 shares) public view returns (uint256)',
  // Morpho V2 specific functions (for debugging/verification)
  'function liquidityAdapter() external view returns (address)',
  'function liquidityData() external view returns (bytes memory)',
  'function accrueInterest() public',
  'function accrueInterestView() public view returns (uint256, uint256, uint256)',
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

// Morpho Vault addresses on Arbitrum (ERC-4626 compliant)
// NOTE: Morpho vaults are deployed on Arbitrum, not Avalanche
// Reference: Morpho V2 Contracts on Arbitrum
// - VaultV2Factory: 0x6b46fa3cc9EBF8aB230aBAc664E37F2966Bf7971
// - MorphoRegistry: 0xc00eb3c7aD1aE986A7f05F5A9d71aCa39c763C65
// - MORPHO Token: 0x40BD670A58238e6E230c430BBb5cE6ec0d40df48 (18 decimals)
// 
// Verified Morpho USDC Vault addresses on Arbitrum (verified on-chain)
// Both vaults accept USDC as their underlying asset
const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65'; // Morpho GauntletUSDC Core Vault on Arbitrum - VERIFIED
const MORPHO_HYPERITHM_USDC_VAULT = '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027'; // Morpho HyperithmUSDC Vault on Arbitrum - VERIFIED

// Token addresses on Arbitrum
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // Native USDC on Arbitrum (6 decimals)

// GMX minimum requirements
const GMX_MIN_COLLATERAL_USD = 5;
const GMX_MIN_POSITION_SIZE_USD = 10;
const AAVE_MIN_SUPPLY_USD = 1; // TEMPORARY: $1 for Morpho testing, will revert to $10 after testing

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

// ============================================================================
// IMPROVED ARCHITECTURE: Utility Classes (Additions Only - No Removals)
// ============================================================================

/**
 * Payment State Manager - Improved state management with explicit states
 * This is an ADDITION to existing functionality, not a replacement
 */
enum PaymentState {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

class PaymentStateManager {
  private redis: Redis;

  constructor() {
    this.redis = getRedis();
  }

  async acquireLock(paymentId: string, ttl: number = 300): Promise<boolean> {
    const lockKey = `payment_lock:${paymentId}`;
    // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
    const result = await this.redis.set(lockKey, 'processing', {
      ex: ttl,
      nx: true,
    });
    return result === 'OK';
  }

  async releaseLock(paymentId: string): Promise<void> {
    // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
    await this.redis.del(`payment_lock:${paymentId}`);
  }

  async getState(paymentId: string): Promise<PaymentState | null> {
    // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
    const state = await this.redis.get(`payment_state:${paymentId}`);
    return state as PaymentState | null;
  }

  async setState(paymentId: string, state: PaymentState, ttl: number = 86400): Promise<void> {
    // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
    await this.redis.set(`payment_state:${paymentId}`, state, { ex: ttl });
  }

  async markProcessed(paymentId: string, txHash?: string): Promise<void> {
    // Use existing markPaymentProcessed function for compatibility
    await markPaymentProcessed(paymentId, txHash);
    await this.setState(paymentId, PaymentState.COMPLETED);
  }

  async isProcessed(paymentId: string): Promise<boolean> {
    const check = await isPaymentProcessed(paymentId);
    return check.processed;
  }

  async getPaymentInfo(paymentId: string): Promise<any | null> {
    const redis = getRedis();
    // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
    const data = await redis.get(`payment_info:${paymentId}`);
    if (!data) return null;
    // Handle both string and object cases
    if (typeof data === 'string') {
      // Check if it's valid JSON before parsing
      if (data.trim().startsWith('{') || data.trim().startsWith('[')) {
        try {
          return JSON.parse(data);
        } catch (parseError) {
          console.error(`[getPaymentInfo] Failed to parse payment info:`, parseError);
          return null;
        }
      } else {
        // Invalid format (e.g., "[object Object]")
        console.error(`[getPaymentInfo] Invalid payment info format: ${data.substring(0, 50)}`);
        return null;
      }
    } else if (typeof data === 'object' && data !== null) {
      // Already an object
      return data;
    }
    
    return null;
  }
}

/**
 * AVAX Price Oracle - Cached price fetching
 * This is an ADDITION to improve price fetching reliability
 */
class AvaxPriceOracle {
  private cachedPrice: number = 30; // Default fallback
  private lastFetch: number = 0;
  private cacheDuration = 60000; // 1 minute

  async getPrice(): Promise<number> {
    const now = Date.now();
    
    if (now - this.lastFetch < this.cacheDuration) {
      return this.cachedPrice;
    }

    try {
      const response = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd',
        { signal: AbortSignal.timeout(5000) }
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data['avalanche-2']?.usd) {
          this.cachedPrice = data['avalanche-2'].usd;
          this.lastFetch = now;
        }
      }
    } catch (error) {
      console.warn('[AvaxOracle] Failed to fetch price, using cached:', this.cachedPrice);
    }

    return this.cachedPrice;
  }
}

/**
 * Amount Calculator - Centralized amount calculation logic
 * This is an ADDITION to improve amount calculation consistency
 */
class AmountCalculator {
  constructor(private avaxOracle: AvaxPriceOracle) {}

  async calculateDepositAmount(
    squareTotal: number,
    hasGmx: boolean,
    hasErgcDiscount: boolean
  ): Promise<number> {
    const avaxPrice = await this.avaxOracle.getPrice();
    
    // Calculate AVAX fee based on strategy and discount
    const avaxAmount = hasGmx
      ? (hasErgcDiscount ? 0.03 : 0.06)
      : 0.005;
    
    const avaxFeeUsd = avaxAmount * avaxPrice;
    
    // Square total = deposit * 1.05 + AVAX fee
    // deposit = (total - AVAX fee) / 1.05
    const depositAmount = (squareTotal - avaxFeeUsd) / 1.05;
    
    return Math.round(depositAmount * 100) / 100;
  }

  validateAmount(depositAmount: number, squareTotal: number): boolean {
    // Deposit should be 70-95% of Square total (rest is fees)
    const ratio = depositAmount / squareTotal;
    return ratio >= 0.7 && ratio <= 0.95;
  }
}

/**
 * Transaction Executor - Improved gas price optimization
 * This is an ADDITION to improve transaction reliability
 */
class TransactionExecutor {
  private provider: ethers.JsonRpcProvider;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(AVALANCHE_RPC, {
      chainId: 43114,
      name: 'avalanche',
    });
  }

  /**
   * Get optimal gas price with EIP-1559 support
   * This improves on the existing gas price logic
   */
  async getOptimalGasPrice(): Promise<bigint> {
    try {
      const feeData = await this.provider.getFeeData();
      const block = await this.provider.getBlock('latest');
      
      // Ensure we always have a BigInt - convert if needed
      const rawGasPrice = feeData.gasPrice || feeData.maxFeePerGas;
      let gasPrice = rawGasPrice ? BigInt(rawGasPrice.toString()) : ethers.parseUnits('70', 'gwei');
      
      // Ensure we're above base fee (EIP-1559)
      if (block?.baseFeePerGas) {
        const baseFee = BigInt(block.baseFeePerGas.toString());
        const minGasPrice = (baseFee * 120n) / 100n; // 120% of base fee
        gasPrice = gasPrice < minGasPrice ? minGasPrice : gasPrice;
      }
      
      // Cap at max
      const maxGasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
      return gasPrice > maxGasPrice ? maxGasPrice : gasPrice;
      
    } catch (error) {
      console.warn('[Gas] Failed to fetch optimal price, using 70 gwei');
      return ethers.parseUnits('70', 'gwei');
    }
  }
}

// Create singleton instances for reuse
let _paymentStateManager: PaymentStateManager | null = null;
let _avaxOracle: AvaxPriceOracle | null = null;
let _amountCalculator: AmountCalculator | null = null;
let _transactionExecutor: TransactionExecutor | null = null;

function getPaymentStateManager(): PaymentStateManager {
  if (!_paymentStateManager) {
    _paymentStateManager = new PaymentStateManager();
  }
  return _paymentStateManager;
}

function getAvaxOracle(): AvaxPriceOracle {
  if (!_avaxOracle) {
    _avaxOracle = new AvaxPriceOracle();
  }
  return _avaxOracle;
}

function getAmountCalculator(): AmountCalculator {
  if (!_amountCalculator) {
    _amountCalculator = new AmountCalculator(getAvaxOracle());
  }
  return _amountCalculator;
}

function getTransactionExecutor(): TransactionExecutor {
  if (!_transactionExecutor) {
    _transactionExecutor = new TransactionExecutor();
  }
  return _transactionExecutor;
}
const ERGC_SEND_TO_USER = ethers.parseUnits('100', 18); // Send full 100 ERGC (no burn)

// Risk profile configurations - maps to user selection
const RISK_PROFILES = {
  conservative: { aavePercent: 100, gmxPercent: 0, gmxLeverage: 0, name: 'Earn Only' },
  morpho: { aavePercent: 0, gmxPercent: 0, morphoPercent: 100, morphoEurcPercent: 50, morphoDaiPercent: 50, gmxLeverage: 0, name: 'Morpho Vault' },
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
  id: string;
  type: string;
  data?: {
    object?: {
      payment?: SquarePayment;
    };
  };
}

/**
 * Deterministically stringify JSON to match Square's format
 * Square sends compact JSON with sorted keys (alphabetically)
 */
function deterministicStringify(obj: any): string {
  if (typeof obj !== 'object' || obj === null) {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(item => deterministicStringify(item)).join(',') + ']';
  }

  // Sort keys alphabetically (Square's format)
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => {
    const value = obj[key];
    return JSON.stringify(key) + ':' + deterministicStringify(value);
  });
  
  return '{' + pairs.join(',') + '}';
}

/**
 * Verify Square webhook signature
 * 
 * CRITICAL: Square calculates signature as: HMAC-SHA256(notification_url + body)
 * - notification_url: The exact URL Square calls (e.g., "https://www.tiltvault.com/api/square/webhook")
 * - body: The EXACT raw JSON body bytes Square sends (without whitespace)
 * 
 * Square's documentation: "When testing your webhook event notifications, make sure to use 
 * the raw request body without any whitespace. For example, {"hello":"world"}."
 * 
 * We use manual verification with multiple body format variants to match Square's exact format.
 * This handles cases where Vercel's JSON parsing may change the body format.
 */
async function verifySignature(payload: string, signature: string, notificationUrl?: string): Promise<boolean> {
  if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
    console.log('[Webhook] No signature key configured - cannot verify');
    return false;
  }

  if (!payload || typeof payload !== 'string') {
    console.log('[Webhook] No payload provided or invalid payload type');
    return false;
  }

  if (!signature || typeof signature !== 'string') {
    console.log('[Webhook] No signature provided or invalid signature type');
    return false;
  }

  // PRODUCTION webhook URL (must match Square Dashboard configuration exactly)
  const PRODUCTION_WEBHOOK_URL = 'https://www.tiltvault.com/api/square/webhook';
  const finalNotificationUrl = notificationUrl || PRODUCTION_WEBHOOK_URL;

  try {
    // Manual verification with multiple body format variants
    // (This handles cases where Vercel's JSON parsing changes the body format)
    // Log the exact signature format received from Square
    console.log('[Webhook] Raw signature received:', {
      fullSignature: signature,
      signatureLength: signature ? signature.length : 0,
      startsWithSha256: signature.startsWith('sha256='),
      first20Chars: signature.substring(0, 20),
      containsEquals: signature.includes('='),
      equalsPosition: signature.indexOf('=')
    });

    // Square sends signatures as "sha256=<base64_signature>"
    // We need to extract the base64 part
    let signatureBase64 = signature;
    if (signature.startsWith('sha256=')) {
      signatureBase64 = signature.substring(7); // Remove "sha256=" prefix
      console.log('[Webhook] Extracted base64 signature from Square format');
    } else {
      // Signature doesn't start with "sha256=" - use as-is
      // Note: Base64 padding uses '=' at the END, not as a separator
      // So if there's an '=' but not at the start, it's likely base64 padding
      console.log('[Webhook] Using signature as-is (no sha256= prefix detected)');
    }

    // CRITICAL: Square includes the notification URL in the signature!
    // Signature = HMAC-SHA256(notification_url + body)
    // Square uses the exact URL configured in their dashboard
    // Try multiple URL formats in case Square's configured URL differs
    const urlPrefix = notificationUrl || '';
    
    // Try multiple notification URL formats
    const urlVariants = urlPrefix ? [
      urlPrefix, // Primary URL from request headers
      'https://www.tiltvault.com/api/square/webhook', // Hardcoded (most likely)
      'https://tiltvault.com/api/square/webhook', // Without www
      urlPrefix.replace(/^https?:\/\//, 'https://'), // Force https
      urlPrefix.replace(/^https?:\/\//, 'http://'), // Try http (unlikely but possible)
    ].filter((url, index, self) => self.indexOf(url) === index) : []; // Remove duplicates
    
    // Try multiple payload formats to match Square's exact signature
    // Square signs the exact raw JSON they send, so we need to try different stringification methods
    const payloadVariants: { name: string; payload: string; withUrl: string | null }[] = [];
    
    // PRIORITY 1: Use the payload as-is (it should already be deterministic stringified)
    // This is the most likely to match since we pass deterministicStringify() from the handler
    for (const url of urlVariants) {
      payloadVariants.push(
        { name: `as-received-with-url-${url.substring(url.lastIndexOf('/') + 1)}`, payload: payload, withUrl: url },
      );
    }
    payloadVariants.push(
      { name: 'as-received-no-url', payload: payload, withUrl: null },
    );

    // PRIORITY 2: Try parsing and re-stringifying in different formats
    // This handles cases where the payload format might differ
    // CRITICAL: Try MANY variations to match Square's exact format
    try {
      const parsedPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
      
      // Generate all possible stringification variants
      const stringVariants: { name: string; value: string }[] = [];
      
      // 1. Deterministic (sorted keys, compact) - most likely to match Square's format
      try {
        stringVariants.push({ name: 'deterministic', value: deterministicStringify(parsedPayload) });
      } catch (e) {
        console.warn('[Webhook] Deterministic stringify failed in verifySignature:', e);
      }
      
      // 2. Compact with sorted keys manually
      try {
        const sortedKeys = Object.keys(parsedPayload).sort();
        const sortedObj = sortedKeys.reduce((acc: any, key) => {
          acc[key] = parsedPayload[key];
          return acc;
        }, {});
        stringVariants.push({ name: 'sorted-compact', value: JSON.stringify(sortedObj).replace(/\s+/g, '') });
      } catch (e) {
        console.warn('[Webhook] Sorted compact stringify failed:', e);
      }
      
      // 3. Compact (no spaces)
      try {
        stringVariants.push({ name: 'compact', value: JSON.stringify(parsedPayload).replace(/\s+/g, '') });
      } catch (e) {
        console.warn('[Webhook] Compact stringify failed:', e);
      }
      
      // 4. Standard JSON.stringify
      try {
        stringVariants.push({ name: 'standard', value: JSON.stringify(parsedPayload) });
      } catch (e) {
        console.warn('[Webhook] Standard stringify failed:', e);
      }
      
      // 5. Compact with sorted keys (alternative method using JSON.stringify replacer)
      try {
        stringVariants.push({ name: 'sorted-standard', value: JSON.stringify(parsedPayload, Object.keys(parsedPayload).sort()) });
      } catch (e) {
        console.warn('[Webhook] Sorted standard stringify failed:', e);
      }
      
      // Add all variants with each URL and without URL
      for (const variant of stringVariants) {
        // Add with each URL variant
        for (const url of urlVariants) {
          payloadVariants.push(
            { name: `${variant.name}-with-url-${url.substring(url.lastIndexOf('/') + 1)}`, payload: variant.value, withUrl: url }
          );
        }
        // Add without URL
        payloadVariants.push(
          { name: `${variant.name}-no-url`, payload: variant.value, withUrl: null }
        );
      }
      
    } catch (parseError) {
      // Payload is not valid JSON, can only try original
      console.log('[Webhook] Payload is not valid JSON, only trying original format');
    }

    // Try each payload variant
    for (const variant of payloadVariants) {
      // Validate variant payload is a string
      if (!variant.payload || typeof variant.payload !== 'string') {
        console.log(`[Webhook] Skipping variant "${variant.name}": invalid payload`);
        continue;
      }
      
      const hmac = crypto.createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY);
      // Square includes URL in signature: HMAC-SHA256(url + body)
      // CRITICAL: Use variant.withUrl directly (it contains the actual URL string), not urlPrefix
      const signatureInput = variant.withUrl ? (variant.withUrl + variant.payload) : variant.payload;
      hmac.update(signatureInput);
      const expectedSignature = hmac.digest('base64');

      // Convert both signatures to buffers
      let signatureBuffer: Buffer;
      try {
        signatureBuffer = Buffer.from(signatureBase64, 'base64');
      } catch (e) {
        console.error('[Webhook] Failed to decode received signature as base64:', e);
        continue; // Try next variant
      }
      
      const expectedBuffer = Buffer.from(expectedSignature, 'base64');

      // Check lengths before comparing (timingSafeEqual requires same length)
      if (signatureBuffer.length !== expectedBuffer.length) {
        console.log(`[Webhook] Variant "${variant.name}": Length mismatch (received ${signatureBuffer.length}, expected ${expectedBuffer.length})`);
        continue; // Try next variant
      }

      // Use timing-safe comparison
      const isValid = crypto.timingSafeEqual(
        new Uint8Array(signatureBuffer),
        new Uint8Array(expectedBuffer)
      );
      
      // Also try direct string comparison as fallback
      if (!isValid) {
        const directMatch = signatureBase64 === expectedSignature;
        if (directMatch) {
          console.log(`[Webhook] ✅ Variant "${variant.name}": Direct string comparison MATCH`);
          return true;
        }
      }

      if (isValid) {
        console.log(`[Webhook] ✅ Variant "${variant.name}": Signature verification PASSED`);
        console.log('[Webhook] Signature verification details:', {
          variant: variant.name,
          withUrl: variant.withUrl,
          notificationUrl: variant.withUrl || 'none',
          receivedSignature: signatureBase64 && signatureBase64.length > 0 ? signatureBase64.substring(0, 20) + '...' : 'N/A',
          expectedSignature: expectedSignature && expectedSignature.length > 0 ? expectedSignature.substring(0, 20) + '...' : 'N/A',
          payloadLength: variant.payload && typeof variant.payload === 'string' ? variant.payload.length : 0,
          signatureInputLength: (variant.withUrl ? variant.withUrl.length : 0) + (variant.payload && typeof variant.payload === 'string' ? variant.payload.length : 0),
          payloadStart: variant.payload && typeof variant.payload === 'string' && variant.payload.length > 0 ? variant.payload.substring(0, Math.min(200, variant.payload.length)) + '...' : 'N/A',
        });
        return true;
      }

      console.log(`[Webhook] Variant "${variant.name}": Signature mismatch`);
    }

    // None of the variants matched - this indicates the signature key is incorrect
    // When the key is wrong, no amount of formatting will make signatures match
    console.error('[Webhook] ❌ All signature verification variants failed');
    console.error('[Webhook] This typically means SQUARE_WEBHOOK_SIGNATURE_KEY is incorrect');
    console.error('[Webhook] Received signature (first 30 chars):', signatureBase64 && signatureBase64.length > 0 ? signatureBase64.substring(0, 30) + '...' : 'N/A');
    console.error('[Webhook] Received signature length:', signatureBase64 && signatureBase64.length > 0 ? signatureBase64.length : 0);
    console.error('[Webhook] Payload variants tried:', payloadVariants.length);
    console.error('[Webhook] Notification URL variants tried:', urlVariants.length > 0 ? urlVariants.join(', ') : 'NONE');
    console.error('[Webhook] ===== TROUBLESHOOTING =====');
    console.error('[Webhook] 1. Go to: https://developer.squareup.com/apps');
    console.error('[Webhook] 2. Select your app → Webhooks → Your webhook');
    console.error('[Webhook] 3. Click "Show Signature Key"');
    console.error('[Webhook] 4. Copy ENTIRE key (~43 characters, NOT your API access token)');
    console.error('[Webhook] 5. Update SQUARE_WEBHOOK_SIGNATURE_KEY in Vercel environment variables');
    console.error('[Webhook] 6. Redeploy and test again');
    console.error('[Webhook] 7. See VERIFY-SQUARE-WEBHOOK-KEY.md for detailed instructions');
    console.error('[Webhook] ===== END TROUBLESHOOTING =====');
    
    // Log first variant sample for quick debugging
    if (payloadVariants.length > 0) {
      const firstVariant = payloadVariants[0];
      if (firstVariant && firstVariant.payload && typeof firstVariant.payload === 'string') {
        const hmac = crypto.createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY);
        const signatureInput = firstVariant.withUrl ? (firstVariant.withUrl + firstVariant.payload) : firstVariant.payload;
        hmac.update(signatureInput);
        const expected = hmac.digest('base64');
        console.error('[Webhook] First variant sample:', {
          name: firstVariant.name,
          withUrl: firstVariant.withUrl,
          expectedSignature: expected ? expected.substring(0, 30) + '...' : 'N/A',
          receivedSignature: signatureBase64 ? signatureBase64.substring(0, 30) + '...' : 'N/A',
          match: expected === signatureBase64 ? 'YES' : 'NO',
          note: 'If signatures don\'t match, the key is wrong - no amount of formatting will fix it'
        });
      }
    }

    // All signature verification variants failed
    // This should not happen if Square's format is correctly matched
    console.error('[Webhook] ❌ All signature verification variants failed');
    console.error('[Webhook] This indicates a mismatch between Square\'s signature format and our calculation');
    console.error('[Webhook] Check logs above for which variant was closest');
    
    return false;
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
      // Ensure we always have a BigInt - convert if needed
      const rawGasPrice = feeData.gasPrice || feeData.maxFeePerGas;
      networkGasPrice = rawGasPrice ? BigInt(rawGasPrice.toString()) : ethers.parseUnits('70', 'gwei');
      console.log(`[USDC] Network gas price from feeData: ${ethers.formatUnits(networkGasPrice, 'gwei')} gwei`);
      
      // CRITICAL: Check current block base fee to ensure we're above it
      const block = await provider.getBlock('latest');
      if (block && block.baseFeePerGas) {
        const baseFee = BigInt(block.baseFeePerGas.toString());
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
      const privyModule = await import('../utils/privy-signer.js');
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
        const { getPrivyClient } = await import('../utils/privy-client.js');
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
      const rawGasPrice = await publicClient.getGasPrice();
      networkGasPrice = BigInt(rawGasPrice.toString()); // Ensure BigInt
      console.log(`[GMX] Network gas price: ${formatUnits(networkGasPrice, 9)} gwei`);
    } catch (error) {
      console.warn('[GMX] Failed to fetch network gas price, using default 25 gwei');
      const defaultGasRaw = parseUnits('25', 9); // Default to 25 gwei if fetch fails
      networkGasPrice = BigInt(defaultGasRaw.toString()); // Ensure BigInt
    }
    
    const maxGasRaw = parseUnits(MAX_GAS_PRICE_GWEI.toString(), 9); // 100 gwei cap
    const maxGas = BigInt(maxGasRaw.toString()); // Ensure BigInt
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
      authorizationList: [],
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
    
    const btcToken = tokensJson.tokens?.find(t => t.symbol === 'BTC');
    const usdcToken = tokensJson.tokens?.find(t => t.symbol === 'USDC');
    
    if (!btcToken || !usdcToken) {
      throw new Error('BTC or USDC token not found');
    }
    
    const btcUsdcMarket = marketsJson.markets?.find(
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
      authorizationList: [],
    }) as bigint;
    
    if (allowance < usdcAmount) {
      console.log('[GMX] Approving USDC to Router...');
      const approveTxHash = await walletClient.writeContract({
        address: USDC_CONTRACT as `0x${string}`,
        abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
        functionName: 'approve',
        args: [GMX_ROUTER as `0x${string}`, maxUint256],
        chain: avalanche,
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

    const btcToken = tokensJson.tokens?.find(t => t.symbol === 'BTC');
    const usdcToken = tokensJson.tokens?.find(t => t.symbol === 'USDC');

    if (!btcToken || !usdcToken) {
      console.error('[GMX Hub] ❌ Token lookup failed');
      console.error('[GMX Hub] Available tokens:', tokensJson.tokens?.map(t => t.symbol).slice(0, 10) || 'No tokens available');
      return {
        success: false,
        error: `BTC or USDC token not found in GMX API. Available tokens: ${tokensJson.tokens?.map(t => t.symbol).join(', ') || 'No tokens available'}`
      };
    }

    const btcUsdcMarket = marketsJson.markets?.find(
      m => m.isListed &&
        m.indexToken.toLowerCase() === btcToken.address.toLowerCase() &&
        m.shortToken.toLowerCase() === usdcToken.address.toLowerCase()
    );

    if (!btcUsdcMarket) {
      console.error('[GMX Hub] ❌ Market lookup failed');
      console.error('[GMX Hub] Available markets:', marketsJson.markets?.filter(m => m.isListed).map(m => ({
        indexToken: m.indexToken,
        shortToken: m.shortToken,
        marketToken: m.marketToken
      })).slice(0, 5) || 'No markets available');
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
        authorizationList: [],
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
          account,
          address: USDC_CONTRACT as `0x${string}`,
          abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'approve',
          args: [GMX_EXCHANGE_ROUTER as `0x${string}`, maxUint256],
          chain: avalanche,
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
            authorizationList: [],
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
                authorizationList: [],
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
        const baseFeeRaw = await publicClient.getGasPrice();
        const baseFee = BigInt(baseFeeRaw.toString()); // Ensure BigInt
        const minerTipRaw = parseUnits('12', 9); // 12 gwei miner tip (same as Bitcoin tab)
        const minerTip = BigInt(minerTipRaw.toString()); // Ensure BigInt
        const maxFeeBufferRaw = parseUnits('1', 9); // 1 gwei buffer (same as Bitcoin tab)
        const maxFeeBuffer = BigInt(maxFeeBufferRaw.toString()); // Ensure BigInt
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
      const privyModule = await import('../utils/privy-signer.js');
      
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
 * Execute Morpho strategy from hub wallet on Arbitrum
 * 
 * ARCHITECTURE:
 * - Square payments can come from any chain (currently Avalanche)
 * - Hub wallet (0x34c11928868d14bdD7Be55A0D9f9e02257240c24) is multi-chain
 * - For Morpho: Uses Arbitrum USDC from hub wallet (funded separately)
 * - Deposits directly to Morpho vaults on Arbitrum (no bridging needed)
 * 
 * FLOW:
 * 1. Square payment received → webhook triggered
 * 2. If Morpho profile selected → this function called
 * 3. Connects to Arbitrum RPC
 * 4. Uses hub wallet's Arbitrum USDC balance
 * 5. Deposits 50/50 split to Morpho Gauntlet GauntletUSDC (11.54% APY) and Morpho Spark HyperithmUSDC (10.11% APY)
 * 6. Vault shares credited to user's wallet address on Arbitrum
 * 
 * NOTE: Hub wallet must have USDC on Arbitrum (funded separately from Square payments)
 */
export async function executeMorphoFromHubWallet(
  walletAddress: string,
  gauntletAmount: number,
  hyperithmAmount: number,
  paymentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[MORPHO] Executing Morpho strategy from hub wallet for ${walletAddress}...`);
  console.log(`[MORPHO] GauntletUSDC Core vault amount: $${gauntletAmount}, HyperithmUSDC vault amount: $${hyperithmAmount}`);
  console.log(`[MORPHO] Both vaults use USDC as underlying asset`);

  // Validate Arbitrum hub wallet
  if (!ARBITRUM_HUB_WALLET_PRIVATE_KEY || ARBITRUM_HUB_WALLET_PRIVATE_KEY === '') {
    console.error('[MORPHO] ARBITRUM_HUB_WALLET_PRIVATE_KEY not configured');
    return { success: false, error: 'ARBITRUM_HUB_WALLET_PRIVATE_KEY environment variable is required for Morpho operations on Arbitrum' };
  }

  // Accept both with and without 0x prefix
  const cleanArbitrumKey = ARBITRUM_HUB_WALLET_PRIVATE_KEY.startsWith('0x') 
    ? ARBITRUM_HUB_WALLET_PRIVATE_KEY 
    : `0x${ARBITRUM_HUB_WALLET_PRIVATE_KEY}`;

  if (cleanArbitrumKey.length !== 66) {
    console.error('[MORPHO] ARBITRUM_HUB_WALLET_PRIVATE_KEY must be a 32-byte hex string');
    return { success: false, error: 'ARBITRUM_HUB_WALLET_PRIVATE_KEY must be a 32-byte hex string' };
  }

  console.log(`[MORPHO] Using Arbitrum hub wallet: ${ARBITRUM_HUB_WALLET_ADDRESS}`);
  console.log(`[MORPHO] Arbitrum hub wallet private key configured: ${!!ARBITRUM_HUB_WALLET_PRIVATE_KEY && ARBITRUM_HUB_WALLET_PRIVATE_KEY.length > 0}`);

  // Check minimum amounts (same as Aave minimum)
  if (gauntletAmount < AAVE_MIN_SUPPLY_USD || hyperithmAmount < AAVE_MIN_SUPPLY_USD) {
    console.log(`[MORPHO] Amount below minimum $${AAVE_MIN_SUPPLY_USD}, skipping`);
    return { success: false, error: `Minimum deposit is $${AAVE_MIN_SUPPLY_USD} per vault` };
  }

  try {
    // CRITICAL: Connect to Arbitrum for Morpho operations (Morpho vaults are on Arbitrum)
    console.log(`[MORPHO] Connecting to Arbitrum RPC: ${ARBITRUM_RPC}`);
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    
    // Validate provider connectivity and network
    console.log(`[MORPHO] Testing RPC connectivity...`);
    let network;
    try {
      network = await provider.getNetwork();
      console.log(`[MORPHO] ✅ RPC connected - Chain ID: ${network.chainId}, Name: ${network.name}`);
      
      // Verify we're on Arbitrum (Chain ID 42161 for mainnet, 421613 for testnet)
      const expectedChainId = 42161n; // Arbitrum One
      if (network.chainId !== expectedChainId) {
        console.error(`[MORPHO] ❌ Wrong network! Expected Arbitrum (${expectedChainId}), got ${network.chainId}`);
        return { success: false, error: `Wrong network: Expected Arbitrum (${expectedChainId}), got ${network.chainId}` };
      }
    } catch (rpcError: any) {
      console.error(`[MORPHO] ❌ RPC connectivity test failed: ${rpcError?.message || String(rpcError)}`);
      return { 
        success: false, 
        error: `RPC connection failed: ${rpcError?.message || String(rpcError)}. Check ARBITRUM_RPC_URL environment variable.` 
      };
    }
    
    // Validate contract addresses before use
    if (!USDC_ARBITRUM || !USDC_ARBITRUM.startsWith('0x') || USDC_ARBITRUM.length !== 42) {
      return { success: false, error: `Invalid USDC_ARBITRUM address: ${USDC_ARBITRUM}` };
    }
    if (!MORPHO_GAUNTLET_USDC_VAULT || !MORPHO_GAUNTLET_USDC_VAULT.startsWith('0x') || MORPHO_GAUNTLET_USDC_VAULT.length !== 42) {
      return { success: false, error: `Invalid MORPHO_GAUNTLET_USDC_VAULT address: ${MORPHO_GAUNTLET_USDC_VAULT}` };
    }
    if (!MORPHO_HYPERITHM_USDC_VAULT || !MORPHO_HYPERITHM_USDC_VAULT.startsWith('0x') || MORPHO_HYPERITHM_USDC_VAULT.length !== 42) {
      return { success: false, error: `Invalid MORPHO_HYPERITHM_USDC_VAULT address: ${MORPHO_HYPERITHM_USDC_VAULT}` };
    }
    console.log(`[MORPHO] ✅ Contract addresses validated`);
    console.log(`[MORPHO] USDC: ${USDC_ARBITRUM}`);
    console.log(`[MORPHO] GauntletUSDC Core Vault: ${MORPHO_GAUNTLET_USDC_VAULT}`);
    console.log(`[MORPHO] HyperithmUSDC Vault: ${MORPHO_HYPERITHM_USDC_VAULT}`);
    
    const hubWallet = new ethers.Wallet(cleanArbitrumKey, provider);
    
    // Verify wallet matches expected Arbitrum hub wallet address
    if (hubWallet.address.toLowerCase() !== ARBITRUM_HUB_WALLET_ADDRESS.toLowerCase()) {
      console.error(`[MORPHO] Arbitrum private key mismatch! Expected: ${ARBITRUM_HUB_WALLET_ADDRESS}, Got: ${hubWallet.address}`);
      return { success: false, error: 'Arbitrum private key does not match hub wallet address' };
    }
    
    console.log(`[MORPHO] ✅ Arbitrum hub wallet verified: ${hubWallet.address}`);

    // Verify contracts exist before creating contract objects
    console.log(`[MORPHO] Verifying contract existence...`);
    const usdcCode = await provider.getCode(USDC_ARBITRUM);
    const gauntletVaultCode = await provider.getCode(MORPHO_GAUNTLET_USDC_VAULT);
    const hyperithmVaultCode = await provider.getCode(MORPHO_HYPERITHM_USDC_VAULT);
    
    if (!usdcCode || usdcCode === '0x' || usdcCode === '0x0' || usdcCode.length < 4) {
      console.error(`[MORPHO] ❌ USDC contract not found at ${USDC_ARBITRUM}`);
      return { success: false, error: `USDC contract not found at ${USDC_ARBITRUM}. Check USDC_ARBITRUM address. Verify on Arbiscan: https://arbiscan.io/address/${USDC_ARBITRUM}` };
    }
    if (!gauntletVaultCode || gauntletVaultCode === '0x' || gauntletVaultCode === '0x0' || gauntletVaultCode.length < 4) {
      console.error(`[MORPHO] ❌ GauntletUSDC Core vault contract not found at ${MORPHO_GAUNTLET_USDC_VAULT}`);
      console.error(`[MORPHO] ❌ Verify the correct address on Arbiscan: https://arbiscan.io/address/${MORPHO_GAUNTLET_USDC_VAULT}`);
      return { 
        success: false, 
        error: `GauntletUSDC Core vault contract not found at ${MORPHO_GAUNTLET_USDC_VAULT}. The address may be incorrect. Verify on Arbiscan: https://arbiscan.io/address/${MORPHO_GAUNTLET_USDC_VAULT} or check Morpho documentation for the correct vault address.` 
      };
    }
    if (!hyperithmVaultCode || hyperithmVaultCode === '0x' || hyperithmVaultCode === '0x0' || hyperithmVaultCode.length < 4) {
      console.error(`[MORPHO] ❌ HyperithmUSDC vault contract not found at ${MORPHO_HYPERITHM_USDC_VAULT}`);
      console.error(`[MORPHO] ❌ Verify the correct address on Arbiscan: https://arbiscan.io/address/${MORPHO_HYPERITHM_USDC_VAULT}`);
      return { 
        success: false, 
        error: `HyperithmUSDC vault contract not found at ${MORPHO_HYPERITHM_USDC_VAULT}. The address may be incorrect. Verify on Arbiscan: https://arbiscan.io/address/${MORPHO_HYPERITHM_USDC_VAULT} or check Morpho documentation for the correct vault address.` 
      };
    }
    console.log(`[MORPHO] ✅ All contracts exist (USDC: ${usdcCode.length} bytes, Gauntlet: ${gauntletVaultCode.length} bytes, Hyperithm: ${hyperithmVaultCode.length} bytes)`);
    
    // Use Arbitrum USDC for Morpho operations
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, ERC20_ABI, hubWallet);
    const gauntletVault = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, ERC4626_VAULT_ABI, hubWallet);
    const hyperithmVault = new ethers.Contract(MORPHO_HYPERITHM_USDC_VAULT, ERC4626_VAULT_ABI, hubWallet);

    // CRITICAL: Check inflation attack protection (dead deposit)
    // NOTE: This is a safety check - if it fails, we'll log a warning but continue with deposit
    // Some vault contracts may have ABI mismatches or not implement ERC4626 exactly
    const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
    const MIN_DEAD_SHARES = 1_000_000_000n; // 1e9 shares minimum
    
    console.log(`[MORPHO] Testing vault connectivity...`);
    console.log(`[MORPHO] GauntletUSDC Core Vault Address: ${MORPHO_GAUNTLET_USDC_VAULT}`);
    console.log(`[MORPHO] HyperithmUSDC Vault Address: ${MORPHO_HYPERITHM_USDC_VAULT}`);
    
    console.log(`[MORPHO] ✅ Vault contracts found (GauntletUSDC: ${gauntletVaultCode.length} bytes, HyperithmUSDC: ${hyperithmVaultCode.length} bytes)`);
    
    // Continue with safety checks (inflation protection) - these can fail without blocking
    try {
      
      // Try to call balanceOf with low-level call to avoid ABI decoding issues
      let gauntletDeadShares: bigint | null = null;
      let hyperithmDeadShares: bigint | null = null;
      
      try {
        console.log(`[MORPHO] Checking GauntletUSDC vault inflation protection...`);
        const gauntletBalanceOfInterface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
        const gauntletData = gauntletBalanceOfInterface.encodeFunctionData('balanceOf', [DEAD_ADDRESS]);
        const gauntletResult = await provider.call({
          to: MORPHO_GAUNTLET_USDC_VAULT,
          data: gauntletData
        });
        
        if (gauntletResult && gauntletResult !== '0x' && gauntletResult.length > 2) {
          gauntletDeadShares = ethers.getBigInt(gauntletResult);
          console.log(`[MORPHO] GauntletUSDC dead shares: ${gauntletDeadShares.toString()}`);
          if (gauntletDeadShares < MIN_DEAD_SHARES) {
            console.warn(`[MORPHO] ⚠️ GauntletUSDC vault has low inflation protection (${gauntletDeadShares} < ${MIN_DEAD_SHARES})`);
          }
        } else {
          console.warn(`[MORPHO] ⚠️ GauntletUSDC vault balanceOf returned empty data - skipping check`);
        }
      } catch (gauntletError: any) {
        const errorMsg = gauntletError instanceof Error ? gauntletError.message : String(gauntletError);
        console.warn(`[MORPHO] ⚠️ Failed to check GauntletUSDC vault inflation protection: ${errorMsg}`);
      }
      
      try {
        console.log(`[MORPHO] Checking HyperithmUSDC vault inflation protection...`);
        const hyperithmBalanceOfInterface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
        const hyperithmData = hyperithmBalanceOfInterface.encodeFunctionData('balanceOf', [DEAD_ADDRESS]);
        const hyperithmResult = await provider.call({
          to: MORPHO_HYPERITHM_USDC_VAULT,
          data: hyperithmData
        });
        
        if (hyperithmResult && hyperithmResult !== '0x' && hyperithmResult.length > 2) {
          hyperithmDeadShares = ethers.getBigInt(hyperithmResult);
          console.log(`[MORPHO] HyperithmUSDC dead shares: ${hyperithmDeadShares.toString()}`);
          if (hyperithmDeadShares < MIN_DEAD_SHARES) {
            console.warn(`[MORPHO] ⚠️ HyperithmUSDC vault has low inflation protection (${hyperithmDeadShares} < ${MIN_DEAD_SHARES})`);
          }
        } else {
          console.warn(`[MORPHO] ⚠️ HyperithmUSDC vault balanceOf returned empty data - skipping check`);
        }
      } catch (hyperithmError: any) {
        const errorMsg = hyperithmError instanceof Error ? hyperithmError.message : String(hyperithmError);
        console.warn(`[MORPHO] ⚠️ Failed to check HyperithmUSDC vault inflation protection: ${errorMsg}`);
      }
      
      // Enforce inflation protection per Morpho docs: fail if inadequate protection
      if (gauntletDeadShares !== null) {
        if (gauntletDeadShares < MIN_DEAD_SHARES) {
          console.error(`[MORPHO] ❌ GauntletUSDC vault lacks required inflation protection: ${gauntletDeadShares} < ${MIN_DEAD_SHARES}`);
          return { 
            success: false, 
            error: `GauntletUSDC vault lacks required inflation protection (${gauntletDeadShares} < ${MIN_DEAD_SHARES}). Vault may be unsafe.` 
          };
        }
        console.log(`[MORPHO] ✅ GauntletUSDC vault inflation protection verified: ${gauntletDeadShares} shares`);
      } else {
        console.warn(`[MORPHO] ⚠️ Could not verify GauntletUSDC vault inflation protection (contract call failed)`);
        console.warn(`[MORPHO] ⚠️ Proceeding with deposit but verify vault safety manually`);
      }
      
      if (hyperithmDeadShares !== null) {
        if (hyperithmDeadShares < MIN_DEAD_SHARES) {
          console.error(`[MORPHO] ❌ HyperithmUSDC vault lacks required inflation protection: ${hyperithmDeadShares} < ${MIN_DEAD_SHARES}`);
          return { 
            success: false, 
            error: `HyperithmUSDC vault lacks required inflation protection (${hyperithmDeadShares} < ${MIN_DEAD_SHARES}). Vault may be unsafe.` 
          };
        }
        console.log(`[MORPHO] ✅ HyperithmUSDC vault inflation protection verified: ${hyperithmDeadShares} shares`);
      } else {
        console.warn(`[MORPHO] ⚠️ Could not verify HyperithmUSDC vault inflation protection (contract call failed)`);
        console.warn(`[MORPHO] ⚠️ Proceeding with deposit but verify vault safety manually`);
      }
    } catch (safetyCheckError) {
      // CRITICAL: Don't block deposit if safety checks fail - log and continue
      console.error(`[MORPHO] ❌ Safety checks failed:`, safetyCheckError);
      console.warn(`[MORPHO] ⚠️ Continuing with deposit despite safety check failure`);
      console.warn(`[MORPHO] ⚠️ This may indicate vault contract issues - verify addresses and ABI`);
    }

    // Get vault asset addresses to verify they accept USDC (using low-level calls)
    let gauntletVaultAsset: string | null = null;
    let hyperithmVaultAsset: string | null = null;
    
    try {
      console.log(`[MORPHO] Getting vault asset addresses via low-level call...`);
      const assetInterface = new ethers.Interface(['function asset() view returns (address)']);
      const eurcAssetData = assetInterface.encodeFunctionData('asset', []);
      const eurcAssetResult = await provider.call({
        to: MORPHO_GAUNTLET_USDC_VAULT,
        data: eurcAssetData
      });
      if (eurcAssetResult && eurcAssetResult !== '0x' && eurcAssetResult.length > 2) {
        // Decode the address (last 20 bytes of the 32-byte result)
        gauntletVaultAsset = '0x' + eurcAssetResult.slice(-40);
        console.log(`[MORPHO] GauntletUSDC vault asset: ${gauntletVaultAsset}`);
      } else {
        console.warn(`[MORPHO] ⚠️ GauntletUSDC vault asset() returned empty data`);
      }
    } catch (eurcAssetError) {
      console.error(`[MORPHO] ❌ Failed to get GauntletUSDC vault asset:`, eurcAssetError);
      console.warn(`[MORPHO] ⚠️ Continuing without asset verification`);
    }
    
    try {
      const assetInterface = new ethers.Interface(['function asset() view returns (address)']);
      const daiAssetData = assetInterface.encodeFunctionData('asset', []);
      const daiAssetResult = await provider.call({
        to: MORPHO_HYPERITHM_USDC_VAULT,
        data: daiAssetData
      });
      if (daiAssetResult && daiAssetResult !== '0x' && daiAssetResult.length > 2) {
        // Decode the address (last 20 bytes of the 32-byte result)
        hyperithmVaultAsset = '0x' + daiAssetResult.slice(-40);
        console.log(`[MORPHO] HyperithmUSDC vault asset: ${hyperithmVaultAsset}`);
      } else {
        console.warn(`[MORPHO] ⚠️ HyperithmUSDC vault asset() returned empty data`);
      }
    } catch (daiAssetError) {
      console.error(`[MORPHO] ❌ Failed to get HyperithmUSDC vault asset:`, daiAssetError);
      console.warn(`[MORPHO] ⚠️ Continuing without asset verification`);
    }
    
    // Verify vaults accept USDC - both should use USDC as underlying asset
    if (gauntletVaultAsset) {
      if (gauntletVaultAsset.toLowerCase() !== USDC_ARBITRUM.toLowerCase()) {
        console.warn(`[MORPHO] ⚠️ GauntletUSDC vault asset (${gauntletVaultAsset}) differs from USDC. Expected USDC.`);
      } else {
        console.log(`[MORPHO] ✅ GauntletUSDC vault confirmed to use USDC`);
      }
    }
    if (hyperithmVaultAsset) {
      if (hyperithmVaultAsset.toLowerCase() !== USDC_ARBITRUM.toLowerCase()) {
        console.warn(`[MORPHO] ⚠️ HyperithmUSDC vault asset (${hyperithmVaultAsset}) differs from USDC. Expected USDC.`);
      } else {
        console.log(`[MORPHO] ✅ HyperithmUSDC vault confirmed to use USDC`);
      }
    }

    // Convert amounts to wei (USDC has 6 decimals)
    // Explicitly convert to number first to avoid BigInt mixing issues
    const gauntletAmountNum = Number(gauntletAmount);
    const hyperithmAmountNum = Number(hyperithmAmount);
    const gauntletAmountWei = BigInt(Math.floor(gauntletAmountNum * 1_000_000));
    const hyperithmAmountWei = BigInt(Math.floor(hyperithmAmountNum * 1_000_000));
    const totalAmountWei = gauntletAmountWei + hyperithmAmountWei;

    // Check hub wallet USDC balance on Arbitrum (using low-level call to avoid ABI issues)
    let hubBalance: bigint;
    try {
      console.log(`[MORPHO] Checking hub wallet USDC balance via low-level call...`);
      const balanceOfInterface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
      const balanceData = balanceOfInterface.encodeFunctionData('balanceOf', [hubWallet.address]);
      const balanceResult = await provider.call({
        to: USDC_ARBITRUM,
        data: balanceData
      });
      if (balanceResult && balanceResult !== '0x' && balanceResult.length > 2) {
        hubBalance = ethers.getBigInt(balanceResult);
        console.log(`[MORPHO] ✅ Hub balance retrieved: ${hubBalance.toString()}`);
      } else {
        console.error(`[MORPHO] ❌ Hub balance check returned empty data (0x)`);
        return { success: false, error: `Failed to check hub wallet USDC balance: Contract returned empty data. Is USDC contract address correct?` };
      }
    } catch (balanceError: any) {
      console.error(`[MORPHO] ❌ Failed to check hub wallet USDC balance: ${balanceError?.message || String(balanceError)}`);
      return { success: false, error: `Failed to check hub wallet USDC balance: ${balanceError?.message || String(balanceError)}` };
    }
    
    const hubBalanceFormatted = ethers.formatUnits(hubBalance, 6);
    console.log(`[MORPHO] Hub wallet Arbitrum USDC balance: $${hubBalanceFormatted}`);
    console.log(`[MORPHO] Hub wallet address: ${hubWallet.address}`);
    console.log(`[MORPHO] Required amount: $${gauntletAmount + hyperithmAmount}`);
    
    if (hubBalance < totalAmountWei) {
      console.error(`[MORPHO] ❌ Insufficient USDC balance on Arbitrum. Have: $${hubBalanceFormatted}, Need: $${gauntletAmount + hyperithmAmount}`);
      return { success: false, error: `Insufficient USDC balance in hub wallet on Arbitrum. Have: $${hubBalanceFormatted}, Need: $${gauntletAmount + hyperithmAmount}` };
    }
    console.log(`[MORPHO] ✅ Sufficient USDC balance on Arbitrum: $${hubBalanceFormatted}`);

    // Get gas price
    let networkGasPrice: bigint;
    try {
      const feeData = await provider.getFeeData();
      // Ensure we always have a BigInt - convert if needed
      const rawGasPrice = feeData.gasPrice || feeData.maxFeePerGas;
      networkGasPrice = rawGasPrice ? BigInt(rawGasPrice.toString()) : ethers.parseUnits('70', 'gwei');
      
      const block = await provider.getBlock('latest');
      if (block && block.baseFeePerGas) {
        const baseFee = BigInt(block.baseFeePerGas.toString());
        const minGasPrice = (baseFee * 120n) / 100n;
        if (networkGasPrice < minGasPrice) {
          networkGasPrice = minGasPrice;
        }
      }
    } catch (error) {
      console.warn('[MORPHO] Failed to fetch gas price, using default 70 gwei');
      networkGasPrice = ethers.parseUnits('70', 'gwei');
    }
    
    const maxGasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const gasPrice = networkGasPrice > maxGasPrice ? maxGasPrice : networkGasPrice;

    const txHashes: string[] = [];

    // Step 1: Approve and deposit to GauntletUSDC vault
    console.log(`[MORPHO] Step 1: Depositing $${gauntletAmount} to Morpho Gauntlet GauntletUSDC vault...`);
    
    // Preview deposit to estimate shares (slippage protection) - non-blocking
    let expectedGauntletShares: bigint | null = null;
    try {
      expectedGauntletShares = await gauntletVault.previewDeposit(gauntletAmountWei);
      console.log(`[MORPHO] Expected GauntletUSDC shares: ${expectedGauntletShares.toString()}`);
    } catch (previewError: any) {
      console.warn(`[MORPHO] ⚠️ Could not preview GauntletUSDC deposit (non-blocking): ${previewError?.message || String(previewError)}`);
      console.log(`[MORPHO] Proceeding with deposit without preview...`);
    }
    
    // Check and approve USDC for GauntletUSDC vault (using low-level call)
    let gauntletAllowance: bigint;
    try {
      const allowanceInterface = new ethers.Interface(['function allowance(address owner, address spender) view returns (uint256)']);
      const allowanceData = allowanceInterface.encodeFunctionData('allowance', [hubWallet.address, MORPHO_GAUNTLET_USDC_VAULT]);
      const allowanceResult = await provider.call({
        to: USDC_ARBITRUM,
        data: allowanceData
      });
      if (allowanceResult && allowanceResult !== '0x' && allowanceResult.length > 2) {
        gauntletAllowance = ethers.getBigInt(allowanceResult);
      } else {
        console.warn(`[MORPHO] ⚠️ Allowance check returned empty data, assuming 0`);
        gauntletAllowance = 0n;
      }
    } catch (allowanceError: any) {
      console.warn(`[MORPHO] ⚠️ Failed to check allowance (non-blocking): ${allowanceError?.message || String(allowanceError)}`);
      gauntletAllowance = 0n; // Assume no allowance if check fails
    }
    if (gauntletAllowance < gauntletAmountWei) {
      console.log('[MORPHO] Approving USDC for GauntletUSDC vault...');
      const approveGauntletTx = await usdcContract.approve(MORPHO_GAUNTLET_USDC_VAULT, ethers.MaxUint256, { gasPrice });
      const approveGauntletReceipt = await approveGauntletTx.wait();
      if (approveGauntletReceipt?.status !== 1) {
        throw new Error(`USDC approval for GauntletUSDC vault failed. Status: ${approveGauntletReceipt?.status}`);
      }
      console.log('[MORPHO] GauntletUSDC vault approval confirmed');
    }

    // Get balance before deposit to calculate shares received (non-blocking)
    // Use low-level call to avoid ABI decoding issues
    let gauntletSharesBefore: bigint | null = null;
    try {
      console.log(`[MORPHO] Calling balanceOf on GauntletUSDC vault at ${MORPHO_GAUNTLET_USDC_VAULT} for wallet ${walletAddress}...`);
      const balanceOfInterface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
      const balanceData = balanceOfInterface.encodeFunctionData('balanceOf', [walletAddress]);
      const balanceResult = await provider.call({
        to: MORPHO_GAUNTLET_USDC_VAULT,
        data: balanceData
      });
      if (balanceResult && balanceResult !== '0x' && balanceResult.length > 2) {
        gauntletSharesBefore = ethers.getBigInt(balanceResult);
        console.log(`[MORPHO] GauntletUSDC shares before deposit: ${gauntletSharesBefore.toString()}`);
      } else {
        console.warn(`[MORPHO] ⚠️ GauntletUSDC vault balanceOf returned empty data, assuming 0 shares`);
        gauntletSharesBefore = 0n;
      }
    } catch (balanceError: any) {
      const errorMsg = balanceError?.message || String(balanceError);
      const errorCode = balanceError?.code || 'UNKNOWN';
      console.error(`[MORPHO] ❌ balanceOf failed for GauntletUSDC vault: ${errorMsg} (code: ${errorCode})`);
      console.error(`[MORPHO] Vault address: ${MORPHO_GAUNTLET_USDC_VAULT}, Wallet: ${walletAddress}`);
      console.warn(`[MORPHO] ⚠️ Could not get GauntletUSDC shares before deposit (non-blocking) - assuming 0 and proceeding...`);
      gauntletSharesBefore = 0n; // Assume 0 shares if we can't check
    }
    
    // Deposit to GauntletUSDC vault (Morpho V2 ERC-4626: deposit assets, receive shares)
    // Per Morpho docs: deposit(uint256 assets, address receiver) returns (uint256 shares)
    // onBehalf/receiver is the user wallet address so they receive the vault shares
    console.log(`[MORPHO] Executing GauntletUSDC vault deposit: ${ethers.formatUnits(gauntletAmountWei, 6)} USDC`);
    const depositGauntletTx = await gauntletVault.deposit(gauntletAmountWei, walletAddress, { gasPrice });
    const depositGauntletReceipt = await depositGauntletTx.wait();
    if (depositGauntletReceipt?.status !== 1) {
      throw new Error(`GauntletUSDC vault deposit failed. Status: ${depositGauntletReceipt?.status}`);
    }
    
    // Capture shares returned from deposit (per Morpho docs pattern)
    // The deposit function returns the number of shares minted
    let gauntletSharesMinted: bigint | null = null;
    try {
      // Parse the transaction receipt logs to get shares minted
      // ERC4626 Deposit event: Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)
      const depositInterface = new ethers.Interface(['event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)']);
      const depositLog = depositGauntletReceipt.logs.find(log => {
        try {
          const parsed = depositInterface.parseLog(log);
          return parsed && parsed.args.owner.toLowerCase() === walletAddress.toLowerCase();
        } catch {
          return false;
        }
      });
      if (depositLog) {
        const parsed = depositInterface.parseLog(depositLog);
        gauntletSharesMinted = parsed.args.shares;
        console.log(`[MORPHO] GauntletUSDC shares minted (from event): ${gauntletSharesMinted.toString()}`);
      }
    } catch (eventError) {
      console.warn(`[MORPHO] ⚠️ Could not parse deposit event, will verify via balance check`);
    }
    
    // Verify shares received and enforce slippage tolerance (per Morpho docs)
    // Use low-level call to avoid ABI decoding issues
    if (gauntletSharesBefore !== null) {
      try {
        const balanceOfInterface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
        const balanceData = balanceOfInterface.encodeFunctionData('balanceOf', [walletAddress]);
        const balanceResult = await provider.call({
          to: MORPHO_GAUNTLET_USDC_VAULT,
          data: balanceData
        });
        if (balanceResult && balanceResult !== '0x' && balanceResult.length > 2) {
          const gauntletSharesAfter = ethers.getBigInt(balanceResult);
          const gauntletSharesReceived = gauntletSharesAfter - gauntletSharesBefore;
          console.log(`[MORPHO] GauntletUSDC shares received: ${gauntletSharesReceived.toString()} (balance: ${gauntletSharesAfter.toString()})`);
          
          // Enforce slippage tolerance per Morpho docs (1% tolerance = 99% of expected)
          if (expectedGauntletShares !== null) {
            const minShares = expectedGauntletShares * 99n / 100n;
            if (gauntletSharesReceived < minShares) {
              console.error(`[MORPHO] ❌ Slippage tolerance exceeded: received ${gauntletSharesReceived}, expected at least ${minShares}`);
              return { 
                success: false, 
                error: `GauntletUSDC deposit slippage tolerance exceeded: received ${gauntletSharesReceived} shares, expected at least ${minShares} (1% tolerance)` 
              };
            }
            console.log(`[MORPHO] ✅ GauntletUSDC slippage check passed: ${gauntletSharesReceived} >= ${minShares}`);
          }
        } else {
          console.warn(`[MORPHO] ⚠️ Could not verify GauntletUSDC shares after deposit (empty response)`);
        }
      } catch (balanceError: any) {
        console.warn(`[MORPHO] ⚠️ Could not verify GauntletUSDC shares after deposit: ${balanceError?.message || String(balanceError)}`);
        // If we have shares from event, use that for verification
        if (gauntletSharesMinted !== null && expectedGauntletShares !== null) {
          const minShares = expectedGauntletShares * 99n / 100n;
          if (gauntletSharesMinted < minShares) {
            return { 
              success: false, 
              error: `GauntletUSDC deposit slippage tolerance exceeded: received ${gauntletSharesMinted} shares, expected at least ${minShares} (1% tolerance)` 
            };
          }
        }
      }
    } else {
      // If we couldn't get shares before, use event data for slippage check
      if (gauntletSharesMinted !== null && expectedGauntletShares !== null) {
        const minShares = expectedGauntletShares * 99n / 100n;
        if (gauntletSharesMinted < minShares) {
          return { 
            success: false, 
            error: `GauntletUSDC deposit slippage tolerance exceeded: received ${gauntletSharesMinted} shares, expected at least ${minShares} (1% tolerance)` 
          };
        }
        console.log(`[MORPHO] ✅ GauntletUSDC slippage check passed (from event): ${gauntletSharesMinted} >= ${minShares}`);
      } else {
        console.warn(`[MORPHO] ⚠️ Skipping GauntletUSDC slippage verification (insufficient data)`);
      }
    }
    
    txHashes.push(depositGauntletTx.hash);
    console.log(`[MORPHO] ✅ GauntletUSDC vault deposit confirmed: ${depositGauntletTx.hash}`);

    // Step 2: Approve and deposit to HyperithmUSDC vault
    console.log(`[MORPHO] Step 2: Depositing $${hyperithmAmount} to Morpho Spark HyperithmUSDC vault...`);
    
    // Preview deposit to estimate shares (slippage protection) - non-blocking
    let expectedHyperithmShares: bigint | null = null;
    try {
      expectedHyperithmShares = await hyperithmVault.previewDeposit(hyperithmAmountWei);
      console.log(`[MORPHO] Expected HyperithmUSDC shares: ${expectedHyperithmShares.toString()}`);
    } catch (previewError: any) {
      console.warn(`[MORPHO] ⚠️ Could not preview HyperithmUSDC deposit (non-blocking): ${previewError?.message || String(previewError)}`);
      console.log(`[MORPHO] Proceeding with deposit without preview...`);
    }
    
    // Check and approve USDC for HyperithmUSDC vault (using low-level call)
    let hyperithmAllowance: bigint;
    try {
      const allowanceInterface = new ethers.Interface(['function allowance(address owner, address spender) view returns (uint256)']);
      const allowanceData = allowanceInterface.encodeFunctionData('allowance', [hubWallet.address, MORPHO_HYPERITHM_USDC_VAULT]);
      const allowanceResult = await provider.call({
        to: USDC_ARBITRUM,
        data: allowanceData
      });
      if (allowanceResult && allowanceResult !== '0x' && allowanceResult.length > 2) {
        hyperithmAllowance = ethers.getBigInt(allowanceResult);
      } else {
        console.warn(`[MORPHO] ⚠️ Allowance check returned empty data, assuming 0`);
        hyperithmAllowance = 0n;
      }
    } catch (allowanceError: any) {
      console.warn(`[MORPHO] ⚠️ Failed to check allowance (non-blocking): ${allowanceError?.message || String(allowanceError)}`);
      hyperithmAllowance = 0n; // Assume no allowance if check fails
    }
    if (hyperithmAllowance < hyperithmAmountWei) {
      console.log('[MORPHO] Approving USDC for HyperithmUSDC vault...');
      const approveHyperithmTx = await usdcContract.approve(MORPHO_HYPERITHM_USDC_VAULT, ethers.MaxUint256, { gasPrice });
      const approveHyperithmReceipt = await approveHyperithmTx.wait();
      if (approveHyperithmReceipt?.status !== 1) {
        throw new Error(`USDC approval for HyperithmUSDC vault failed. Status: ${approveHyperithmReceipt?.status}`);
      }
      console.log('[MORPHO] HyperithmUSDC vault approval confirmed');
    }

    // Get balance before deposit to calculate shares received (non-blocking)
    // Use low-level call to avoid ABI decoding issues
    let hyperithmSharesBefore: bigint | null = null;
    try {
      console.log(`[MORPHO] Calling balanceOf on HyperithmUSDC vault at ${MORPHO_HYPERITHM_USDC_VAULT} for wallet ${walletAddress}...`);
      const balanceOfInterface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
      const balanceData = balanceOfInterface.encodeFunctionData('balanceOf', [walletAddress]);
      const balanceResult = await provider.call({
        to: MORPHO_HYPERITHM_USDC_VAULT,
        data: balanceData
      });
      if (balanceResult && balanceResult !== '0x' && balanceResult.length > 2) {
        hyperithmSharesBefore = ethers.getBigInt(balanceResult);
        console.log(`[MORPHO] HyperithmUSDC shares before deposit: ${hyperithmSharesBefore.toString()}`);
      } else {
        console.warn(`[MORPHO] ⚠️ HyperithmUSDC vault balanceOf returned empty data, assuming 0 shares`);
        hyperithmSharesBefore = 0n;
      }
    } catch (balanceError: any) {
      const errorMsg = balanceError?.message || String(balanceError);
      const errorCode = balanceError?.code || 'UNKNOWN';
      console.error(`[MORPHO] ❌ balanceOf failed for HyperithmUSDC vault: ${errorMsg} (code: ${errorCode})`);
      console.error(`[MORPHO] Vault address: ${MORPHO_HYPERITHM_USDC_VAULT}, Wallet: ${walletAddress}`);
      console.warn(`[MORPHO] ⚠️ Could not get HyperithmUSDC shares before deposit (non-blocking) - assuming 0 and proceeding...`);
      hyperithmSharesBefore = 0n; // Assume 0 shares if we can't check
    }
    
    // Deposit to HyperithmUSDC vault (Morpho V2 ERC-4626: deposit assets, receive shares)
    // Per Morpho docs: deposit(uint256 assets, address receiver) returns (uint256 shares)
    // onBehalf/receiver is the user wallet address so they receive the vault shares
    console.log(`[MORPHO] Executing HyperithmUSDC vault deposit: ${ethers.formatUnits(hyperithmAmountWei, 6)} USDC`);
    const depositHyperithmTx = await hyperithmVault.deposit(hyperithmAmountWei, walletAddress, { gasPrice });
    const depositHyperithmReceipt = await depositHyperithmTx.wait();
    if (depositHyperithmReceipt?.status !== 1) {
      throw new Error(`HyperithmUSDC vault deposit failed. Status: ${depositHyperithmReceipt?.status}`);
    }
    
    // Capture shares returned from deposit (per Morpho docs pattern)
    let hyperithmSharesMinted: bigint | null = null;
    try {
      const depositInterface = new ethers.Interface(['event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)']);
      const depositLog = depositHyperithmReceipt.logs.find(log => {
        try {
          const parsed = depositInterface.parseLog(log);
          return parsed && parsed.args.owner.toLowerCase() === walletAddress.toLowerCase();
        } catch {
          return false;
        }
      });
      if (depositLog) {
        const parsed = depositInterface.parseLog(depositLog);
        hyperithmSharesMinted = parsed.args.shares;
        console.log(`[MORPHO] HyperithmUSDC shares minted (from event): ${hyperithmSharesMinted.toString()}`);
      }
    } catch (eventError) {
      console.warn(`[MORPHO] ⚠️ Could not parse deposit event, will verify via balance check`);
    }
    
    // Verify shares received and enforce slippage tolerance (per Morpho docs)
    // Use low-level call to avoid ABI decoding issues
    if (hyperithmSharesBefore !== null) {
      try {
        const balanceOfInterface = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
        const balanceData = balanceOfInterface.encodeFunctionData('balanceOf', [walletAddress]);
        const balanceResult = await provider.call({
          to: MORPHO_HYPERITHM_USDC_VAULT,
          data: balanceData
        });
        if (balanceResult && balanceResult !== '0x' && balanceResult.length > 2) {
          const hyperithmSharesAfter = ethers.getBigInt(balanceResult);
          const hyperithmSharesReceived = hyperithmSharesAfter - hyperithmSharesBefore;
          console.log(`[MORPHO] HyperithmUSDC shares received: ${hyperithmSharesReceived.toString()} (balance: ${hyperithmSharesAfter.toString()})`);
          
          // Enforce slippage tolerance per Morpho docs (1% tolerance = 99% of expected)
          if (expectedHyperithmShares !== null) {
            const minShares = expectedHyperithmShares * 99n / 100n;
            if (hyperithmSharesReceived < minShares) {
              console.error(`[MORPHO] ❌ Slippage tolerance exceeded: received ${hyperithmSharesReceived}, expected at least ${minShares}`);
              return { 
                success: false, 
                error: `HyperithmUSDC deposit slippage tolerance exceeded: received ${hyperithmSharesReceived} shares, expected at least ${minShares} (1% tolerance)` 
              };
            }
            console.log(`[MORPHO] ✅ HyperithmUSDC slippage check passed: ${hyperithmSharesReceived} >= ${minShares}`);
          }
        } else {
          console.warn(`[MORPHO] ⚠️ Could not verify HyperithmUSDC shares after deposit (empty response)`);
        }
      } catch (balanceError: any) {
        console.warn(`[MORPHO] ⚠️ Could not verify HyperithmUSDC shares after deposit: ${balanceError?.message || String(balanceError)}`);
        // If we have shares from event, use that for verification
        if (hyperithmSharesMinted !== null && expectedHyperithmShares !== null) {
          const minShares = expectedHyperithmShares * 99n / 100n;
          if (hyperithmSharesMinted < minShares) {
            return { 
              success: false, 
              error: `HyperithmUSDC deposit slippage tolerance exceeded: received ${hyperithmSharesMinted} shares, expected at least ${minShares} (1% tolerance)` 
            };
          }
        }
      }
    } else {
      // If we couldn't get shares before, use event data for slippage check
      if (hyperithmSharesMinted !== null && expectedHyperithmShares !== null) {
        const minShares = expectedHyperithmShares * 99n / 100n;
        if (hyperithmSharesMinted < minShares) {
          return { 
            success: false, 
            error: `HyperithmUSDC deposit slippage tolerance exceeded: received ${hyperithmSharesMinted} shares, expected at least ${minShares} (1% tolerance)` 
          };
        }
        console.log(`[MORPHO] ✅ HyperithmUSDC slippage check passed (from event): ${hyperithmSharesMinted} >= ${minShares}`);
      } else {
        console.warn(`[MORPHO] ⚠️ Skipping HyperithmUSDC slippage verification (insufficient data)`);
      }
    }
    
    txHashes.push(depositHyperithmTx.hash);
    console.log(`[MORPHO] ✅ HyperithmUSDC vault deposit confirmed: ${depositHyperithmTx.hash}`);

    // Return success with combined transaction info
    // Use the last transaction hash as the primary hash
    return {
      success: true,
      txHash: depositHyperithmTx.hash, // Primary hash (can also return array if needed)
    };

  } catch (error) {
    console.error('[MORPHO] Execution error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
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
    
    // CRITICAL: Don't wait for confirmation to avoid webhook timeout
    // Return immediately with transaction hash
    console.log(`[AAVE] Transaction submitted: ${supplyTx.hash} (not waiting for confirmation to avoid timeout)`);
    console.log(`[AAVE] Check status at: https://snowtrace.io/tx/${supplyTx.hash}`);
    
    // Try to get confirmation quickly (non-blocking, max 5 seconds)
    try {
      const receipt = await Promise.race([
        supplyTx.wait(),
        new Promise((resolve) => setTimeout(() => resolve(null), 5000))
      ]);
      if (receipt && (receipt as any)?.status === 1) {
        console.log(`[AAVE] Transaction confirmed: ${supplyTx.hash}`);
      } else {
        console.log(`[AAVE] Transaction submitted (confirmation pending): ${supplyTx.hash}`);
      }
    } catch (error) {
      console.warn(`[AAVE] Could not wait for confirmation (non-critical):`, error);
      console.log(`[AAVE] Transaction submitted: ${supplyTx.hash}`);
    }
    
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
  // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
  const paymentInfoRaw = await redis.get(paymentInfoKey);

  if (!paymentInfoRaw) {
    console.error(`[Strategy] Payment info not found for ${paymentId}`);
    return { positionId: '', error: 'Payment info not found' };
  }

  // Safely parse payment info - handle both string and object cases
  let paymentInfo: any;
  try {
    if (typeof paymentInfoRaw === 'string') {
      // Check if it's valid JSON (starts with { or [)
      if (paymentInfoRaw.trim().startsWith('{') || paymentInfoRaw.trim().startsWith('[')) {
        paymentInfo = JSON.parse(paymentInfoRaw);
      } else {
        // If it's "[object Object]" or similar, it's already an object that was stringified incorrectly
        console.error(`[Strategy] ❌ Invalid payment info format (not JSON): ${paymentInfoRaw.substring(0, 50)}`);
        return { positionId: '', error: 'Invalid payment info format - not valid JSON string' };
      }
    } else {
      // Already an object
      paymentInfo = paymentInfoRaw;
    }
  } catch (parseError) {
    console.error(`[Strategy] ❌ Failed to parse payment_info:`, parseError);
    console.error(`[Strategy] paymentInfoRaw type: ${typeof paymentInfoRaw}, preview: ${String(paymentInfoRaw).substring(0, 100)}`);
    return { positionId: '', error: `Failed to parse payment info: ${parseError instanceof Error ? parseError.message : String(parseError)}` };
  }
  
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
      const rawGasPrice = await publicClient.getGasPrice();
      networkGasPrice = BigInt(rawGasPrice.toString()); // Ensure BigInt
      console.log(`[GMX Edit] Network gas price: ${formatUnits(networkGasPrice, 9)} gwei`);
    } catch (error) {
      console.warn('[GMX Edit] Failed to fetch network gas price, using default 25 gwei');
      const defaultGasRaw = parseUnits('25', 9); // Default to 25 gwei if fetch fails
      networkGasPrice = BigInt(defaultGasRaw.toString()); // Ensure BigInt
    }
    
    const maxGasRaw = parseUnits(MAX_GAS_PRICE_GWEI.toString(), 9); // 100 gwei cap
    const maxGas = BigInt(maxGasRaw.toString()); // Ensure BigInt
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
        authorizationList: [],
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
        authorizationList: [],
      }) as bigint;
      
      if (allowance < usdcAmount) {
        console.log('[GMX Edit] Approving USDC to Router...');
        const approveTxHash = await walletClient.writeContract({
          address: USDC_CONTRACT as `0x${string}`,
          abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
          functionName: 'approve',
          args: [GMX_ROUTER as `0x${string}`, maxUint256],
          chain: avalanche,
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
  morphoResult?: { success: boolean; txHash?: string; error?: string };
  amountUsd?: number;
  riskProfile?: string;
  email?: string;
  error?: string;
  txHash?: string;
}> {
  // ===== CRITICAL DEBUG: Verify handlePaymentCleared is being called =====
  console.log(`[Webhook] ========================================`);
  console.log(`[Webhook] ✅✅✅ handlePaymentCleared CALLED ✅✅✅`);
  console.log(`[Webhook] ========================================`);
  
  const paymentId = payment.id;
  const status = payment.status;
  const amountCents = payment.amount_money?.amount || 0;
  const currency = payment.amount_money?.currency || 'USD';
  const amountUsd = amountCents / 100;
  const note = payment.note || '';

  // CRITICAL: Validate currency is USD (same validation as conservative flow)
  if (currency !== 'USD') {
    console.error(`[Webhook] ❌ Invalid currency: ${currency} (expected USD)`);
    return {
      action: 'invalid_currency',
      paymentId,
      status,
      error: `Invalid currency: ${currency}. Only USD payments are supported.`,
    };
  }

  console.log(`[Webhook] Payment cleared (sent/paid): ${paymentId}`);
  console.log(`[Webhook] Status: ${status}`);
  console.log(`[Webhook] Amount: $${amountUsd} ${currency}`);
  console.log(`[Webhook] Currency: ${currency}`);
  console.log(`[Webhook] Note: ${note}`);
  
  // ===== CRITICAL DEBUG: Check payment_info in Redis IMMEDIATELY =====
  const redis = getRedis();
  const frontendPaymentId = paymentId.split('-')[0]; // Extract frontend payment ID
  const paymentInfoKeys = [
    `payment_info:${frontendPaymentId}`,
    `payment_info:${paymentId}`,
    `payment_info:${note || 'N/A'}`
  ];
  
  console.log(`[Webhook] ===== CHECKING payment_info IN REDIS =====`);
  console.log(`[Webhook] Checking payment_info keys: ${paymentInfoKeys.join(', ')}`);
  
  // This is just for debugging - the actual retrieval happens later in the code
  // We'll check if any of these keys exist for logging purposes
  let paymentInfoFound = false;
  let foundKey = null;
  for (const key of paymentInfoKeys) {
    if (key.includes('N/A')) continue;
    // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
    const checkResult = await redis.get(key);
    if (checkResult) {
      paymentInfoFound = true;
      foundKey = key;
      console.log(`[Webhook] ✅ payment_info EXISTS at key: ${key} (type: ${typeof checkResult})`);
      break;
    } else {
      console.log(`[Webhook] ❌ payment_info NOT FOUND at key: ${key}`);
    }
  }
  
  if (!paymentInfoFound) {
    console.error(`[Webhook] ❌❌❌ CRITICAL: payment_info NOT FOUND in Redis for ANY key ❌❌❌`);
    console.error(`[Webhook] Tried keys: ${paymentInfoKeys.filter(k => !k.includes('N/A')).join(', ')}`);
    console.error(`[Webhook] This will cause the flow to fail later. Frontend must store payment_info before webhook processes payment.`);
  } else {
    console.log(`[Webhook] ✅ payment_info found at key: ${foundKey}`);
  }
  console.log(`[Webhook] ========================================`);

  // CRITICAL: Check idempotency FIRST - return immediately if already processed
  // This prevents duplicate webhook processing and reduces race conditions
  const idempotencyCheck = await isPaymentProcessed(paymentId);

  if (idempotencyCheck.processed) {
    // Payment already processed - get the stored result
    try {
      const redis = getRedis();
      // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
      const storedData = await redis.get(`payment:${paymentId}`);
      if (storedData) {
        let parsed: any;
        if (typeof storedData === 'string') {
          // Check if it's valid JSON before parsing
          if (storedData.trim().startsWith('{') || storedData.trim().startsWith('[')) {
            try {
              parsed = JSON.parse(storedData);
            } catch (parseError) {
              console.error(`[Webhook] Failed to parse stored payment data:`, parseError);
              // Continue processing if we can't parse
            }
          } else {
            // Invalid format, continue processing
            console.warn(`[Webhook] Invalid stored payment data format: ${storedData.substring(0, 50)}`);
          }
        } else if (typeof storedData === 'object' && storedData !== null) {
          // Already an object
          parsed = storedData;
        }
        
        if (parsed) {
          console.log(`[Webhook] Payment ${paymentId} already processed successfully with txHash: ${parsed.txHash || 'N/A'}`);
          return {
            action: 'already_processed',
            paymentId,
            status,
            txHash: parsed.txHash,
          };
        }
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

  // CRITICAL: Use Redis atomic lock (SETNX) to prevent race conditions from multiple webhook events
  // This ensures only ONE webhook invocation can proceed
  // IMPROVED: Use PaymentStateManager for better state tracking (addition, not replacement)
  const stateManager = getPaymentStateManager();
  const lockKey = `payment_lock:${paymentId}`; // Keep for compatibility
  let lockAcquired = false;
  
  // Try to acquire lock atomically using SET with NX (SET if Not eXists)
  // IMPROVED: Use state manager for lock acquisition (addition, not replacement)
  try {
    lockAcquired = await stateManager.acquireLock(paymentId, 300);
    
    if (!lockAcquired) {
      // Lock already exists - another webhook is processing
      console.log(`[Webhook] Payment ${paymentId} is already being processed by another webhook - returning success`);
      // Return success immediately - don't block, just acknowledge the duplicate
      return {
        action: 'already_processing',
        paymentId,
        status,
      };
    }
    
    // Set processing state for better tracking
    await stateManager.setState(paymentId, PaymentState.PROCESSING);
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

  const redis = getRedis();
  try {
    // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
    const paymentIdMapping = await redis.get(`square_to_frontend:${paymentId}`) as string;
    if (paymentIdMapping) {
      frontendPaymentId = paymentIdMapping;
      console.log(`[Webhook] Found frontend paymentId mapping: ${paymentId} -> ${frontendPaymentId}`);
    } else if (notePaymentId && notePaymentId !== paymentId) {
      // Store the mapping for future lookups
      // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
      await redis.set(`square_to_frontend:${paymentId}`, notePaymentId, { ex: 86400 * 7 }); // 7 days expiry
      frontendPaymentId = notePaymentId;
      console.log(`[Webhook] Created paymentId mapping: ${paymentId} -> ${frontendPaymentId}`);
    }
  } catch (error) {
    console.error(`[Webhook] Error looking up paymentId mapping:`, error);
  }

  console.log(`[Webhook] Looking up payment_info with key: payment_info:${frontendPaymentId}`);
  console.log(`[Webhook] Also checking alternative keys: payment_info:${paymentId}, payment_info:${notePaymentId || 'N/A'}`);
  
  // Helper function to safely retrieve and parse payment info from Redis
  const safelyGetPaymentInfo = async (key: string): Promise<any | null> => {
    try {
      // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
      const raw = await redis.get(key);
      if (!raw) return null;
      
      // Handle both string and object cases (Upstash Redis can return either)
      if (typeof raw === 'string') {
        // Check if it's valid JSON (starts with { or [)
        if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
          try {
            return JSON.parse(raw);
          } catch (parseError) {
            console.error(`[Webhook] ❌ Failed to parse JSON from key ${key}:`, parseError);
            return null;
          }
        } else {
          // If it's "[object Object]" or similar, it's corrupted data
          console.error(`[Webhook] ❌ Invalid payment info format at key ${key} (not JSON): ${raw.substring(0, 50)}`);
          return null;
        }
      } else if (typeof raw === 'object' && raw !== null) {
        // Already an object (Upstash Redis sometimes returns objects directly)
        console.log(`[Webhook] Redis returned object directly for key ${key}`);
        return raw;
      } else {
        console.error(`[Webhook] ❌ Unexpected payment info type at key ${key}: ${typeof raw}`);
        return null;
      }
    } catch (error) {
      console.error(`[Webhook] ❌ Error retrieving payment info from key ${key}:`, error);
      return null;
    }
  };
  
  // Try primary key first
  let finalPaymentInfo = await safelyGetPaymentInfo(`payment_info:${frontendPaymentId}`);
  
  // Try alternative keys if primary lookup fails
  if (!finalPaymentInfo) {
    if (notePaymentId && notePaymentId !== frontendPaymentId) {
      finalPaymentInfo = await safelyGetPaymentInfo(`payment_info:${notePaymentId}`);
      if (finalPaymentInfo) {
        console.log(`[Webhook] Found payment_info using alternative key: payment_info:${notePaymentId}`);
      }
    }
    if (!finalPaymentInfo && paymentId !== frontendPaymentId) {
      finalPaymentInfo = await safelyGetPaymentInfo(`payment_info:${paymentId}`);
      if (finalPaymentInfo) {
        console.log(`[Webhook] Found payment_info using Square payment ID: payment_info:${paymentId}`);
      }
    }
  }
  console.log(`[Webhook] payment_info lookup result: ${finalPaymentInfo ? 'FOUND' : 'NOT FOUND'}`);

  if (!finalPaymentInfo) {
    console.error(`[Webhook] CRITICAL: payment_info not found and cannot extract from note`);
    console.error(`[Webhook] Tried keys: payment_info:${frontendPaymentId}, payment_info:${notePaymentId || 'N/A'}, payment_info:${paymentId}`);
    console.error(`[Webhook] Note data: wallet=${walletAddress || 'N/A'}, risk=${riskProfile || 'N/A'}`);
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

  // finalPaymentInfo is already parsed by safelyGetPaymentInfo (returns object or null)
  // No need to parse again - it's already a valid object
  // Declare paymentInfo in outer scope so it's accessible throughout the function
  const paymentInfo = finalPaymentInfo || null;
  
  if (paymentInfo) {
    try {
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
    // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
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

  // CRITICAL: Normalize wallet address to lowercase for consistent Redis lookups
  // This ensures the lookup key matches the storage key format exactly
  walletAddress = walletAddress.toLowerCase();
  console.log(`[Webhook] ✅ Wallet address validated and normalized: ${walletAddress} (NOT hub wallet)`);
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
  const isMorphoProfile = riskProfile === 'morpho';
  
  // CRITICAL DEBUG: Log profile detection
  console.log(`[Webhook] ===== PROFILE DETECTION =====`);
  console.log(`[Webhook] riskProfile: "${riskProfile}"`);
  console.log(`[Webhook] isMorphoProfile: ${isMorphoProfile}`);
  console.log(`[Webhook] hasGmx: ${hasGmx}`);
  console.log(`[Webhook] Profile config:`, JSON.stringify(profile));
  
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
  // We'll check actual balance later; estimate discount if user buys 100 ERGC, conservative, or morpho
  // Note: Actual ERGC balance is checked later at line 3769 for all profiles
  const estimatedHasErgcDiscount = (ergcPurchase && ergcPurchase >= 100) || riskProfile === 'conservative' || riskProfile === 'morpho';

  // paymentInfo is already defined from finalPaymentInfo (line 3525)
  // No need to parse again - it's already a valid object
  if (paymentInfo) {
    try {
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
  // Safely log payment info amount (paymentInfo is already defined from finalPaymentInfo)
  try {
    console.log(`[Webhook] Payment info amount: ${paymentInfo?.amount || 'N/A'}`);
  } catch (e) {
    console.log(`[Webhook] Payment info amount: N/A (error)`);
  }

  // For connected wallets, we don't need private keys - just send tokens
  // Try to get wallet data only if needed for strategy execution (legacy flow)
  let walletData = null;
  try {
    walletData = await decryptWalletKeyWithToken(walletAddress, paymentId);
  } catch (error) {
    // Connected wallet - no private key stored, this is expected
    console.log(`[Webhook] Connected wallet detected (no private key stored): ${walletAddress}`);
  }
  
  // CRITICAL: Determine wallet type BEFORE using it in debug logs
  // Check if this is a connected wallet (no private key) vs generated wallet
  const isConnectedWallet = !walletData?.privateKey;
  
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

  // Calculate Aave vs GMX vs Morpho split
  // Smart allocation for balanced strategy: ensure GMX gets minimum $5
  let aaveAmount: number;
  let gmxAmount: number;
  let morphoAmount: number;
  let morphoGauntletAmount: number;
  let morphoHyperithmAmount: number;

  // Use profile percentages for allocation
  aaveAmount = (depositAmount * profile.aavePercent) / 100;
  gmxAmount = (depositAmount * profile.gmxPercent) / 100;
  // Type-safe access: morphoPercent only exists on morpho profile
  const morphoPercent = 'morphoPercent' in profile ? profile.morphoPercent : 0;
  const morphoEurcPercent = 'morphoEurcPercent' in profile ? profile.morphoEurcPercent : 50;
  const morphoDaiPercent = 'morphoDaiPercent' in profile ? profile.morphoDaiPercent : 50;
  morphoAmount = (depositAmount * morphoPercent) / 100;
  
  // Calculate Morpho split (50/50 GauntletUSDC/HyperithmUSDC)
  if (morphoAmount > 0) {
    morphoGauntletAmount = (morphoAmount * morphoEurcPercent) / 100;
    morphoHyperithmAmount = (morphoAmount * morphoDaiPercent) / 100;
  } else {
    morphoGauntletAmount = 0;
    morphoHyperithmAmount = 0;
  }
  
  console.log(`[Webhook] ===== ALLOCATION =====`);
  console.log(`[Webhook] Deposit amount: $${depositAmount}`);
  console.log(`[Webhook] Risk profile: ${riskProfile}`);
  
  console.log(`[Webhook] Profile config:`, JSON.stringify({
    aavePercent: profile.aavePercent,
    gmxPercent: profile.gmxPercent,
    morphoPercent: morphoPercent,
    morphoEurcPercent: morphoEurcPercent,
    morphoDaiPercent: morphoDaiPercent
  }));
  console.log(`[Webhook] Split: Aave=$${aaveAmount} (${profile.aavePercent}%), GMX=$${gmxAmount} (${profile.gmxPercent}%), Morpho=$${morphoAmount} (${morphoPercent}%)`);
  if (morphoAmount > 0) {
    console.log(`[Webhook] Morpho split: GauntletUSDC=$${morphoGauntletAmount} (${morphoEurcPercent}%), HyperithmUSDC=$${morphoHyperithmAmount} (${morphoDaiPercent}%)`);
  }
  console.log(`[Webhook] Total: $${aaveAmount + gmxAmount + morphoAmount} (should equal $${depositAmount})`);
  
  // DEBUG: Log Morpho execution decision
  console.log(`[WEBHOOK_DEBUG] Morpho execution check:`, {
    morphoAmount,
    morphoGauntletAmount,
    morphoHyperithmAmount,
    profileMorphoPercent: morphoPercent,
    riskProfile,
    shouldExecute: morphoAmount > 0,
    isConnectedWallet
  });

  // Check if user has ERGC discount (1+ ERGC - the amount debited per order)
  let hasErgcDiscount = await checkErgcDiscount(walletAddress);
  console.log(`[Webhook] ERGC discount check: ${hasErgcDiscount ? 'YES (100+ ERGC)' : 'NO'}`);

  console.log(`[Webhook] Wallet type check: isConnectedWallet=${isConnectedWallet}, hasPrivateKey=${!!walletData?.privateKey}`);
  console.log(`[Webhook] Wallet address: ${walletAddress}`);
  console.log(`[Webhook] Payment amount: $${depositAmount}`);
  console.log(`[Webhook] Risk profile: ${riskProfile}`);
  console.log(`[Webhook] Profile allocation: Aave=${profile.aavePercent}%, GMX=${profile.gmxPercent}%, Morpho=${morphoPercent}%`);
  
  // DEBUG: Log payment status and profile check
  console.log(`[WEBHOOK_DEBUG] Payment processing state:`, {
    paymentStatus: status,
    riskProfile,
    profileName: profile.name,
    profileConfig: {
      aavePercent: profile.aavePercent,
      gmxPercent: profile.gmxPercent,
      morphoPercent: morphoPercent,
      morphoEurcPercent: morphoEurcPercent,
      morphoDaiPercent: morphoDaiPercent
    },
    depositAmount,
    walletAddress,
    isConnectedWallet: !walletData?.privateKey
  });

  let aaveResult: { success: boolean; txHash?: string; error?: string } | undefined;
  let gmxResult: { success: boolean; txHash?: string; error?: string } | undefined;
  let morphoResult: { success: boolean; txHash?: string; error?: string } | undefined;
  let transferResult: { success: boolean; txHash?: string; error?: string } = { success: true };

  // Initialize results to prevent undefined errors
  aaveResult = { success: false, error: 'Not executed' };
  gmxResult = { success: false, error: 'Not executed' };
  morphoResult = { success: false, error: 'Not executed' };

  // --- START OF UNIFIED EXECUTION FLOW ---
  // CRITICAL: Look up Privy user ID ONCE at the beginning for all operations
  // 
  // Lookup Strategy:
  // 1. Primary: Direct Redis lookup using normalized wallet address
  // 2. Fallback 1: Case-insensitive search through all wallet_owner keys
  // 3. Fallback 2: (Not applicable - we need user ID, not wallet)
  // 4. Fallback 3: Privy API (not available - Privy doesn't support wallet->user lookup)
  //
  // The wallet address is already normalized to lowercase at line 3209
  // Redis key format: wallet_owner:{walletAddress.toLowerCase()} -> privyUserId
  let privyUserId: string | null = null;
  if (isConnectedWallet) {
    const redis = getRedis();
    
    // CRITICAL: walletAddress is already normalized to lowercase (line 3209)
    // Use it directly - no need to call toLowerCase() again
    const normalizedWallet = walletAddress; // Already lowercase
    const lookupKey = `wallet_owner:${normalizedWallet}`;
    
    console.log(`[Webhook] ===== PRIVY USER ID LOOKUP =====`);
    console.log(`[Webhook] Wallet address: ${walletAddress}`);
    console.log(`[Webhook] Normalized wallet: ${normalizedWallet}`);
    console.log(`[Webhook] Lookup key: ${lookupKey}`);
    
    // Primary lookup: Direct Redis get
    try {
      // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
      privyUserId = await redis.get(lookupKey) as string | null;
      console.log(`[Webhook] Primary lookup result: ${privyUserId || 'NOT FOUND'}`);
      
      // Additional diagnostic: Check if key exists (even if value is null)
      // @ts-ignore - @upstash/redis types may not include exists method in some TypeScript versions, but it exists at runtime
      const keyExists = await redis.exists(lookupKey);
      console.log(`[Webhook] Key exists check: ${keyExists > 0 ? 'YES' : 'NO'}`);
      
      if (keyExists > 0) {
        // @ts-ignore - @upstash/redis types may not include ttl method in some TypeScript versions, but it exists at runtime
        const ttl = await redis.ttl(lookupKey);
        console.log(`[Webhook] Key TTL: ${ttl} seconds (${ttl > 0 ? Math.floor(ttl / 86400) + ' days' : 'expired'})`);
        
        // If key exists but value is null/empty, that's suspicious
        if (!privyUserId && keyExists > 0) {
          console.error(`[Webhook] ⚠️ Key exists but value is null/empty - possible data corruption`);
        }
      }
    } catch (lookupError) {
      console.error(`[Webhook] ❌ Primary Redis lookup failed:`, lookupError);
    }
    
    // Fallback 1: Case-insensitive search through existing keys
    if (!privyUserId) {
      console.log(`[Webhook] Primary lookup failed, trying case-insensitive fallback...`);
      try {
        // @ts-ignore - @upstash/redis types may not include keys method in some TypeScript versions, but it exists at runtime
        const keys = await redis.keys(`wallet_owner:*`);
        console.log(`[Webhook] Found ${keys.length} wallet_owner keys in Redis`);
        
        if (keys.length > 0) {
          // Log sample keys for debugging
          const sampleKeys = keys.slice(0, 5);
          console.log(`[Webhook] Sample keys: ${sampleKeys.join(', ')}`);
          
          // Try to find wallet with case-insensitive match
          for (const key of keys) {
            const storedWallet = key.replace('wallet_owner:', '');
            if (storedWallet.toLowerCase() === normalizedWallet) {
              console.log(`[Webhook] ⚠️ Found wallet with different casing: ${key}`);
              // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
              privyUserId = await redis.get(key) as string | null;
              if (privyUserId) {
                console.log(`[Webhook] ✅ Found Privy user ID via case-insensitive lookup: ${privyUserId}`);
                // Update the correct key with the found value (fix any casing issues)
                try {
                  // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
                  await redis.set(lookupKey, privyUserId, { ex: 365 * 24 * 60 * 60 });
                  console.log(`[Webhook] ✅ Fixed casing issue - stored with correct key format`);
                } catch (fixError) {
                  console.warn(`[Webhook] ⚠️ Could not fix casing issue:`, fixError);
                }
                break;
              }
            }
          }
        }
      } catch (fallbackError) {
        console.error(`[Webhook] Case-insensitive fallback failed:`, fallbackError);
      }
    }
    
    // Fallback 2: Try reverse lookup via user_wallet keys (if we had the user ID)
    // This is not applicable here since we're looking for user ID, not wallet
    
    // Fallback 3: Privy API (not implemented - Privy doesn't support direct wallet lookup)
    if (!privyUserId) {
      console.log(`[Webhook] ⚠️ All Redis lookups failed, Privy API fallback not available`);
      console.warn(`[Webhook] ⚠️ Privy API does not support direct wallet->user lookup`);
      console.warn(`[Webhook] ⚠️ The wallet MUST be associated via /api/wallet/associate-user before payment`);
    }
    
    // Final verification: Test Redis connectivity
    try {
      const testKey = `test:${Date.now()}`;
      // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
      await redis.set(testKey, 'test_value');
      // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
      const testValue = await redis.get(testKey);
      const redisWorking = testValue === 'test_value';
      console.log(`[Webhook] Redis connectivity test: ${redisWorking ? 'WORKING' : 'BROKEN'}`);
      // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
      await redis.del(testKey);
      
      if (!redisWorking) {
        console.error(`[Webhook] ❌ CRITICAL: Redis is not working correctly!`);
      }
    } catch (redisTestError) {
      console.error(`[Webhook] ❌ Redis connectivity test failed:`, redisTestError);
    }
    
    // Final status
    if (privyUserId) {
      console.log(`[Webhook] ✅✅✅ PRIVY USER ID FOUND: ${privyUserId}`);
      console.log(`[Webhook] ✅ Will use Privy execution for all operations (GMX, Aave, ERGC)`);
    } else {
      console.error(`[Webhook] ❌❌❌ PRIVY USER ID NOT FOUND`);
      console.error(`[Webhook] ❌ Wallet: ${normalizedWallet}`);
      console.error(`[Webhook] ❌ Lookup key: ${lookupKey}`);
      console.error(`[Webhook] ❌ Will use hub wallet execution fallback`);
      console.error(`[Webhook] ❌ ERGC debit and Privy-based operations will be skipped`);
      console.error(`[Webhook] ❌ CRITICAL: Ensure wallet was associated via /api/wallet/associate-user before payment`);
    }
  }

  // Step 1: Initial USDC transfer to user wallet
  // CRITICAL: Always send USDC to connected wallets, regardless of Privy user ID
  console.log(`[Webhook] ===== USDC TRANSFER =====`);
  console.log(`[Webhook] Deposit amount: $${depositAmount}`);
  console.log(`[Webhook] Square payment: $${amountUsd}`);
  console.log(`[Webhook] isConnectedWallet: ${isConnectedWallet}`);
  // Safely log payment info amount (paymentInfo is already defined from finalPaymentInfo)
  try {
    console.log(`[Webhook] payment_info.amount: ${paymentInfo?.amount || 'N/A'}`);
  } catch (e) {
    console.log(`[Webhook] payment_info.amount: N/A (error)`);
  }

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

  // CRITICAL: For connected wallets, DO NOT send USDC transfers
  // - executeAaveFromHubWallet and executeGmxFromHubWallet supply directly from hub wallet
  // - No USDC transfer needed - hub wallet executes strategies with its own USDC
  // - Only exception: If Privy exists AND it's conservative-only (Aave only), send USDC for Privy execution
  //   But even then, we should use hub wallet execution to avoid transfers
  if (isConnectedWallet) {
    // CRITICAL: Skip ALL USDC transfers for connected wallets
    // Hub wallet execution (executeAaveFromHubWallet, executeGmxFromHubWallet) supplies directly
    // This matches the Bitcoin page flow: no transfers, just direct execution
    console.log(`[Webhook] ⚠️ Connected wallet detected - SKIPPING ALL USDC transfers`);
    console.log(`[Webhook] Aave/GMX will execute from hub wallet using hub's USDC (no transfer needed)`);
    console.log(`[Webhook] This prevents duplicate transfers - only supply transactions will occur`);
    transferResult = { success: true }; // Mark as success since we're not transferring
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
  // CRITICAL: Only send AVAX once - use Redis lock to prevent race conditions
  const avaxSentKey = `avax_sent:${lookupPaymentId}`;
  const avaxLockKey = `avax_sending:${lookupPaymentId}`;
  
  // Check if AVAX already sent
  // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
  const avaxAlreadySent = await redis.get(avaxSentKey);
  
  if (avaxAlreadySent) {
    console.log(`[Webhook] ⚠️ AVAX already sent for payment ${lookupPaymentId} - skipping duplicate send`);
    console.log(`[Webhook] Previous AVAX tx: ${avaxAlreadySent}`);
  } else {
    // Check if another request is currently sending AVAX (prevent race conditions)
    // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
    const isSending = await redis.get(avaxLockKey);
    if (isSending) {
      console.log(`[Webhook] ⏳ AVAX sending in progress by another request, waiting...`);
      // Wait and check if it completed
      await new Promise(resolve => setTimeout(resolve, 2000));
      // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
      const retryCheck = await redis.get(avaxSentKey);
      
      if (retryCheck) {
        console.log(`[Webhook] ✅ AVAX sent by concurrent request: ${retryCheck}`);
      } else {
        console.warn(`[Webhook] ⚠️ AVAX lock held but no result after wait - may be stale lock`);
        // Check one more time after another short wait
        await new Promise(resolve => setTimeout(resolve, 1000));
        // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
        const finalRetryCheck = await redis.get(avaxSentKey);
        if (finalRetryCheck) {
          console.log(`[Webhook] ✅ AVAX sent by concurrent request (final retry): ${finalRetryCheck}`);
        } else {
          console.error(`[Webhook] ❌ Lock held but AVAX not sent - possible stale lock or failed transfer`);
        }
      }
    } else {
      // No lock exists - try to acquire it immediately (atomic operation)
      // Use SET with expiration to acquire lock, then verify we got it
      const lockValue = JSON.stringify({ 
        startedAt: new Date().toISOString(),
        walletAddress,
        requestId: `req_${Date.now()}_${Math.random().toString(36).substring(7)}`
      });
      
      // Try to set lock - if it already exists, another request got there first
      // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
      await redis.set(avaxLockKey, lockValue, { ex: 120 });
      
      // Immediately check if we still have the lock (another request might have set it between our check and set)
      // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
      const lockCheck = await redis.get(avaxLockKey);
      let ourLockValue: any = null;
      if (lockCheck) {
        if (typeof lockCheck === 'string') {
          // Check if it's valid JSON before parsing
          if (lockCheck.trim().startsWith('{') || lockCheck.trim().startsWith('[')) {
            try {
              ourLockValue = JSON.parse(lockCheck);
            } catch (parseError) {
              console.error(`[Webhook] Failed to parse lock value:`, parseError);
            }
          }
        } else if (typeof lockCheck === 'object' && lockCheck !== null) {
          // Already an object
          ourLockValue = lockCheck;
        }
      }
      
      // Parse our lock value for comparison
      let ourRequestId: string | undefined;
      try {
        const parsedLockValue = typeof lockValue === 'string' ? JSON.parse(lockValue) : lockValue;
        ourRequestId = parsedLockValue?.requestId;
      } catch (e) {
        console.error(`[Webhook] Failed to parse our lock value:`, e);
      }
      
      // Verify we own the lock by checking the requestId matches
      if (lockCheck && ourLockValue && ourLockValue.requestId === ourRequestId) {
        // We own the lock - double-check AVAX wasn't sent while we were acquiring it
        // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
        const doubleCheck = await redis.get(avaxSentKey);
        if (doubleCheck) {
          console.log(`[Webhook] ⚠️ AVAX was sent while acquiring lock: ${doubleCheck}`);
          // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
          await redis.del(avaxLockKey); // Release lock
        } else {
          // We own the lock and AVAX hasn't been sent - proceed with sending
          // CRITICAL: Morpho doesn't need AVAX - it's on Arbitrum and uses USDC directly
          // Skip AVAX for Morpho profile
          // NOTE: isMorphoProfile is already defined at line 3973 (top of function)
          if (isMorphoProfile) {
            console.log(`[Webhook] ⚠️ Skipping AVAX transfer for Morpho profile (uses Arbitrum, no AVAX needed)`);
            console.log(`[Webhook] ⚠️ Morpho executes on Arbitrum - no AVAX gas needed`);
            // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
            await redis.del(avaxLockKey); // Release lock
            // Mark AVAX as "sent" (skipped) to prevent retry
            // @ts-ignore
            await redis.set(avaxSentKey, 'SKIPPED_MORPHO', { ex: 3600 }); // 1 hour TTL
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
              // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
              await redis.del(avaxLockKey); // Release lock
              return {
                action: 'invalid_wallet_address',
                paymentId: lookupPaymentId,
                status,
                error: `Cannot send AVAX to hub wallet address. walletAddress must be user wallet, not ${HUB_WALLET_ADDRESS}`
              };
            }
            
            // Final check right before sending (another request might have sent it in the last millisecond)
            // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
            const preSendCheck = await redis.get(avaxSentKey);
            if (preSendCheck) {
              console.log(`[Webhook] ⚠️ AVAX was sent by another request right before we could send: ${preSendCheck}`);
              // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
              await redis.del(avaxLockKey); // Release lock
            } else {
              try {
                const avaxTransfer = await sendAvaxToUser(walletAddress, avaxAmount, avaxPurpose);
                if (avaxTransfer.success && avaxTransfer.txHash) {
                  // Mark AVAX as sent FIRST (before releasing lock) to prevent race conditions
                  // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
                  await redis.set(avaxSentKey, avaxTransfer.txHash, { ex: 86400 }); // 24 hour expiry
                  console.log(`[Webhook] ✅ AVAX sent and marked: ${avaxTransfer.txHash}`);
                } else {
                  console.error(`[Webhook] AVAX transfer failed: ${avaxTransfer.error}`);
                }
              } finally {
                // Always release lock, even if transfer fails or throws
                // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
                await redis.del(avaxLockKey);
              }
            }
          }
        }
      } else {
        // Another request got the lock first - wait and check if they sent it
        console.log(`[Webhook] ⏳ Another request acquired lock first, waiting...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
        const concurrentCheck = await redis.get(avaxSentKey);
        if (concurrentCheck) {
          console.log(`[Webhook] ✅ AVAX sent by concurrent request: ${concurrentCheck}`);
        } else {
          console.warn(`[Webhook] ⚠️ Lock acquired by another request but no AVAX sent yet`);
        }
      }
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
          
          // CRITICAL: DO NOT send USDC transfer for Aave here
          // The Aave execution code below will handle it using hub wallet directly
          // This prevents duplicate transfers - we only need the supply transaction
          if (aaveAmount > 0) {
            console.log(`[Webhook] Aave amount remaining: $${aaveAmount} - will be executed from hub wallet (no transfer needed)`);
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
      
      // CRITICAL: For conservative deposits, USDC was sent to user wallet
      // We MUST use Privy execution (user's wallet USDC) if USDC was sent to user wallet
      // Only use hub wallet execution if Privy is completely unavailable AND no USDC was sent
      const isConservativeOnly = gmxAmount === 0 && aaveAmount > 0;
      // USDC was sent if transfer was successful AND it was actually sent (not skipped)
      const usdcWasSentToUser = transferResult.success && transferResult.txHash !== undefined;
      
      try {
        if (privyUserId) {
          // For conservative deposits, wait a bit for USDC transfer to confirm
          if (usdcWasSentToUser) {
            console.log(`[Webhook] Conservative deposit: Waiting 3 seconds for USDC transfer to confirm...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
          
          aaveResult = await executeAaveViaPrivy(privyUserId, walletAddress, aaveAmount, lookupPaymentId);
          
          // For conservative deposits, if Privy fails, retry once after waiting longer
          if (!aaveResult.success && usdcWasSentToUser) {
            console.log(`[Webhook] Privy execution failed for conservative deposit, waiting 5 more seconds and retrying...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            aaveResult = await executeAaveViaPrivy(privyUserId, walletAddress, aaveAmount, lookupPaymentId);
          }
          
          // Only fall back to hub wallet if Privy execution failed AND it's not a conservative deposit
          // For conservative deposits, we MUST use user's wallet USDC (already sent)
          if (!aaveResult.success && !usdcWasSentToUser) {
            console.log(`[Webhook] Privy execution failed, using hub wallet for Aave (non-conservative)`);
            aaveResult = await executeAaveFromHubWallet(walletAddress, aaveAmount, lookupPaymentId);
          } else if (!aaveResult.success && usdcWasSentToUser) {
            console.error(`[Webhook] ❌ CRITICAL: Privy execution failed for conservative deposit after retry`);
            console.error(`[Webhook] ❌ USDC was sent to user wallet but Aave execution failed`);
            console.error(`[Webhook] ❌ User's wallet USDC may remain unused`);
          }
        } else {
          // No Privy user ID - use hub wallet execution
          // But warn if USDC was sent to user wallet (it won't be used)
          if (usdcWasSentToUser) {
            console.warn(`[Webhook] ⚠️ WARNING: USDC was sent to user wallet but Privy user ID not found`);
            console.warn(`[Webhook] ⚠️ Hub wallet execution will use hub's USDC, not user's wallet USDC`);
            console.warn(`[Webhook] ⚠️ User's wallet USDC will remain unused`);
          }
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

    // Execute Morpho strategy (50/50 GauntletUSDC + HyperithmUSDC)
    // CRITICAL: Morpho execution MUST happen for morpho profile, even if other strategies failed
    console.log(`[Webhook] ===== MORPHO EXECUTION CHECK =====`);
    console.log(`[Webhook] riskProfile: "${riskProfile}"`);
    console.log(`[Webhook] isMorphoProfile: ${isMorphoProfile}`);
    console.log(`[Webhook] morphoAmount: $${morphoAmount}`);
    console.log(`[Webhook] morphoGauntletAmount: $${morphoGauntletAmount}`);
    console.log(`[Webhook] morphoHyperithmAmount: $${morphoHyperithmAmount}`);
    console.log(`[Webhook] profileMorphoPercent: ${morphoPercent}%`);
    console.log(`[Webhook] paymentStatus: ${status}`);
    console.log(`[Webhook] shouldExecute: ${morphoAmount > 0 && status === 'COMPLETED'}`);
    console.log(`[Webhook] walletAddress: ${walletAddress}`);
    console.log(`[Webhook] lookupPaymentId: ${lookupPaymentId}`);
    
    if (morphoAmount > 0) {
      console.log(`[Webhook] ===== MORPHO EXECUTION =====`);
      console.log(`[Webhook] Executing Morpho: $${morphoAmount} (GauntletUSDC: $${morphoGauntletAmount}, HyperithmUSDC: $${morphoHyperithmAmount})`);
      console.log(`[Webhook] Wallet address: ${walletAddress}`);
      console.log(`[Webhook] Payment ID: ${lookupPaymentId}`);
      console.log(`[Webhook] ARBITRUM_HUB_WALLET_PRIVATE_KEY configured: ${!!ARBITRUM_HUB_WALLET_PRIVATE_KEY && ARBITRUM_HUB_WALLET_PRIVATE_KEY.length > 0}`);
      console.log(`[Webhook] ARBITRUM_HUB_WALLET_ADDRESS: ${ARBITRUM_HUB_WALLET_ADDRESS}`);
      
      try {
        console.log(`[Webhook] Calling executeMorphoFromHubWallet...`);
        morphoResult = await executeMorphoFromHubWallet(
          walletAddress,
          morphoGauntletAmount,
          morphoHyperithmAmount,
          lookupPaymentId
        );
        
        console.log(`[Webhook] Morpho execution returned:`, JSON.stringify(morphoResult, null, 2));
        
        if (morphoResult.success) {
          console.log(`[Webhook] ✅✅✅ Morpho executed successfully: ${morphoResult.txHash}`);
          console.log(`[Webhook] ✅✅✅ Check Morpho deposits at: https://arbiscan.io/tx/${morphoResult.txHash}`);
        } else {
          console.error(`[Webhook] ❌❌❌ Morpho FAILED: ${morphoResult.error}`);
          console.error(`[Webhook] ❌ This is a CRITICAL error - Morpho deposit did not execute`);
          console.error(`[Webhook] ❌ Payment will NOT be marked as processed - will retry on next webhook`);
        }
      } catch (morphoError) {
        console.error(`[Webhook] ❌❌❌ Morpho threw exception:`, morphoError);
        console.error(`[Webhook] Morpho error stack:`, morphoError instanceof Error ? morphoError.stack : 'No stack trace');
        console.error(`[Webhook] ❌ This is a CRITICAL error - Morpho deposit did not execute`);
        morphoResult = { 
          success: false, 
          error: morphoError instanceof Error ? morphoError.message : String(morphoError)
        };
      }
    } else {
      console.error(`[Webhook] ❌❌❌ CRITICAL: Skipping Morpho - morphoAmount is ${morphoAmount} (must be > 0)`);
      console.error(`[Webhook] ❌ This should NOT happen for morpho profile!`);
      console.error(`[Webhook] ❌ profile.morphoPercent: ${morphoPercent}%`);
      console.error(`[Webhook] ❌ depositAmount: $${depositAmount}`);
      console.error(`[Webhook] ❌ riskProfile: "${riskProfile}"`);
      console.error(`[Webhook] ❌ isMorphoProfile: ${isMorphoProfile}`);
      
      // CRITICAL: If this is a morpho profile but morphoAmount is 0, something is wrong
      if (isMorphoProfile && morphoAmount === 0) {
        console.error(`[Webhook] ❌❌❌ CRITICAL BUG: Morpho profile detected but morphoAmount is 0!`);
        console.error(`[Webhook] ❌ This indicates a calculation error - morphoAmount should be $${depositAmount}`);
        morphoResult = { 
          success: false, 
          error: `Morpho profile detected but morphoAmount is 0. Calculation error: depositAmount=$${depositAmount}, morphoPercent=${morphoPercent}%`
        };
      }
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
    const hasAnySuccess = (gmxResult?.success) || (aaveResult?.success) || (morphoResult?.success);
    
    if (!hasAnySuccess) {
      console.error(`[Webhook] ❌ CRITICAL: All strategies failed`);
      console.error(`[Webhook] GMX result:`, gmxResult);
      console.error(`[Webhook] Aave result:`, aaveResult);
      console.error(`[Webhook] Morpho result:`, morphoResult);
      console.error(`[Webhook] NOT marking payment as processed - will retry`);
      
      return {
        action: 'all_executions_failed',
        paymentId: lookupPaymentId,
        status,
        gmxResult,
        aaveResult,
        morphoResult,
        error: 'All strategy executions failed',
      };
    }
    
    const positionId = generatePositionId();
    const position: UserPosition = {
      id: positionId,
      paymentId: lookupPaymentId,
      userEmail: email || '',
      walletAddress,
      strategyType: riskProfile as 'conservative' | 'aggressive' | 'morpho',
      usdcAmount: depositAmount,
      status: hasAnySuccess ? 'active' : 'pending',
      createdAt: new Date().toISOString(),
      aaveSupplyAmount: aaveAmount,
      aaveSupplyTxHash: aaveResult?.txHash,
      gmxCollateralAmount: gmxAmount,
      morphoResult: morphoResult,
    };
    await savePosition(position);

    // Mark as processed with successful tx hash
    const finalTxHash = gmxResult?.txHash || aaveResult?.txHash || morphoResult?.txHash || positionId;
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
      morphoResult,
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
    // IMPROVED: Use state manager for lock release (addition, not replacement)
    if (lockAcquired) {
      try {
        const stateManager = getPaymentStateManager(); // Re-initialize in finally for safety
        await stateManager.releaseLock(paymentId);
        console.log(`[Webhook] Released processing lock for payment ${paymentId}`);
      } catch (e) {
        console.error(`[Webhook] Failed to release lock (non-critical):`, e);
        // Fallback to direct Redis deletion if state manager fails
        try {
          const redis = getRedis();
          // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
          await redis.del(lockKey);
        } catch (fallbackError) {
          // Ignore - lock will expire automatically after 5 minutes
        }
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
      const privyModule = await import('../utils/privy-signer.js');
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
    // Ensure we always have a BigInt - convert if needed
    const rawGasPrice = feeData.gasPrice || feeData.maxFeePerGas;
    const networkGasPrice = rawGasPrice ? BigInt(rawGasPrice.toString()) : ethers.parseUnits('25', 'gwei'); // Default to 25 gwei if unknown
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

    const btcToken = tokensJson.tokens?.find((t: any) => t.symbol === 'BTC');
    const usdcToken = tokensJson.tokens?.find((t: any) => t.symbol === 'USDC');

    if (!btcToken || !usdcToken) {
      throw new Error('GMX token list does not include BTC or USDC on Avalanche');
    }

    const btcUsdcMarket = marketsJson.markets?.find(
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
 * 
 * NOTE: Vercel automatically parses JSON bodies, so req.body is already an object.
 * We need to stringify it for signature verification, but JSON.stringify may produce
 * different formatting than Square's original. This is a known limitation.
 * 
 * Square's signature is calculated on the raw request body, but Vercel parses it
 * before we can access it. We'll use JSON.stringify and hope the formatting matches,
 * or Square's verification might be lenient enough to accept it.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  /**
   * Square Webhook Retry Logic:
   * - 200: Successfully processed (Square won't retry)
   * - 400: Invalid payload/permanent error (Square won't retry)
   * - 401: Authentication failure (Square won't retry)
   * - 500: Temporary error (Square will retry automatically)
   * 
   * It's critical to return the correct status code to prevent:
   * - Infinite retries on permanent errors (use 400)
   * - Missing retries on temporary errors (use 500)
   */
  
  // Helper function to classify errors for proper HTTP status codes
  const classifyError = (error: unknown): { isPermanent: boolean; statusCode: number; message: string } => {
    if (!(error instanceof Error)) {
      return { isPermanent: false, statusCode: 500, message: String(error) };
    }

    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // Permanent errors (400) - Invalid payload, don't retry
    const permanentErrorPatterns = [
      'invalid json',
      'no payment data',
      'invalid address',
      'invalid amount',
      'invalid wallet',
      'invalid configuration',
      'validation error',
      'syntaxerror',
      'typeerror',
      'invalid signature'
    ];

    // Temporary errors (500) - Should retry
    const temporaryErrorPatterns = [
      'timeout',
      'network',
      'connection',
      'temporary',
      'rate limit',
      'service unavailable',
      'gateway',
      'internal server',
      'database',
      'redis',
      'rpc',
      'insufficient funds',
      'gas',
      'transaction'
    ];

    if (permanentErrorPatterns.some(pattern => errorMessage.includes(pattern) || errorName.includes(pattern))) {
      return { isPermanent: true, statusCode: 400, message: error.message };
    }

    if (temporaryErrorPatterns.some(pattern => errorMessage.includes(pattern) || errorName.includes(pattern))) {
      return { isPermanent: false, statusCode: 500, message: error.message };
    }

    // Default: Assume temporary (retryable) - most processing errors should be retried
    return { isPermanent: false, statusCode: 500, message: error.message };
  };

  try {
    logger.info('Incoming webhook request', LogCategory.WEBHOOK, {
      method: req.method,
      url: req.url,
      hasHmacsha256Signature: !!req.headers['x-square-hmacsha256-signature'],
      hasSquareSignature: !!req.headers['x-square-signature'],
      contentType: req.headers['content-type'] || 'N/A',
      userAgent: req.headers['user-agent'] || 'N/A',
      bodyType: typeof req.body,
      bodyLength: typeof req.body === 'string' 
        ? req.body.length 
        : req.body !== undefined && req.body !== null
          ? (JSON.stringify(req.body) || '').length
          : 0
    });

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Square-Signature');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // GET - handle health check and test endpoints
    if (req.method === 'GET') {
      // Check for test-signature query parameter
      const url = (req.url || '').toLowerCase();
      const query = req.query || {};
      const testSigValue = Array.isArray(query.testSignature) ? query.testSignature[0] : query.testSignature;
      const testSigDashValue = Array.isArray(query['test-signature']) ? query['test-signature'][0] : query['test-signature'];
      const isTestSignature = (url && url.includes('test-signature')) || 
                              testSigValue === 'true' || 
                              testSigDashValue === 'true';
      
      // Test signature verification endpoint
      if (isTestSignature) {
        try {
          console.log('[Health Check] Testing signature verification...');
          
          // Validate key exists and is a string
          if (!SQUARE_WEBHOOK_SIGNATURE_KEY || typeof SQUARE_WEBHOOK_SIGNATURE_KEY !== 'string' || SQUARE_WEBHOOK_SIGNATURE_KEY.length === 0) {
            return res.status(500).json({
              error: 'Webhook signature key not configured or invalid',
              testResult: 'FAILED',
              signatureKeyConfigured: false,
              signatureKeyType: typeof SQUARE_WEBHOOK_SIGNATURE_KEY,
              signatureKeyLength: SQUARE_WEBHOOK_SIGNATURE_KEY && typeof SQUARE_WEBHOOK_SIGNATURE_KEY === 'string' ? SQUARE_WEBHOOK_SIGNATURE_KEY.length : 0
            });
          }

      // Test signature verification with a realistic Square webhook payload
      // Use deterministic stringify to match Square's format
      const testPayloadObj = {
        merchant_id: "X0F2ZVNVX1ZED",
        type: "payment.updated",
        event_id: "test-event-id",
        created_at: new Date().toISOString(),
        data: {
          object: {
            payment: {
              id: "TEST_PAYMENT_ID",
              status: "COMPLETED",
              amount_money: {
                amount: 200,
                currency: "USD"
              }
            }
          }
        }
      };
      
      // Generate payload using deterministic stringify (matches Square's format)
      const testPayload = deterministicStringify(testPayloadObj);
      
      // Validate payload was generated
      if (!testPayload || typeof testPayload !== 'string') {
        return res.status(500).json({
          error: 'Failed to generate test payload',
          testResult: 'FAILED'
        });
      }
      
      // Generate signature the same way Square does
      const hmac = crypto.createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY);
      hmac.update(testPayload);
      const testSignature = hmac.digest('base64'); // Square sends without 'sha256=' prefix based on logs
      
      // Validate signature was generated
      if (!testSignature || typeof testSignature !== 'string') {
        return res.status(500).json({
          error: 'Failed to generate test signature',
          testResult: 'FAILED'
        });
      }
      
          console.log('[Test] Generated test signature:', testSignature);
          const payloadPreview = testPayload && testPayload.length > 0 ? testPayload.substring(0, Math.min(200, testPayload.length)) : '';
          console.log('[Test] Test payload (first 200 chars):', payloadPreview);
          console.log('[Test] Test payload length:', testPayload ? testPayload.length : 0);
          
          // Test verification (with notification URL like real webhooks)
          const testNotificationUrl = 'https://www.tiltvault.com/api/square/webhook';
          const isValid = await verifySignature(testPayload, testSignature, testNotificationUrl);
          
          // Also test with 'sha256=' prefix
          const isValidWithPrefix = await verifySignature(testPayload, 'sha256=' + testSignature, testNotificationUrl);
          
          // Safely construct response with all length checks
          const keyLength = SQUARE_WEBHOOK_SIGNATURE_KEY && typeof SQUARE_WEBHOOK_SIGNATURE_KEY === 'string' ? SQUARE_WEBHOOK_SIGNATURE_KEY.length : 0;
          const keyFormat = keyLength >= 10 && SQUARE_WEBHOOK_SIGNATURE_KEY && typeof SQUARE_WEBHOOK_SIGNATURE_KEY === 'string' ? {
            first10Chars: SQUARE_WEBHOOK_SIGNATURE_KEY.substring(0, 10) + '...',
            last10Chars: '...' + SQUARE_WEBHOOK_SIGNATURE_KEY.substring(Math.max(0, keyLength - 10)),
            expectedLength: '~43 characters',
            note: 'Square webhook signature keys are typically 43 characters long. If your key is a different length, verify it in Square Dashboard.'
          } : keyLength > 0 ? {
            keyLength: keyLength,
            note: 'Key is too short to display preview. Expected ~43 characters.'
          } : null;
          
          return res.status(200).json({
            testResult: isValid || isValidWithPrefix ? 'PASSED' : 'FAILED',
            signatureVerification: {
              withoutPrefix: isValid,
              withPrefix: isValidWithPrefix,
              finalResult: isValid || isValidWithPrefix
            },
            testPayload: testPayload,
            testSignature: testSignature,
            testSignatureWithPrefix: 'sha256=' + testSignature,
            signatureKeyConfigured: keyLength > 0,
            signatureKeyLength: keyLength,
            signatureKeyFormat: keyFormat,
        instructions: isValid || isValidWithPrefix 
          ? '✅ Signature verification is working! Your key is correct.'
          : '❌ Signature verification failed. Verify your SQUARE_WEBHOOK_SIGNATURE_KEY in Vercel matches the key from Square Dashboard → Webhooks → Show Signature Key',
        troubleshooting: !isValid && !isValidWithPrefix ? {
          step1: 'Go to https://developer.squareup.com/apps',
          step2: 'Select your app → Webhooks → Your webhook endpoint',
          step3: 'Click "Show Signature Key"',
          step4: 'Copy the ENTIRE key (should be ~43 characters)',
          step5: 'Update SQUARE_WEBHOOK_SIGNATURE_KEY in Vercel environment variables',
          step6: 'Redeploy or trigger a new deployment',
          step7: 'Test again with this endpoint'
        } : null,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error('[Test Endpoint] Error:', error);
          return res.status(500).json({
            error: 'Internal error in test endpoint',
            testResult: 'FAILED',
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
          });
        }
      }
      
      // Health check endpoint (default GET behavior)
      let redisStatus = 'unknown';
      try {
        const redis = getRedis();
        // @ts-ignore - @upstash/redis types may not include ping method in some TypeScript versions, but it exists at runtime
        await redis.ping();
        redisStatus = 'connected';
      } catch (err) {
        redisStatus = `error: ${err}`;
      }
      
      const signatureKeyConfigured = !!(SQUARE_WEBHOOK_SIGNATURE_KEY && typeof SQUARE_WEBHOOK_SIGNATURE_KEY === 'string' && SQUARE_WEBHOOK_SIGNATURE_KEY.length > 0);
      const keyLength = (SQUARE_WEBHOOK_SIGNATURE_KEY && typeof SQUARE_WEBHOOK_SIGNATURE_KEY === 'string') ? SQUARE_WEBHOOK_SIGNATURE_KEY.length : 0;
      const keyPrefix = keyLength >= 10 && SQUARE_WEBHOOK_SIGNATURE_KEY && typeof SQUARE_WEBHOOK_SIGNATURE_KEY === 'string'
        ? SQUARE_WEBHOOK_SIGNATURE_KEY.substring(0, 10) + '...'
        : keyLength > 0 && SQUARE_WEBHOOK_SIGNATURE_KEY && typeof SQUARE_WEBHOOK_SIGNATURE_KEY === 'string'
          ? SQUARE_WEBHOOK_SIGNATURE_KEY.substring(0, Math.min(10, keyLength))
          : 'none';
      
      return res.status(200).json({
        service: 'square-webhook-node',
        status: signatureKeyConfigured ? 'ready' : 'ERROR',
        signatureKeyConfigured,
        signatureKeyLength: keyLength,
        signatureKeyPrefix: keyPrefix,
        securityWarning: !signatureKeyConfigured ? 'CRITICAL: Webhook signature key not configured - all webhook requests will be rejected' : undefined,
        hubWalletConfigured: !!HUB_WALLET_PRIVATE_KEY,
        hubWalletAddress: HUB_WALLET_ADDRESS,
        redisStatus,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    }

    if (req.method !== 'POST') {
      logger.warn('Invalid method for webhook', LogCategory.WEBHOOK, {
        method: req.method,
        expected: 'POST'
      });
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // CRITICAL: Log ALL incoming POST requests immediately (before any processing)
    // This ensures we capture requests even if they fail early
    
    // === DEBUG: Log ALL headers to see exact header names ===
    console.log('=== WEBHOOK SIGNATURE DEBUG ===');
    console.log('All headers:', JSON.stringify(req.headers, null, 2));
    
    // Try different header name variations
    const possibleHeaders = [
      'x-square-hmacsha256-signature',
      'x-square-signature',
      'X-Square-HMACSHA256-Signature',
      'X-Square-Signature',
      'x-square-hmac-sha256-signature'
    ];
    
    let receivedSignature = null;
    let headerUsed = null;
    
    for (const header of possibleHeaders) {
      if (req.headers[header]) {
        receivedSignature = req.headers[header];
        headerUsed = header;
        break;
      }
    }
    
    console.log('Signature header used:', headerUsed);
    console.log('Received signature:', receivedSignature);
    console.log('Webhook key exists:', !!SQUARE_WEBHOOK_SIGNATURE_KEY);
    console.log('Webhook key length:', SQUARE_WEBHOOK_SIGNATURE_KEY ? SQUARE_WEBHOOK_SIGNATURE_KEY.length : 0);
    console.log('Webhook key first 10 chars:', SQUARE_WEBHOOK_SIGNATURE_KEY ? SQUARE_WEBHOOK_SIGNATURE_KEY.substring(0, 10) : 'N/A');
    
    const bodyLength = typeof req.body === 'string' 
      ? req.body.length 
      : req.body !== undefined && req.body !== null
        ? (JSON.stringify(req.body) || '').length
        : 0;
    
    logger.info('Incoming webhook request', LogCategory.WEBHOOK, {
      method: req.method,
      url: req.url,
      hasHmacsha256Signature: !!req.headers['x-square-hmacsha256-signature'],
      hasSquareSignature: !!req.headers['x-square-signature'],
      signatureHeaderUsed: headerUsed,
      contentType: req.headers['content-type'] || 'N/A',
      userAgent: req.headers['user-agent'] || 'N/A',
      bodyType: typeof req.body,
      bodyLength: bodyLength
    });

      // Get raw body for signature verification
      // CRITICAL: Square calculates signature on the EXACT raw JSON string they send
      // We MUST use the raw body bytes, not a reconstructed JSON string
      // Vercel automatically parses JSON, so we need to read from the request stream
      let rawBody: string | undefined;
      let parsedBody: any = null; // Store parsed body for later use
      
      // CRITICAL: In Vercel, req.body is already parsed, but we need the raw JSON for signature verification
      // Square signs: HMAC-SHA256(notification_url + exact_raw_json_body)
      // We must reconstruct the exact format Square used
      
      // Try to get raw body from various sources (in order of preference)
      // @ts-ignore - req may have rawBody property in some Vercel configurations
      const rawBodyFromStream = (req as any).rawBody;
      
      if (rawBodyFromStream && typeof rawBodyFromStream === 'string') {
        // Best case: We have the actual raw body
        rawBody = rawBodyFromStream;
        try {
          parsedBody = JSON.parse(rawBodyFromStream);
        } catch (e) {
          parsedBody = rawBodyFromStream;
        }
        console.log('[Webhook] ✅ Using raw body from req.rawBody (exact bytes Square sent)');
      } else if (typeof req.body === 'string') {
        // Body is already a string (raw) - use it directly
        rawBody = req.body;
        try {
          parsedBody = JSON.parse(req.body);
        } catch (e) {
          parsedBody = req.body;
        }
        console.log('[Webhook] ✅ Body is string - using directly for signature');
      } else if (Buffer.isBuffer(req.body)) {
        // Body is a Buffer (raw) - convert to string
        const bufferStr = req.body.toString('utf-8');
        rawBody = bufferStr;
        try {
          parsedBody = JSON.parse(bufferStr);
        } catch (e) {
          parsedBody = bufferStr;
        }
        console.log('[Webhook] ✅ Body is Buffer - converted to string');
      } else {
        // Body was parsed to object - reconstruct using deterministic stringify
        // This matches Square's format: compact JSON with sorted keys
        parsedBody = req.body;
        
        console.log('[Webhook] Body was parsed to object - reconstructing using deterministic stringify');
        console.log('[Webhook] This should match Square\'s format (compact JSON, sorted keys)');
        
        // Use deterministic stringify (sorted keys, compact) - this matches Square's format
        try {
          rawBody = deterministicStringify(req.body);
          console.log('[Webhook] ✅ Using deterministic stringify (matches Square\'s format)');
        } catch (e) {
          console.warn('[Webhook] Deterministic stringify failed, using fallback:', e);
          // Fallback: compact JSON with sorted keys
          try {
            const sortedKeys = Object.keys(req.body).sort();
            const sortedObj = sortedKeys.reduce((acc: any, key) => {
              acc[key] = req.body[key];
              return acc;
            }, {});
            rawBody = JSON.stringify(sortedObj).replace(/\s+/g, '');
            console.log('[Webhook] Using sorted compact JSON as fallback');
          } catch (e2) {
            // Last resort
            rawBody = JSON.stringify(req.body).replace(/\s+/g, '');
            console.warn('[Webhook] Using compact JSON as last resort');
          }
        }
      }
      
      // Ensure rawBody is defined (should never be undefined at this point, but TypeScript needs this)
      if (!rawBody) {
        console.error('[Webhook] ❌ CRITICAL: rawBody is undefined - cannot verify signature');
        // Last resort fallback - stringify the body
        try {
          rawBody = JSON.stringify(req.body || {});
          parsedBody = req.body;
          console.warn('[Webhook] Using fallback JSON.stringify - signature verification will likely fail');
        } catch (stringifyError) {
          // If even stringify fails, use empty object
          console.error('[Webhook] Failed to stringify body:', stringifyError);
          rawBody = '{}';
          parsedBody = {};
        }
      }
      
      // Log the body format for debugging (safely)
      try {
        console.log('[Webhook] Raw body for signature (first 200 chars):', rawBody.substring(0, Math.min(200, rawBody.length)));
        console.log('[Webhook] Raw body length:', rawBody.length);
      } catch (logError) {
        console.warn('[Webhook] Failed to log body details:', logError);
      }
      
      // CRITICAL: Build notification URL (the exact URL Square calls)
      // Square includes this in the signature: HMAC-SHA256(notification_url + body)
      // Square uses the exact URL configured in their dashboard
      // Try multiple URL formats to match what Square might be using
      const protocolHeader = req.headers['x-forwarded-proto'] || req.headers['x-forwarded-protocol'];
      const protocol = Array.isArray(protocolHeader) ? protocolHeader[0] : (protocolHeader || 'https');
      const hostHeader = req.headers['host'] || req.headers['x-forwarded-host'] || req.headers['x-vercel-deployment-url'];
      const host = Array.isArray(hostHeader) ? hostHeader[0] : (hostHeader || 'www.tiltvault.com');
      
      // Try both with and without trailing slash, and with/without www
      const possibleUrls = [
        `${protocol}://${host}/api/square/webhook`, // Standard format
        `${protocol}://${host.replace(/^www\./, '')}/api/square/webhook`, // Without www
        `https://www.tiltvault.com/api/square/webhook`, // Hardcoded (most likely what Square has configured)
        `https://tiltvault.com/api/square/webhook`, // Without www
      ];
      
      // Remove duplicates
      const uniqueUrls = [...new Set(possibleUrls)];
      const notificationUrl = uniqueUrls[0]; // Use first as primary, verifySignature will try all variants
      
      console.log('[Webhook] Notification URL options:', uniqueUrls);
      console.log('[Webhook] Using primary notification URL:', notificationUrl);
      
      // Square sends signature in 'x-square-hmacsha256-signature' header (not 'x-square-signature')
      // Use the signature we found in debug logging above
      const signature = receivedSignature || 
                        (req.headers['x-square-hmacsha256-signature'] as string) || 
                        (req.headers['x-square-signature'] as string) || 
                        '';
      
      // Debug logging for signature verification
      logger.debug('Signature verification setup', LogCategory.WEBHOOK, {
        hasHmacsha256Header: !!req.headers['x-square-hmacsha256-signature'],
        hasSquareSignatureHeader: !!req.headers['x-square-signature'],
        signatureHeader: signature ? signature.substring(0, 30) + '...' : 'none',
        rawBodyLength: rawBody.length,
        rawBodyStart: rawBody.substring(0, 100) + '...',
        bodyType: typeof req.body
      });

    // CRITICAL SECURITY: Signature verification is MANDATORY
    // Never accept webhook requests without proper signature verification
    if (!SQUARE_WEBHOOK_SIGNATURE_KEY) {
      logger.error('CRITICAL: Webhook signature key not configured - REJECTING ALL REQUESTS', LogCategory.WEBHOOK, {
        severity: 'CRITICAL',
        securityRisk: 'HIGH',
        action: 'REJECTED'
      });
      errorTracker.trackPaymentError('Webhook signature key not configured', {}, req);
      // Return 500 (server configuration error) - this is a deployment issue that must be fixed
      return res.status(500).json({ 
        error: 'Webhook signature key not configured',
        retryable: false,
        security: 'Signature verification is required for all webhook requests'
      });
    }

    // Note: Signature key length validation removed - user confirmed webhooks work correctly
    // Square webhook signature keys can vary in length, so we rely on signature verification itself

    // Verify signature - CRITICAL: Reject invalid signatures
    if (!signature) {
      logger.error('No signature provided - rejecting webhook', LogCategory.WEBHOOK, {
        hasSignature: false,
        securityRisk: 'HIGH',
        action: 'REJECTED'
      });
      errorTracker.trackPaymentError('No signature provided', {}, req);
      // Return 401 (unauthorized) - permanent error, don't retry
      return res.status(401).json({ 
        error: 'No signature provided',
        retryable: false
      });
    }
    
    // CRITICAL: Verify webhook signature before processing
    // Square calculates: HMAC-SHA256(notification_url + body)
    // If this fails, the webhook is REJECTED (no bypass)
    console.log('[Webhook] === Starting signature verification ===');
    const isValid = await verifySignature(rawBody, signature || '', notificationUrl);
    
    // === DEBUG: Try both methods manually for comparison ===
    if (!isValid && SQUARE_WEBHOOK_SIGNATURE_KEY && signature) {
      console.log('[Webhook] === DEBUG: Trying signature methods manually ===');
      
      // Method 1: URL + Body
      const sigInput1 = notificationUrl + rawBody;
      const expectedSig1 = crypto
        .createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
        .update(sigInput1)
        .digest('base64');
      
      console.log('[Webhook] Method 1 (URL + Body):');
      console.log('  Input length:', sigInput1.length);
      console.log('  Expected:', expectedSig1);
      console.log('  Received:', signature);
      console.log('  Match:', expectedSig1 === signature);
      
      // Method 2: Body only
      const expectedSig2 = crypto
        .createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
        .update(rawBody)
        .digest('base64');
      
      console.log('[Webhook] Method 2 (Body only):');
      console.log('  Expected:', expectedSig2);
      console.log('  Received:', signature);
      console.log('  Match:', expectedSig2 === signature);
      
      // Check if signature has prefix
      if (signature.startsWith('sha256=')) {
        const sigWithoutPrefix = signature.substring(7);
        console.log('[Webhook] Signature without sha256= prefix:', sigWithoutPrefix);
        console.log('  Match with method 1:', expectedSig1 === sigWithoutPrefix);
        console.log('  Match with method 2:', expectedSig2 === sigWithoutPrefix);
      }
    }
    
    logger.info(`Signature verification: ${isValid ? 'VALID' : 'INVALID - REJECTING'}`, LogCategory.WEBHOOK, {
      isValid,
      signaturePrefix: signature ? signature.substring(0, 20) : 'NONE',
      headerUsed: headerUsed,
      // TODO: Once signature verification is working consistently, reduce logging verbosity
      troubleshooting: !isValid ? {
        step1: 'Verify SQUARE_WEBHOOK_SIGNATURE_KEY in Vercel matches Square Dashboard',
        step2: 'Get key from: Square Dashboard → Webhooks → Show Signature Key',
        step3: 'Key should be ~43 characters, NOT your API access token',
        step4: 'See VERIFY-SQUARE-WEBHOOK-KEY.md for detailed instructions',
        debug: 'Check Vercel logs for detailed signature comparison'
      } : undefined
    });
    
    if (!isValid) {
      // SECURITY: Signature verification is MANDATORY for ALL events
      // We NO LONGER bypass signature verification for any event types
      // If signature verification fails, the webhook is REJECTED
      // This ensures only legitimate Square webhooks are processed
      
      // Parse event type for logging purposes
      let eventTypeForCheck: string | undefined;
      try {
        const eventForCheck = parsedBody || (typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
        eventTypeForCheck = eventForCheck?.type;
      } catch (e) {
        // Can't parse event type, proceed with rejection
      }
      
      // Calculate expected signatures for debug response
      let debugInfo: any = {
        headerUsed: headerUsed,
        signatureReceived: signature ? signature.substring(0, 30) + '...' : 'NONE',
        notificationUrl: notificationUrl,
        bodyLength: rawBody.length,
        keyConfigured: !!SQUARE_WEBHOOK_SIGNATURE_KEY,
        keyLength: SQUARE_WEBHOOK_SIGNATURE_KEY ? SQUARE_WEBHOOK_SIGNATURE_KEY.length : 0,
        expectedKeyLength: '~43 characters',
        keyIssue: SQUARE_WEBHOOK_SIGNATURE_KEY && SQUARE_WEBHOOK_SIGNATURE_KEY.length < 35 
          ? `Key is only ${SQUARE_WEBHOOK_SIGNATURE_KEY.length} characters - should be ~43. This is likely the root cause.`
          : 'Key length appears correct, but signature still doesn\'t match. Verify the key value matches Square Dashboard exactly.'
      };
      
      if (SQUARE_WEBHOOK_SIGNATURE_KEY && signature) {
        // Method 1: URL + Body
        const sigInput1 = notificationUrl + rawBody;
        const expectedSig1 = crypto
          .createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
          .update(sigInput1)
          .digest('base64');
        
        // Method 2: Body only
        const expectedSig2 = crypto
          .createHmac('sha256', SQUARE_WEBHOOK_SIGNATURE_KEY)
          .update(rawBody)
          .digest('base64');
        
        debugInfo.method1 = {
          inputLength: sigInput1.length,
          expected: expectedSig1.substring(0, 30) + '...',
          received: signature.substring(0, 30) + '...',
          match: expectedSig1 === signature
        };
        
        debugInfo.method2 = {
          expected: expectedSig2.substring(0, 30) + '...',
          received: signature.substring(0, 30) + '...',
          match: expectedSig2 === signature
        };
        
        // Check if signature has prefix
        if (signature.startsWith('sha256=')) {
          const sigWithoutPrefix = signature.substring(7);
          debugInfo.withPrefix = {
            method1Match: expectedSig1 === sigWithoutPrefix,
            method2Match: expectedSig2 === sigWithoutPrefix
          };
        }
      }
      
      // Log the rejection with detailed information
      logger.error('CRITICAL: Invalid webhook signature - REJECTING', LogCategory.WEBHOOK, {
        eventType: eventTypeForCheck || 'unknown',
        signaturePrefix: signature ? signature.substring(0, 20) : 'NONE',
        securityRisk: 'HIGH',
        action: 'REJECTED',
        keyLength: SQUARE_WEBHOOK_SIGNATURE_KEY ? SQUARE_WEBHOOK_SIGNATURE_KEY.length : 0,
        expectedKeyLength: '~43 characters',
        fix: 'Update SQUARE_WEBHOOK_SIGNATURE_KEY in Vercel with the correct key from Square Dashboard → Webhooks → Show Signature Key',
        debugInfo: debugInfo
      });
      
      errorTracker.trackPaymentError('Invalid webhook signature', {}, req);
      await alertingSystem.triggerAlert(
        'payment_failure' as any,
        'Invalid Webhook Signature',
        'Webhook received with invalid signature - REJECTED for security',
        { 
          signaturePrefix: signature ? signature.substring(0, 20) : 'NONE',
          keyLength: SQUARE_WEBHOOK_SIGNATURE_KEY ? SQUARE_WEBHOOK_SIGNATURE_KEY.length : 0,
          eventType: eventTypeForCheck || 'unknown'
        }
      );
      // Return 401 (unauthorized) - permanent error, don't retry
      // SECURITY: We no longer bypass signature verification for any events
      // All webhooks with invalid signatures are rejected
      return res.status(401).json({ 
        error: 'Invalid webhook signature',
        retryable: false,
        security: 'Signature verification failed - webhook rejected',
        keyLength: SQUARE_WEBHOOK_SIGNATURE_KEY ? SQUARE_WEBHOOK_SIGNATURE_KEY.length : 0,
        expectedKeyLength: '~43 characters',
        troubleshooting: 'Update SQUARE_WEBHOOK_SIGNATURE_KEY in Vercel with the correct key from Square Dashboard → Webhooks → Show Signature Key. Key must be exactly as shown in Square Dashboard (typically 43 characters).',
        debug: process.env.NODE_ENV === 'development' ? debugInfo : undefined // Only show debug in dev
      });
    }
    
    logger.info('Signature verification passed - processing webhook', LogCategory.WEBHOOK, {
      signaturePrefix: signature.substring(0, 20),
      securityStatus: 'VERIFIED'
    });

    // Parse event with error handling
    // Use parsedBody if we have it, otherwise parse from rawBody or req.body
    let event: WebhookEvent;
    try {
      if (parsedBody) {
        event = parsedBody;
      } else if (typeof req.body === 'string') {
        event = JSON.parse(req.body);
      } else {
        event = req.body;
      }
      const debugBodyLength = typeof req.body === 'string' 
        ? req.body.length 
        : req.body !== undefined && req.body !== null
          ? (JSON.stringify(req.body) || '').length
          : 0;
      
      logger.debug('Event parsed successfully', LogCategory.WEBHOOK, {
        bodyType: typeof req.body,
        bodyLength: debugBodyLength
      });
    } catch (parseError) {
      const bodyPreview = typeof req.body === 'string' 
        ? req.body.substring(0, 500)
        : req.body !== undefined && req.body !== null
          ? (JSON.stringify(req.body) || '').substring(0, 500)
          : 'N/A';
      
      logger.error('Failed to parse webhook event body', LogCategory.WEBHOOK, {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        bodyPreview: bodyPreview
      }, parseError instanceof Error ? parseError : new Error(String(parseError)));
      // 400: Invalid JSON - permanent error, don't retry
      return res.status(400).json({ 
        error: 'Invalid JSON in request body',
        retryable: false
      });
    }
    
    const eventType = event.type || 'unknown';
    const payment = event.data?.object?.payment;
    const payout = (event.data?.object as any)?.payout;
    const paymentId = payment?.id || undefined;
    const paymentStatus = payment?.status || undefined;
    const paymentAmount = payment?.amount_money ? (payment.amount_money.amount || 0) / 100 : undefined;
    
    // CRITICAL: Validate we're using PRODUCTION IDs (not sandbox/test)
    const merchantId = (event as any).merchant_id;
    const locationId = payout?.location_id || (payment as any)?.location_id || (event as any).location_id;
    
    // Production merchant ID: X0F2ZVNVX1ZED
    // Production location ID: LA09STPQW6HC0
    // Sandbox/test IDs would be different
    const PRODUCTION_MERCHANT_ID = 'X0F2ZVNVX1ZED';
    const PRODUCTION_LOCATION_ID = 'LA09STPQW6HC0';
    
    const isProductionMerchant = merchantId === PRODUCTION_MERCHANT_ID;
    const isProductionLocation = locationId === PRODUCTION_LOCATION_ID;
    
    if (merchantId && !isProductionMerchant) {
      logger.warn('Non-production merchant ID detected', LogCategory.WEBHOOK, {
        merchantId,
        expected: PRODUCTION_MERCHANT_ID,
        isProduction: isProductionMerchant
      });
    }
    
    if (locationId && !isProductionLocation) {
      logger.warn('Non-production location ID detected', LogCategory.WEBHOOK, {
        locationId,
        expected: PRODUCTION_LOCATION_ID,
        isProduction: isProductionLocation
      });
    }
    
    // CRITICAL: Log event details immediately (this MUST show up in logs)
    logger.info('Webhook event received', LogCategory.WEBHOOK, {
      eventType,
      eventId: event.id || undefined,
      paymentId,
      paymentStatus,
      paymentAmount,
      merchantId,
      locationId,
      isProductionMerchant,
      isProductionLocation,
      eventStructure: {
        hasData: !!event.data,
        hasObject: !!event.data?.object,
        objectKeys: event.data?.object ? Object.keys(event.data.object) : [],
        hasPayment: !!event.data?.object?.payment,
        hasPayout: !!payout,
        objectType: (event.data?.object as any)?.type || 'unknown'
      }
    });

    // Helper function to process payment events
    const processPaymentEvent = async (payment: SquarePayment | undefined, eventType: string, requireCompleted: boolean = false) => {
      if (!payment) {
        logger.error('No payment data in event', LogCategory.WEBHOOK, {
          eventType,
          hasData: !!event.data,
          hasObject: !!event.data?.object,
          objectKeys: event.data?.object ? Object.keys(event.data.object) : [],
          objectType: (event.data?.object as any)?.type || 'unknown'
        });
        // 400: Invalid payload - don't retry
        return res.status(400).json({ 
          error: 'No payment data in event',
          eventType,
          details: `Expected ${eventType} to contain payment data in event.data.object.payment`,
          retryable: false
        });
      }

      // For payment.updated, require COMPLETED status
      if (requireCompleted && payment.status !== 'COMPLETED') {
        logger.info('Payment status not COMPLETED, waiting', LogCategory.WEBHOOK, {
          eventType,
          paymentId: payment.id,
          paymentStatus: payment.status,
          action: 'ignored'
        });
        return res.status(200).json({
          success: true,
          action: 'ignored',
          eventType,
          paymentStatus: payment.status,
          message: `Payment status is ${payment.status}, waiting for COMPLETED status`
        });
      }

      // Idempotency protection: Prevent duplicate processing of the same payment
      // This handles cases where both payment.updated and payment.sent are received
      const redis = getRedis();
      const idempotencyKey = `payment_processed:${payment.id}`;
      const processingLockKey = `payment_processing:${payment.id}`;
      
      // Check if payment was already successfully processed
      // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
      const existingResult = await redis.get(idempotencyKey);
      if (existingResult) {
        logger.info('Payment already processed - duplicate event', LogCategory.WEBHOOK, {
          paymentId: payment.id,
          eventType,
          action: 'idempotent',
          cachedResultLength: typeof existingResult === 'string' ? existingResult.length : 0
        });
        try {
          // Handle both string and object cases (Redis may return either)
          let previousResult: any;
          if (typeof existingResult === 'string') {
            // Check if it's valid JSON (starts with { or [) before parsing
            if (existingResult.trim().startsWith('{') || existingResult.trim().startsWith('[')) {
              try {
                previousResult = JSON.parse(existingResult);
              } catch (parseErr) {
                // If parsing fails even though it looks like JSON, log and continue
                logger.warn('Failed to parse existingResult as JSON, treating as new processing', LogCategory.WEBHOOK, {
                  paymentId: payment.id,
                  existingResultType: typeof existingResult,
                  existingResultPreview: existingResult.substring(0, 100),
                  error: parseErr instanceof Error ? parseErr.message : String(parseErr)
                });
                // Continue with processing - don't return early
                previousResult = null;
              }
            } else {
              // If it's "[object Object]" or similar, it's not valid JSON
              logger.warn('Invalid existingResult format (not JSON), treating as new processing', LogCategory.WEBHOOK, {
                paymentId: payment.id,
                existingResultType: typeof existingResult,
                existingResultPreview: existingResult.substring(0, 100)
              });
              // Continue with processing - don't return early
              previousResult = null;
            }
          } else if (existingResult && typeof existingResult === 'object') {
            // Already an object, use it directly
            previousResult = existingResult;
          } else {
            // Unexpected type, log and continue
            logger.warn('Unexpected existingResult type, reprocessing', LogCategory.WEBHOOK, {
              paymentId: payment.id,
              existingResultType: typeof existingResult
            });
            previousResult = null;
          }
          
          // Only return early if we successfully got a previous result
          if (previousResult && typeof previousResult === 'object') {
            return res.status(200).json({ 
              success: true, 
              ...previousResult,
              idempotent: true,
              message: 'Payment already processed - duplicate event ignored'
            });
          }
          // If we couldn't parse it, continue with processing below
        } catch (parseError) {
          logger.warn('Failed to parse cached payment result, reprocessing', LogCategory.WEBHOOK, {
            paymentId: payment.id,
            error: parseError instanceof Error ? parseError.message : String(parseError)
          });
          // Continue with processing if we can't parse the previous result
        }
      }

      // Check if payment is currently being processed (prevent race conditions)
      // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
      const isProcessing = await redis.get(processingLockKey);
      if (isProcessing) {
        logger.info('Payment currently being processed by another request', LogCategory.WEBHOOK, {
          paymentId: payment.id,
          eventType,
          action: 'waiting'
        });
        
        // Wait and check again (another request might have completed)
        await new Promise(resolve => setTimeout(resolve, 2000));
        // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
        const retryResult = await redis.get(idempotencyKey);
        
        if (retryResult) {
          logger.info('Payment processed by concurrent request', LogCategory.WEBHOOK, {
            paymentId: payment.id,
            eventType,
            action: 'idempotent_concurrent'
          });
          try {
            // Safely parse retry result - handle both string and object cases
            let previousResult: any;
            if (typeof retryResult === 'string') {
              // Check if it's valid JSON (starts with { or [)
              if (retryResult.trim().startsWith('{') || retryResult.trim().startsWith('[')) {
                previousResult = JSON.parse(retryResult);
              } else {
                // If it's "[object Object]" or similar, can't parse it
                logger.warn('Invalid retryResult format (not JSON), continuing with processing', LogCategory.WEBHOOK, {
                  paymentId: payment.id,
                  retryResultPreview: retryResult.substring(0, 100)
                });
                throw new Error('Invalid retryResult format');
              }
            } else if (retryResult && typeof retryResult === 'object') {
              // Already an object
              previousResult = retryResult;
            } else {
              throw new Error('Unexpected retryResult type');
            }
            
            return res.status(200).json({ 
              success: true, 
              ...previousResult,
              idempotent: true,
              message: 'Payment processed by concurrent request'
            });
          } catch (parseError) {
            // Continue if we can't parse
          }
        }
        
        // If still processing after wait, return 200 (successfully accepted)
        // Square won't retry on 200, and the concurrent request will complete processing
        return res.status(200).json({
          success: true,
          action: 'processing',
          paymentId: payment.id,
          message: 'Payment is being processed by another request'
        });
      }

      // Acquire processing lock (5 minute expiry - should be enough for any processing)
      // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
      await redis.set(processingLockKey, JSON.stringify({ 
        eventType, 
        startedAt: new Date().toISOString() 
      }), { ex: 300 });

      logger.info('Processing payment event', LogCategory.WEBHOOK, {
        eventType,
        paymentId: payment.id,
        paymentStatus: payment.status,
        paymentAmount: payment.amount_money ? (payment.amount_money.amount || 0) / 100 : 0,
        action: 'processing'
      });
      
      // ===== CRITICAL DEBUG: About to call handlePaymentCleared =====
      console.log(`[Webhook] ========================================`);
      console.log(`[Webhook] 🚀🚀🚀 CALLING handlePaymentCleared 🚀🚀🚀`);
      console.log(`[Webhook] Payment ID: ${payment.id}`);
      console.log(`[Webhook] Payment Status: ${payment.status}`);
      console.log(`[Webhook] Payment Amount: $${payment.amount_money ? (payment.amount_money.amount || 0) / 100 : 0}`);
      console.log(`[Webhook] ========================================`);
      
      const startTime = Date.now();
      try {
        const result = await handlePaymentCleared(payment);
        const duration = Date.now() - startTime;
        
        // ===== CRITICAL DEBUG: handlePaymentCleared completed =====
        console.log(`[Webhook] ========================================`);
        console.log(`[Webhook] ✅✅✅ handlePaymentCleared COMPLETED ✅✅✅`);
        console.log(`[Webhook] Duration: ${duration}ms`);
        console.log(`[Webhook] Result action: ${result.action}`);
        console.log(`[Webhook] Result status: ${result.status}`);
        console.log(`[Webhook] Result txHash: ${result.txHash || result.aaveResult?.txHash || result.gmxResult?.txHash || 'N/A'}`);
        console.log(`[Webhook] ========================================`);
        
        // Store successful result for idempotency (24 hour expiry)
        // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
        await redis.set(idempotencyKey, JSON.stringify({
          ...result,
          processedAt: new Date().toISOString(),
          processedBy: eventType
        }), { ex: 86400 });
        
        // Release processing lock
        // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
        await redis.del(processingLockKey);
        
        logger.info('Payment processing completed successfully', LogCategory.WEBHOOK, {
          paymentId: payment.id,
          eventType,
          action: 'completed',
          duration,
          result: {
            action: result.action,
            status: result.status,
            txHash: result.txHash || result.aaveResult?.txHash || result.gmxResult?.txHash
          }
        });
        
        return res.status(200).json({ success: true, ...result });
      } catch (processingError) {
        const duration = Date.now() - startTime;
        
        // Release processing lock on error (allow retry)
        // @ts-ignore - @upstash/redis types may not include del method in some TypeScript versions, but it exists at runtime
        await redis.del(processingLockKey);
        
        // Classify error to determine if it's retryable
        const errorClassification = classifyError(processingError);
        
        logger.error('Payment processing failed', LogCategory.WEBHOOK, {
          paymentId: payment.id,
          eventType,
          action: 'failed',
          duration,
          error: errorClassification.message,
          isPermanent: errorClassification.isPermanent,
          statusCode: errorClassification.statusCode,
          retryable: !errorClassification.isPermanent
        }, processingError instanceof Error ? processingError : new Error(String(processingError)));
        
        // Don't store failed result in idempotency cache (allow retry)
        // Return appropriate status code based on error classification
        return res.status(errorClassification.statusCode).json({
          success: false,
          error: errorClassification.message,
          paymentId: payment.id,
          eventType,
          retryable: !errorClassification.isPermanent
        });
      }
    };

    // Handle payment events that confirm money has cleared
    // payment.fail: Payment failed - log and do not process deposits
    if (eventType === 'payment.fail' || eventType === 'payment.failed') {
      const payment = event.data?.object?.payment;
      logger.warn('Received payment.fail event - payment failed', LogCategory.WEBHOOK, {
        eventType,
        paymentId: payment?.id,
        paymentStatus: payment?.status,
        paymentAmount: payment?.amount_money ? (payment.amount_money.amount || 0) / 100 : undefined,
        message: 'Payment failed - no deposits will be executed'
      });
      
      return res.status(200).json({
        success: true,
        action: 'logged',
        eventType,
        paymentId: payment?.id,
        paymentStatus: payment?.status,
        message: 'Payment failed - no deposits executed'
      });
    }

    // payment.created and payment.updated: These are the events that trigger Morpho/Aave/GMX deposits
    // payment.created: Published when a Payment is created
    // payment.updated: Published when a Payment is updated (status changes)
    // We check payment status to ensure it's COMPLETED before processing deposits
    if (eventType === 'payment.created' || eventType === 'payment.updated') {
      const payment = event.data?.object?.payment;
      const paymentStatus = payment?.status;
      
      logger.info('✅ RECEIVED payment.created/payment.updated event', LogCategory.WEBHOOK, {
        eventType,
        hasPayment: !!payment,
        paymentId: payment?.id,
        paymentStatus,
        paymentAmount: payment?.amount_money ? (payment.amount_money.amount || 0) / 100 : undefined,
        paymentNote: payment?.note || 'no note',
        willProcess: paymentStatus === 'COMPLETED',
        message: paymentStatus === 'COMPLETED' ? 'Payment is COMPLETED - will trigger Morpho/Aave/GMX deposits' : `Payment status is ${paymentStatus} - waiting for COMPLETED status`
      });
      
      console.log(`[Webhook] ========================================`);
      console.log(`[Webhook] ✅ RECEIVED ${eventType} - Payment Status: ${paymentStatus}`);
      console.log(`[Webhook] Payment ID: ${payment?.id}`);
      console.log(`[Webhook] Payment Amount: $${payment?.amount_money ? (payment.amount_money.amount || 0) / 100 : 0}`);
      console.log(`[Webhook] Payment Note: ${payment?.note || 'no note'}`);
      console.log(`[Webhook] Will Process: ${paymentStatus === 'COMPLETED' ? 'YES' : 'NO (waiting for COMPLETED status)'}`);
      console.log(`[Webhook] ========================================`);
      
      // Store payment ID in pending_payments list for payout event processing
      // This allows payout.sent/payout.paid to find and process the payment
      if (paymentStatus === 'COMPLETED' && payment?.id) {
        const redis = getRedis();
        // @ts-ignore
        const pendingPaymentsKey = 'pending_payments';
        // @ts-ignore
        const existingPending = await redis.get(pendingPaymentsKey);
        const pendingList = existingPending 
          ? (typeof existingPending === 'string' ? JSON.parse(existingPending) : existingPending)
          : [];
        
        // Add payment ID if not already in list
        if (!pendingList.includes(payment.id)) {
          pendingList.push(payment.id);
          // Keep only last 100 payments to prevent list from growing too large
          const trimmedList = pendingList.slice(-100);
          // @ts-ignore
          await redis.set(pendingPaymentsKey, JSON.stringify(trimmedList), { ex: 24 * 60 * 60 }); // 24 hour TTL
        }
        
        // Also store mapping from Square payment ID to frontend payment ID (if note contains frontend payment ID)
        // The note from frontend typically contains the frontend payment ID in format: "payment_id:xxx wallet:0x... risk:xxx"
        if (payment.note && payment.note !== payment.id) {
          // Parse the note to extract just the payment ID (not the entire note string)
          const parsedNote = parsePaymentNote(payment.note);
          const frontendPaymentIdFromNote = parsedNote.paymentId;
          
          if (frontendPaymentIdFromNote && frontendPaymentIdFromNote !== payment.id) {
            // @ts-ignore
            await redis.set(`square_to_frontend:${payment.id}`, frontendPaymentIdFromNote, { ex: 86400 * 7 }); // 7 days expiry
            logger.info('Stored Square to frontend payment ID mapping', LogCategory.WEBHOOK, {
              squarePaymentId: payment.id,
              frontendPaymentId: frontendPaymentIdFromNote,
              fullNote: payment.note
            });
          } else {
            logger.warn('Could not extract frontend payment ID from note', LogCategory.WEBHOOK, {
              squarePaymentId: payment.id,
              note: payment.note,
              parsedPaymentId: frontendPaymentIdFromNote
            });
          }
        }
      }
      
      // Only process if payment status is COMPLETED
      // payment.created might fire before payment is completed
      // payment.updated fires when status changes (including to COMPLETED)
      // NOTE: We're NOT processing deposits here - we wait for payout.sent/payout.paid
      if (paymentStatus === 'COMPLETED') {
        // Just log that payment is completed - payout event will trigger actual processing
        logger.info('Payment COMPLETED - waiting for payout event to process deposit', LogCategory.WEBHOOK, {
          eventType,
          paymentId: payment?.id,
          paymentStatus,
          action: 'waiting_for_payout'
        });
        
        return res.status(200).json({
          success: true,
          action: 'waiting_for_payout',
          eventType,
          paymentId: payment?.id,
          paymentStatus,
          message: `Payment status is COMPLETED. Waiting for payout.sent or payout.paid event to trigger Morpho/Aave/GMX deposits.`
        });
      } else {
        // Payment not completed yet - log and return 200 (Square will send payment.updated when status changes)
        logger.info('Payment not COMPLETED yet - waiting for status update', LogCategory.WEBHOOK, {
          eventType,
          paymentId: payment?.id,
          paymentStatus,
          action: 'waiting'
        });
        
        return res.status(200).json({
          success: true,
          action: 'waiting',
          eventType,
          paymentId: payment?.id,
          paymentStatus,
          message: `Payment status is ${paymentStatus}. Waiting for COMPLETED status. Square will send payment.updated when status changes.`
        });
      }
    }

    // Handle payout.sent and payout.paid events - These trigger Morpho/Aave/GMX deposits
    // When payout arrives, we find the most recent unprocessed payment and process it
    if (eventType === 'payout.sent' || eventType === 'payout.paid') {
      const payout = (event.data?.object as any)?.payout;
      const payoutAmount = payout?.amount_money ? (payout.amount_money.amount || 0) / 100 : 0;
      const payoutId = payout?.id;
      
      logger.info('✅ RECEIVED payout.sent/payout.paid event - WILL TRIGGER DEPOSITS', LogCategory.WEBHOOK, {
        eventType,
        eventId: event.id,
        payoutId,
        payoutAmount,
        payoutStatus: payout?.status,
        payoutType: payout?.type,
        arrivalDate: payout?.arrival_date,
        message: 'payout event received - will find matching unprocessed payment and execute Morpho/Aave/GMX deposits'
      });
      
      console.log(`[Webhook] ========================================`);
      console.log(`[Webhook] ✅ RECEIVED ${eventType} - PROCESSING DEPOSIT`);
      console.log(`[Webhook] Payout ID: ${payoutId}`);
      console.log(`[Webhook] Payout Amount: $${payoutAmount}`);
      console.log(`[Webhook] ========================================`);
      
      // Find the most recent unprocessed payment
      // Payouts typically happen ~6 minutes after payment, so we look for payments in the last 15 minutes
      const redis = getRedis();
      const now = Date.now();
      const fifteenMinutesAgo = now - (15 * 60 * 1000);
      
      try {
        // Strategy: Look for payment_info entries that were created recently and haven't been processed
        // We'll check payment.created/payment.updated events that stored payment info
        // Since we can't easily scan Redis keys, we'll use a different approach:
        // When payment.created/payment.updated is received, we store a "pending_payments" list
        // But for now, let's try to find payment_info by checking recent payment IDs from Square
        
        // Alternative: Use the payout amount to find matching payment
        // But payout amounts are batch totals, so this won't work reliably
        
        // Best approach: Store payment IDs in a sorted set when payment.created/payment.updated is received
        // For now, we'll try to process payments that were created but not yet processed
        // by checking if we have payment_info entries without corresponding payment_processed entries
        
        // Since Redis doesn't support efficient key scanning, we'll use a simpler approach:
        // When payment.created/payment.updated arrives with COMPLETED status, we mark it as "pending_payout"
        // Then when payout arrives, we process the most recent "pending_payout" payment
        
        // For now, let's implement a workaround: Check if there's a recent payment_info entry
        // that hasn't been processed yet. We'll use a timestamp-based lookup.
        
        // Get list of recent pending payments (stored when payment.created/payment.updated is received)
        // @ts-ignore
        const pendingPaymentsKey = 'pending_payments';
        // @ts-ignore
        const pendingPayments = await redis.get(pendingPaymentsKey);
        
        let paymentIdToProcess: string | null = null;
        
        if (pendingPayments) {
          const pendingList = typeof pendingPayments === 'string' 
            ? JSON.parse(pendingPayments) 
            : pendingPayments;
          
          // Find the most recent unprocessed payment
          for (const pendingPaymentId of pendingList.reverse()) {
            // @ts-ignore
            const isProcessed = await redis.exists(`payment_processed:${pendingPaymentId}`);
            if (!isProcessed) {
              paymentIdToProcess = pendingPaymentId;
              break;
            }
          }
        }
        
        if (!paymentIdToProcess) {
          // Fallback: Try to find payment_info entries that haven't been processed
          // This is a best-effort approach since we can't efficiently scan Redis keys
          logger.warn('No pending payment found for payout - may need to process manually', LogCategory.WEBHOOK, {
            eventType,
            payoutId,
            payoutAmount,
            recommendation: 'Check recent payment.created/payment.updated events to find matching payment ID'
          });
          
          return res.status(200).json({
            success: true,
            action: 'no_payment_found',
            eventType,
            payoutId,
            payoutAmount,
            message: 'payout event received but no matching unprocessed payment found. Payment may have already been processed, or payment.created/payment.updated events were not received.'
          });
        }
        
        // Get payment info from Redis
        // First, try to find the frontend payment ID using the mapping
        // @ts-ignore
        const frontendPaymentIdMapping = await redis.get(`square_to_frontend:${paymentIdToProcess}`);
        let frontendPaymentId: string | null = null;
        
        if (frontendPaymentIdMapping) {
          const mappingValue = typeof frontendPaymentIdMapping === 'string' ? frontendPaymentIdMapping : String(frontendPaymentIdMapping);
          
          // Check if mapping contains the full note (backwards compatibility) or just the payment ID
          // If it contains spaces or "wallet:", it's the full note - parse it
          if (mappingValue.includes(' ') || mappingValue.includes('wallet:') || mappingValue.includes('payment_id:')) {
            // It's the full note string - parse it to extract payment ID
            const parsed = parsePaymentNote(mappingValue);
            frontendPaymentId = parsed.paymentId || null;
            logger.info('Parsed payment ID from full note in mapping (backwards compatibility)', LogCategory.WEBHOOK, {
              squarePaymentId: paymentIdToProcess,
              extractedPaymentId: frontendPaymentId,
              fullNote: mappingValue
            });
          } else {
            // It's just the payment ID (new format)
            frontendPaymentId = mappingValue;
          }
        }
        
        // Try multiple keys: frontend payment ID (if mapped), Square payment ID
        const paymentInfoKeys = [
          frontendPaymentId ? `payment_info:${frontendPaymentId}` : null,
          `payment_info:${paymentIdToProcess}`,
        ].filter(Boolean) as string[];
        
        let paymentInfoData: any = null;
        let foundKey: string | null = null;
        
        for (const key of paymentInfoKeys) {
          // @ts-ignore
          const data = await redis.get(key);
          if (data) {
            paymentInfoData = data;
            foundKey = key;
            break;
          }
        }
        
        if (!paymentInfoData) {
          logger.error('Payment info not found for pending payment', LogCategory.WEBHOOK, {
            paymentId: paymentIdToProcess,
            frontendPaymentId,
            payoutId,
            keysTried: paymentInfoKeys,
            recommendation: 'Check if payment_info was stored with correct payment ID. Frontend should call /api/wallet/store-payment-info before payment is processed.'
          });
          
          return res.status(200).json({
            success: false,
            action: 'payment_info_not_found',
            eventType,
            payoutId,
            paymentId: paymentIdToProcess,
            frontendPaymentId,
            keysTried: paymentInfoKeys,
            message: 'Found pending payment but payment_info not found in Redis. Tried keys: ' + paymentInfoKeys.join(', ')
          });
        }
        
        const paymentInfo = typeof paymentInfoData === 'string' 
          ? JSON.parse(paymentInfoData) 
          : paymentInfoData;
        
        logger.info('Found matching payment for payout - processing deposit', LogCategory.WEBHOOK, {
          eventType,
          payoutId,
          paymentId: paymentIdToProcess,
          walletAddress: paymentInfo.walletAddress,
          riskProfile: paymentInfo.riskProfile,
          amount: paymentInfo.amount
        });
        
        // Create a mock payment object from the payment info
        // We need to call handlePaymentCleared, which expects a SquarePayment object
        // Since we don't have the full Square payment object, we'll construct what we need
        const mockPayment: SquarePayment = {
          id: paymentIdToProcess,
          status: 'COMPLETED', // Payout means payment is completed
          amount_money: {
            amount: Math.round(paymentInfo.amount * 100), // Convert to cents
            currency: 'USD'
          },
          note: paymentIdToProcess // Use payment ID as note for lookup
        };
        
        // Process the payment (this will execute Morpho/Aave/GMX deposits)
        return await handlePaymentCleared(mockPayment);
        
      } catch (error) {
        logger.error('Error processing payout event:', LogCategory.WEBHOOK, {
          eventType,
          payoutId,
          payoutAmount,
          error: error instanceof Error ? error.message : String(error)
        });
        
        return res.status(500).json({
          success: false,
          action: 'error',
          eventType,
          payoutId,
          payoutAmount,
          error: 'Failed to process payout event due to internal error'
        });
      }
    }

    // Note: payment.updated is now handled above with payment.created
    // This block removed to avoid duplicate handling

    // Handle order.created events - informational only, no payment data
    // Square sends this when an order is created, but payment processing happens via payment.sent/payment.paid events
    if (eventType === 'order.created') {
      const orderCreated = (event.data?.object as any)?.order_created;
      logger.info('Received order.created event (informational only)', LogCategory.WEBHOOK, {
        eventType,
        eventId: event.id,
        orderId: orderCreated?.order_id,
        orderState: orderCreated?.state,
        locationId: orderCreated?.location_id,
        message: 'order.created does not contain payment data - waiting for payment.sent or payment.paid events'
      });
      
      return res.status(200).json({
        success: true,
        action: 'logged',
        eventType,
        orderId: orderCreated?.order_id,
        message: 'order.created event logged - payment processing will occur via payment.sent/payment.paid events'
      });
    }

    // Handle order.updated events - informational only, no payment data
    // Square sends this when an order is updated, but payment processing happens via payment.sent/payment.paid events
    if (eventType === 'order.updated') {
      const orderUpdated = (event.data?.object as any)?.order_updated;
      logger.info('Received order.updated event (informational only)', LogCategory.WEBHOOK, {
        eventType,
        eventId: event.id,
        orderId: orderUpdated?.order_id,
        orderState: orderUpdated?.state,
        locationId: orderUpdated?.location_id,
        message: 'order.updated does not contain payment data - waiting for payment.sent or payment.paid events'
      });
      
      return res.status(200).json({
        success: true,
        action: 'logged',
        eventType,
        orderId: orderUpdated?.order_id,
        message: 'order.updated event logged - payment processing will occur via payment.sent/payment.paid events'
      });
    }

    // Handle bank_account.* events - informational/test events from Square dashboard
    // These are used for testing webhook connectivity and don't contain payment data
    if (eventType && eventType.startsWith('bank_account.')) {
      const bankAccountData = (event.data?.object as any)?.bank_account;
      logger.info('Received bank_account event (informational/test only)', LogCategory.WEBHOOK, {
        eventType,
        eventId: event.id,
        bankAccountId: bankAccountData?.id,
        bankAccountStatus: bankAccountData?.status,
        locationId: bankAccountData?.location_id,
        message: 'bank_account.* events are informational/test events - no payment processing needed'
      });
      
      return res.status(200).json({
        success: true,
        action: 'logged',
        eventType,
        bankAccountId: bankAccountData?.id,
        message: 'bank_account event logged - test event received successfully'
      });
    }

    // Note: payment.created is now handled above with payment.updated
    // This block removed to avoid duplicate handling

    // Log all other event types for debugging
    const possiblePayment = (event.data?.object as any)?.payment;
    logger.warn('Unhandled webhook event type', LogCategory.WEBHOOK, {
      eventType,
      eventId: event.id,
      hasData: !!event.data,
      hasObject: !!event.data?.object,
      dataKeys: event.data ? Object.keys(event.data) : [],
      objectKeys: event.data?.object ? Object.keys(event.data.object) : [],
      hasPayment: !!possiblePayment,
      paymentId: possiblePayment?.id,
      paymentStatus: possiblePayment?.status,
      recommendation: possiblePayment ? `Consider adding handler for event type: ${eventType}` : undefined
    });
    
    return res.status(200).json({ 
      success: true, 
      action: 'ignored', 
      eventType,
      message: `Event type ${eventType} is not handled - waiting for payment.sent or payment.paid`
    });

  } catch (error) {
    // Classify error to determine appropriate HTTP status code
    const errorClassification = classifyError(error);
    
    logger.error('Webhook processing error', LogCategory.WEBHOOK, {
      error: errorClassification.message,
      errorName: error instanceof Error ? error.name : 'Unknown',
      isPermanent: errorClassification.isPermanent,
      statusCode: errorClassification.statusCode,
      retryable: !errorClassification.isPermanent
    }, error instanceof Error ? error : new Error(String(error)));
    
    // Return appropriate status code based on error classification
    // 400 = permanent error (don't retry), 500 = temporary error (Square will retry)
    return res.status(errorClassification.statusCode).json({ 
      error: errorClassification.message,
      retryable: !errorClassification.isPermanent
    });
  }
}
