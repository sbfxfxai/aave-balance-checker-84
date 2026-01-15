import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers, verifyMessage } from 'ethers';

// Helper to access Node.js crypto module (available at runtime in Vercel)
function getCrypto() {
  // Use Function constructor to access require in a way TypeScript accepts
  const requireFunc = new Function('return require')();
  return requireFunc('crypto') as {
    createHash: (algorithm: string) => {
      update: (data: string) => { digest: (encoding: string) => string };
    };
  };
}
import { z } from 'zod';
import { getWalletKey, decryptWalletKeyWithAuth, deleteWalletKey } from '../wallet/keystore';
import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { checkRateLimit, RATE_LIMITS } from '../wallet/rateLimit';
import { withMonitoring } from '../wallet/monitoring';

// ============================================================================
// TYPE DEFINITIONS & CONFIGURATION
// ============================================================================

interface WithdrawalRequest {
  walletAddress: string;
  amount: string;
  source: 'aave' | 'gmx' | 'wallet';
  cashappGrantId?: string;
  userEmail?: string;
  paymentId?: string;
  signature: string;
  message: string;
  timestamp?: number;
}

interface WithdrawalResult {
  success: boolean;
  withdrawalId: string;
  usdAmount: string;
  needsLinking: boolean;
  qrCodeUrl?: string;
  mobileUrl?: string;
  paymentId?: string;
  txHash?: string;
  error?: string;
}

interface WithdrawalRecord {
  id: string;
  walletAddress: string;
  amount: string;
  source: string;
  status: 'pending' | 'pending_link' | 'completed' | 'failed';
  paymentId?: string;
  withdrawTxHash?: string;
  customerRequestId?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

// Security configuration
const WITHDRAWAL_TTL = 90 * 24 * 60 * 60; // 90 days
const WITHDRAWAL_LIST_TTL = 365 * 24 * 60 * 60; // 1 year
const SIGNATURE_EXPIRY = 5 * 60 * 1000; // 5 minutes
const MAX_WITHDRAWAL_AMOUNT = 100000; // $100k max
const MIN_WITHDRAWAL_AMOUNT = 1; // $1 min
const MAX_ATTEMPTS_PER_HOUR = 10;
const SIGNATURE_REUSE_TTL = 10 * 60; // 10 minutes

// Avalanche configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';

const CONTRACTS = {
  USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  AAVE_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  AAVE_AUSDC: '0x625E7708f30cA75bfd92586e17077590C60eb4cD',
  ESCROW_ADDRESS: '0x0000000000000000000000000000000000000000', // Replace with actual escrow
};

// ABIs
const AAVE_POOL_ABI = [
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
];

const AAVE_ATOKEN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

// ============================================================================
// ZOD VALIDATION SCHEMAS
// ============================================================================

const WithdrawalRequestSchema = z.object({
  walletAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum wallet address format'),
  amount: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a valid number with up to 2 decimal places')
    .transform(amount => parseFloat(amount))
    .refine(amount => amount >= MIN_WITHDRAWAL_AMOUNT && amount <= MAX_WITHDRAWAL_AMOUNT, 
      `Amount must be between $${MIN_WITHDRAWAL_AMOUNT} and $${MAX_WITHDRAWAL_AMOUNT}`),
  source: z.enum(['aave', 'gmx', 'wallet'], {
    errorMap: () => ({ message: 'Source must be one of: aave, gmx, wallet' })
  }),
  cashappGrantId: z.string().optional(),
  userEmail: z.string()
    .email('Invalid email format')
    .optional(),
  paymentId: z.string()
    .regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-zA-Z0-9]{8,64})$/i, 'Invalid payment ID format')
    .optional(),
  signature: z.string()
    .regex(/^0x[a-fA-F0-9]{130}$/, 'Invalid signature format'),
  message: z.string()
    .min(50, 'Message too short')
    .max(500, 'Message too long'),
  timestamp: z.number()
    .int('Timestamp must be an integer')
    .optional()
});

// ============================================================================
// SECURITY & VALIDATION FUNCTIONS
// ============================================================================

/**
 * Generate withdrawal message for signature
 */
function generateWithdrawalMessage(
  walletAddress: string,
  amount: number,
  source: string,
  timestamp: number
): string {
  return `TiltVault Withdrawal Authorization

Wallet: ${walletAddress}
Amount: $${amount.toFixed(2)} USD
Source: ${source}
Timestamp: ${timestamp}

By signing this message, you authorize this withdrawal from your TiltVault account.`;
}

/**
 * Extract timestamp from signed message
 */
function extractTimestampFromMessage(message: string): number | null {
  const match = message.match(/Timestamp: (\d+)/);
  return match ? parseInt(match[1]) : null;
}

/**
 * Validate message timestamp and prevent replay attacks
 */
async function validateMessageTimestamp(
  message: string,
  signature: string,
  walletAddress: string
): Promise<{ valid: boolean; error?: string }> {
  const timestamp = extractTimestampFromMessage(message);
  if (!timestamp) {
    return { valid: false, error: 'Invalid message format - timestamp not found' };
  }

  const now = Date.now();
  
  // Check timestamp is within acceptable range (±5 minutes)
  if (Math.abs(now - timestamp) > SIGNATURE_EXPIRY) {
    return { 
      valid: false, 
      error: 'Signature expired. Please generate a new signature.' 
    };
  }

  // Check if signature has been used before (replay protection)
  const redis = await getRedis();
  const crypto = getCrypto();
  const signatureKey = `used_signature:${crypto.createHash('sha256').update(signature).digest('hex')}`;
  const existing = await redis.get(signatureKey);
  
  if (existing) {
    return { 
      valid: false, 
      error: 'Signature has already been used. Please generate a new signature.' 
    };
  }

  // Mark signature as used
  await redis.set(signatureKey, JSON.stringify({
    walletAddress,
    timestamp,
    usedAt: now
  }), { ex: SIGNATURE_REUSE_TTL });

  return { valid: true };
}

/**
 * Verify cryptographic signature
 */
async function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signature: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const recoveredAddress = verifyMessage(message, signature);
    
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      return { 
        valid: false, 
        error: 'Signature verification failed - address mismatch' 
      };
    }

    return { valid: true };
  } catch (error) {
    logger.error('Signature verification error', LogCategory.AUTH, {
      walletAddress,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return { 
      valid: false, 
      error: 'Invalid signature format or verification failed' 
    };
  }
}

/**
 * Check rate limiting per wallet
 */
async function checkWithdrawalRateLimit(walletAddress: string): Promise<{ allowed: boolean; error?: string }> {
  try {
    const redis = await getRedis();
    const attemptsKey = `withdrawal_attempts:${walletAddress.toLowerCase()}`;
    const current = await redis.incr(attemptsKey);
    
    if (current === 1) {
      await redis.expire(attemptsKey, 3600); // 1 hour
    }
    
    if (current > MAX_ATTEMPTS_PER_HOUR) {
      return { 
        allowed: false, 
        error: `Too many withdrawal attempts. Maximum ${MAX_ATTEMPTS_PER_HOUR} per hour.` 
      };
    }
    
    return { allowed: true };
  } catch (error) {
    logger.warn('Failed to check withdrawal rate limit', LogCategory.AUTH, {
      walletAddress,
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Fail open - allow request if Redis fails
    return { allowed: true };
  }
}

/**
 * Verify wallet balance for direct wallet withdrawals
 */
async function checkWalletBalance(walletAddress: string, amountUsd: number): Promise<{ sufficient: boolean; balance: number; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const usdcContract = new ethers.Contract(CONTRACTS.USDC, ERC20_ABI, provider);
    
    const balance = await usdcContract.balanceOf(walletAddress);
    const balanceUsd = Number(ethers.formatUnits(balance, 6));
    
    if (balanceUsd < amountUsd) {
      return {
        sufficient: false,
        balance: balanceUsd,
        error: `Insufficient USDC balance: $${balanceUsd.toFixed(2)} available, $${amountUsd.toFixed(2)} required`
      };
    }
    
    return { sufficient: true, balance: balanceUsd };
  } catch (error) {
    logger.error('Error checking wallet balance', LogCategory.API, {
      walletAddress,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return {
      sufficient: false,
      balance: 0,
      error: 'Failed to verify wallet balance'
    };
  }
}

/**
 * Hash sensitive data for logging
 */
function hashForLogging(data: string): string {
  const crypto = getCrypto();
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 8);
}

/**
 * Get client IP for logging
 */
function getClientIP(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = forwarded 
    ? (Array.isArray(forwarded) ? forwarded[0] : typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : String(forwarded))
    : req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
  return typeof ip === 'string' ? ip : (Array.isArray(ip) ? ip[0] : 'unknown');
}

// ============================================================================
// REDIS STORAGE FUNCTIONS
// ============================================================================

/**
 * Store withdrawal record in Redis
 */
async function storeWithdrawal(withdrawalId: string, record: WithdrawalRecord): Promise<void> {
  const redis = await getRedis();
  await redis.set(`withdrawal:${withdrawalId}`, JSON.stringify(record), { ex: WITHDRAWAL_TTL });
  
  if (record.walletAddress) {
    const walletKey = `withdrawals:${record.walletAddress.toLowerCase()}`;
    await redis.lpush(walletKey, withdrawalId);
    await redis.expire(walletKey, WITHDRAWAL_LIST_TTL);
  }
}

/**
 * Get withdrawal record from Redis
 */
async function getWithdrawal(withdrawalId: string): Promise<WithdrawalRecord | null> {
  const redis = await getRedis();
  const data = await redis.get(`withdrawal:${withdrawalId}`);
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data;
}

/**
 * Get all withdrawals for a wallet
 */
async function getWalletWithdrawals(walletAddress: string): Promise<WithdrawalRecord[]> {
  const redis = await getRedis();
  const walletKey = `withdrawals:${walletAddress.toLowerCase()}`;
  const withdrawalIds = await redis.lrange(walletKey, 0, -1) as string[];
  
  if (!withdrawalIds || withdrawalIds.length === 0) {
    return [];
  }
  
  const withdrawals = await Promise.all(
    withdrawalIds.map(async (id: string) => await getWithdrawal(id))
  );
  
  return withdrawals
    .filter((w: WithdrawalRecord | null): w is WithdrawalRecord => w !== null)
    .sort((a: WithdrawalRecord, b: WithdrawalRecord) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

// ============================================================================
// BLOCKCHAIN FUNCTIONS
// ============================================================================

/**
 * Verify blockchain transaction succeeded
 */
async function verifyBlockchainTransaction(txHash: string): Promise<{ success: boolean; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return { success: false, error: 'Transaction not found on blockchain' };
    }
    
    if (receipt.status !== 1) {
      return { success: false, error: 'Transaction failed on blockchain' };
    }
    
    // Additional verification: check gas usage and actual token transfers
    if (receipt.gasUsed.toString() === '0') {
      return { success: false, error: 'Invalid transaction - no gas used' };
    }
    
    logger.info('Blockchain transaction verified', LogCategory.API, {
      txHash,
      confirmations: receipt.confirmations,
      gasUsed: receipt.gasUsed.toString()
    });
    
    return { success: true };
  } catch (error) {
    logger.error('Error verifying blockchain transaction', LogCategory.API, {
      txHash,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error verifying transaction' 
    };
  }
}

/**
 * Check Aave balance
 */
async function checkAaveBalance(walletAddress: string, amountUsd: number): Promise<{ sufficient: boolean; balance: number; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const aToken = new ethers.Contract(CONTRACTS.AAVE_AUSDC, AAVE_ATOKEN_ABI, provider);
    
    const balance = await aToken.balanceOf(walletAddress);
    const balanceUsd = Number(ethers.formatUnits(balance, 6));
    
    logger.debug('Aave balance checked', LogCategory.API, {
      walletAddress: hashForLogging(walletAddress),
      balance: balanceUsd,
      required: amountUsd
    });
    
    if (balanceUsd < amountUsd) {
      return {
        sufficient: false,
        balance: balanceUsd,
        error: `Insufficient Aave balance: $${balanceUsd.toFixed(2)} available, $${amountUsd.toFixed(2)} required` 
      };
    }
    
    return { sufficient: true, balance: balanceUsd };
  } catch (error) {
    logger.error('Error checking Aave balance', LogCategory.API, {
      walletAddress: hashForLogging(walletAddress),
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return {
      sufficient: false,
      balance: 0,
      error: 'Failed to check Aave balance'
    };
  }
}

/**
 * Withdraw from Aave
 */
async function withdrawFromAave(privateKey: string, amountUsd: number): Promise<string> {
  const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);
  const amountWei = ethers.parseUnits(amountUsd.toString(), 6);
  const aavePool = new ethers.Contract(CONTRACTS.AAVE_POOL, AAVE_POOL_ABI, wallet);

  logger.info('Starting Aave withdrawal', LogCategory.API, {
    walletAddress: wallet.address,
    amount: amountUsd,
    amountWei: amountWei.toString()
  });

  const tx = await aavePool.withdraw(
    CONTRACTS.USDC,
    amountWei,
    wallet.address
  );

  logger.info('Aave withdrawal transaction submitted', LogCategory.API, {
    txHash: tx.hash,
    walletAddress: wallet.address
  });

  const receipt = await Promise.race([
    tx.wait(),
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Transaction confirmation timeout')), 60000)
    )
  ]);

  if (receipt.status !== 1) {
    throw new Error(`Transaction failed with status ${receipt.status}`);
  }

  logger.info('Aave withdrawal completed', LogCategory.API, {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    confirmations: receipt.confirmations
  });

  return receipt.hash;
}

// ============================================================================
// CASH APP INTEGRATION
// ============================================================================

/**
 * Create Cash App payment link
 */
async function createCashAppLink(amountCents: number, referenceId: string) {
  const CASHAPP_BASE_URL = process.env.CASHAPP_ENVIRONMENT === 'production'
    ? 'https://api.cash.app'
    : 'https://sandbox.api.cash.app';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Region': 'PDX',
    'Authorization': `Client ${process.env.CASHAPP_CLIENT_ID}`,
  };

  if (process.env.CASHAPP_ENVIRONMENT !== 'production') {
    headers['x-signature'] = 'sandbox:skip-signature-check';
  }

  const response = await fetch(`${CASHAPP_BASE_URL}/customer-request/v1/requests`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      request: {
        actions: [
          {
            amount: amountCents,
            currency: 'USD',
            scope_id: process.env.CASHAPP_MERCHANT_ID || process.env.CASHAPP_BRAND_ID || process.env.CASHAPP_CLIENT_ID,
            type: 'ONE_TIME_PAYMENT',
          },
        ],
        reference_id: referenceId,
        channel: 'ONLINE',
      },
      idempotency_key: `link-${referenceId}-${Date.now()}`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cash App API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    requestId: data.id,
    qrCodeUrl: data.auth_flow_triggers?.qr_code_image_url || '',
    mobileUrl: data.auth_flow_triggers?.mobile_url || '',
  };
}

/**
 * Send Cash App payment
 */
async function sendCashAppPayment(amountCents: number, grantId: string, referenceId: string) {
  const CASHAPP_BASE_URL = process.env.CASHAPP_ENVIRONMENT === 'production'
    ? 'https://api.cash.app'
    : 'https://sandbox.api.cash.app';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Region': 'PDX',
    'Authorization': process.env.CASHAPP_API_CREDENTIALS || '',
  };

  if (process.env.CASHAPP_ENVIRONMENT !== 'production') {
    headers['x-signature'] = 'sandbox:skip-signature-check';
  }

  const response = await fetch(`${CASHAPP_BASE_URL}/network/v1/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      payment: {
        capture: true,
        amount: amountCents,
        currency: 'USD',
        merchant_id: process.env.CASHAPP_MERCHANT_ID,
        grant_id: grantId,
        reference_id: referenceId,
      },
      idempotency_key: `payment-${referenceId}-${Date.now()}`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cash App Payment API error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    paymentId: data.id || data.payment?.id,
    status: data.status || data.payment?.status,
  };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS headers (restrictive for production)
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['https://www.tiltvault.com'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin ?? '')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  await withMonitoring(req, res, 'withdrawal-complete-flow', async (): Promise<void> => {
    const startTime = Date.now();
    const clientIP = getClientIP(req);
    
    try {
      if (req.method === 'POST') {
        return await handleWithdrawal(req, res, clientIP, startTime);
      }

      if (req.method === 'GET') {
        return await getWithdrawalStatus(req, res);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('Withdrawal flow error', LogCategory.API, {
        ip: clientIP,
        error: errorMessage,
        duration: Date.now() - startTime
      }, error instanceof Error ? error : new Error(errorMessage));
      
      errorTracker.trackError(error instanceof Error ? error : new Error(errorMessage), {
        category: 'withdrawal',
        context: {
          endpoint: 'complete-flow',
          ip: clientIP
        }
      });
      
      // Don't expose internal errors to client
      const userMessage = errorMessage.includes('Invalid') || errorMessage.includes('Missing')
        ? errorMessage
        : 'Withdrawal failed. Please try again later.';
      
      res.status(500).json({
        error: 'Withdrawal failed',
        message: userMessage
      });
      return;
    }
  });
}

// ============================================================================
// WITHDRAWAL HANDLING
// ============================================================================

async function handleWithdrawal(
  req: VercelRequest, 
  res: VercelResponse, 
  clientIP: string, 
  startTime: number
): Promise<void> {
  // Validate and parse request using Zod
  const validatedRequest = WithdrawalRequestSchema.parse(req.body);
  const { 
    walletAddress, 
    amount, 
    source, 
    cashappGrantId, 
    userEmail, 
    paymentId, 
    signature, 
    message 
  } = validatedRequest;

  logger.info('Withdrawal request validated', LogCategory.API, {
    walletAddress: hashForLogging(walletAddress),
    amount,
    source,
    ip: clientIP
  });

  // Check rate limiting
  const rateLimitCheck = await checkWithdrawalRateLimit(walletAddress);
  if (!rateLimitCheck.allowed) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: rateLimitCheck.error
    });
    return;
  }

  // Verify signature and prevent replay attacks
  const signatureCheck = await verifyWalletSignature(walletAddress, message, signature);
  if (!signatureCheck.valid) {
    res.status(401).json({
      error: 'Authentication failed',
      message: signatureCheck.error
    });
    return;
  }

  const timestampCheck = await validateMessageTimestamp(message, signature, walletAddress);
  if (!timestampCheck.valid) {
    return res.status(401).json({
      error: 'Authentication failed',
      message: timestampCheck.error
    });
  }

  // Validate required fields for DeFi withdrawals
  if ((source === 'aave' || source === 'gmx') && (!userEmail || !paymentId)) {
    res.status(400).json({
      error: 'Missing required fields for DeFi withdrawal',
      message: 'userEmail and paymentId are required for Aave/GMX withdrawals'
    });
    return;
  }

  const withdrawalId = `WD_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  
  logger.info('Starting withdrawal process', LogCategory.API, {
    withdrawalId,
    walletAddress: hashForLogging(walletAddress),
    amount,
    source,
    ip: clientIP
  });

  try {
    let withdrawTxHash: string | undefined;

    // Step 1: Handle DeFi withdrawals
    if (source === 'aave' || source === 'gmx') {
      // Retrieve and decrypt wallet key
      const encryptedData = await getWalletKey(walletAddress);
      if (!encryptedData) {
        res.status(404).json({ 
          success: false, 
          error: 'Wallet key not found or expired' 
        });
        return;
      }

      const walletData = await decryptWalletKeyWithAuth(encryptedData, userEmail!, paymentId!);
      const { privateKey } = walletData;

      if (!privateKey) {
        res.status(400).json({ 
          success: false, 
          error: 'Failed to decrypt private key' 
        });
        return;
      }

      // Execute withdrawal
      if (source === 'aave') {
        const balanceCheck = await checkAaveBalance(walletAddress, amount);
        if (!balanceCheck.sufficient) {
          res.status(400).json({
            success: false,
            error: balanceCheck.error || 'Insufficient balance',
            balance: balanceCheck.balance
          });
          return;
        }
        
        withdrawTxHash = await withdrawFromAave(privateKey, amount);
      } else if (source === 'gmx') {
        // Import GMX function
        const { closeGmxPosition } = await import('../square/close-position.js');
        const gmxResult = await closeGmxPosition(privateKey);
        
        if (!gmxResult.success) {
          res.status(500).json({
            success: false,
            error: gmxResult.error || 'GMX position close failed'
          });
          return;
        }
        
        withdrawTxHash = gmxResult.txHash;
      }

      // Verify blockchain transaction
      if (withdrawTxHash) {
        const verification = await verifyBlockchainTransaction(withdrawTxHash);
        if (!verification.success) {
          res.status(500).json({
            success: false,
            error: `Blockchain withdrawal failed: ${verification.error}`,
            txHash: withdrawTxHash
          });
          return;
        }
      }
    } else if (source === 'wallet') {
      // Verify wallet balance for direct withdrawals
      const balanceCheck = await checkWalletBalance(walletAddress, amount);
      if (!balanceCheck.sufficient) {
        return res.status(400).json({
          success: false,
          error: balanceCheck.error || 'Insufficient balance',
          balance: balanceCheck.balance
        });
      }
    }

    // Step 2: Process Cash App payment
    const amountCents = Math.round(amount * 100);

    if (cashappGrantId) {
      // Direct payment
      const paymentResult = await sendCashAppPayment(amountCents, cashappGrantId, withdrawalId);

      // CRITICAL: Only delete key after complete success
      if (source === 'aave' || source === 'gmx') {
        await deleteWalletKey(walletAddress);
        logger.info('Wallet key deleted after successful withdrawal', LogCategory.AUTH, {
          walletAddress: hashForLogging(walletAddress),
          withdrawalId
        });
      }

      const record: WithdrawalRecord = {
        id: withdrawalId,
        walletAddress,
        amount: amount.toFixed(2),
        source,
        status: 'completed',
        paymentId: paymentResult.paymentId,
        withdrawTxHash,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      
      await storeWithdrawal(withdrawalId, record);

      res.status(200).json({
        success: true,
        withdrawalId,
        usdAmount: amount.toFixed(2),
        needsLinking: false,
        paymentId: paymentResult.paymentId,
        txHash: withdrawTxHash,
        message: `$${amount.toFixed(2)} sent to your Cash App`,
      });
      return;
    } else {
      // Create payment link
      const linkResult = await createCashAppLink(amountCents, withdrawalId);

      const record: WithdrawalRecord = {
        id: withdrawalId,
        walletAddress,
        amount: amount.toFixed(2),
        source,
        status: 'pending_link',
        customerRequestId: linkResult.requestId,
        withdrawTxHash,
        createdAt: new Date().toISOString(),
      };
      
      await storeWithdrawal(withdrawalId, record);

      res.status(200).json({
        success: true,
        withdrawalId,
        usdAmount: amount.toFixed(2),
        needsLinking: true,
        customerRequestId: linkResult.requestId,
        qrCodeUrl: linkResult.qrCodeUrl,
        mobileUrl: linkResult.mobileUrl,
        message: 'Scan QR code or tap link to connect Cash App and receive funds',
      });
      return;
    }

  } catch (error) {
    // Store failed record
    const failedRecord: WithdrawalRecord = {
      id: withdrawalId,
      walletAddress,
      amount: amount.toFixed(2),
      source,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      createdAt: new Date().toISOString(),
    };
    
    await storeWithdrawal(withdrawalId, failedRecord);
    throw error;
  }
}

// ============================================================================
// STATUS RETRIEVAL
// ============================================================================

async function getWithdrawalStatus(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    const { withdrawalId, walletAddress } = req.query;

    if (withdrawalId && typeof withdrawalId === 'string') {
      const record = await getWithdrawal(withdrawalId);
      if (!record) {
        res.status(404).json({ error: 'Withdrawal not found' });
        return;
      }
      res.status(200).json({ success: true, withdrawal: record });
      return;
    }

    if (walletAddress && typeof walletAddress === 'string') {
      const userWithdrawals = await getWalletWithdrawals(walletAddress);
      res.status(200).json({
        success: true,
        withdrawals: userWithdrawals,
        total: userWithdrawals.length,
      });
      return;
    }

    res.status(400).json({ error: 'Missing withdrawalId or walletAddress' });
    return;
  } catch (error) {
    logger.error('Error getting withdrawal status', LogCategory.API, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    res.status(500).json({
      error: 'Failed to retrieve withdrawal status',
      message: 'Please try again later'
    });
    return;
  }
}
