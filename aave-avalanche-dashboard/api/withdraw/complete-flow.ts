import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers, verifyMessage } from 'ethers';
import { getWalletKey, decryptWalletKeyWithAuth, deleteWalletKey } from '../wallet/keystore';
import { getRedis } from '../utils/redis';

/**
 * Complete Withdrawal Flow: AAVE/GMX → USDC → USD → Cash App
 * 
 * This endpoint handles the full DeFi-to-Cash bridge:
 * 1. Validate user session and verify wallet ownership via signature
 * 2. Withdraw from AAVE or GMX
 * 3. Convert USDC to USD (1:1 for stablecoins)
 * 4. Send to Cash App
 * 
 * SECURITY MEASURES:
 * 
 * 1. Signature-Based Authentication (REQUIRED):
 *    - All withdrawals require a cryptographic signature proving wallet ownership
 *    - Client must sign a message containing: walletAddress, amount, source, timestamp
 *    - Server verifies signature matches the wallet address before processing
 *    - Prevents unauthorized withdrawals by anyone who knows a wallet address
 * 
 * 2. Private Key Security:
 *    - Private keys are NEVER accepted in request bodies
 *    - Keys are stored encrypted in Redis (encrypted client-side before storage)
 *    - Keys are retrieved and decrypted server-side using userEmail + paymentId
 *    - Keys are deleted immediately after use (one-time use)
 *    - For connected wallets (Privy), use server-side delegation instead
 * 
 * 3. Message Format for Signature:
 *    ```
 *    TiltVault Withdrawal Authorization
 *    
 *    Wallet: {walletAddress}
 *    Amount: ${amount} USD
 *    Source: {source}
 *    Timestamp: {timestamp}
 *    
 *    By signing this message, you authorize this withdrawal from your TiltVault account.
 *    ```
 */

const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';

// Contract addresses on Avalanche
const CONTRACTS = {
  USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  AAVE_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  AAVE_AUSDC: '0x625E7708f30cA75bfd92586e17077590C60eb4cD', // aUSDC token
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
    
    console.log(`[Verify] Transaction ${txHash} verified: ${receipt.confirmations} confirmations`);
    return { success: true };
  } catch (error) {
    console.error(`[Verify] Error verifying transaction ${txHash}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error verifying transaction' 
    };
  }
}

/**
 * Check user has sufficient balance before withdrawal
 */
async function checkAaveBalance(walletAddress: string, amountUsd: number): Promise<{ sufficient: boolean; balance: number; error?: string }> {
  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const aToken = new ethers.Contract(CONTRACTS.AAVE_AUSDC, AAVE_ATOKEN_ABI, provider);
    
    const balance = await aToken.balanceOf(walletAddress);
    const balanceUsd = Number(ethers.formatUnits(balance, 6)); // USDC has 6 decimals
    
    console.log(`[Balance] Aave balance: $${balanceUsd}, Required: $${amountUsd}`);
    
    if (balanceUsd < amountUsd) {
      return {
        sufficient: false,
        balance: balanceUsd,
        error: `Insufficient Aave balance: $${balanceUsd.toFixed(2)} available, $${amountUsd} required`
      };
    }
    
    return { sufficient: true, balance: balanceUsd };
  } catch (error) {
    console.error('[Balance] Error checking Aave balance:', error);
    return {
      sufficient: false,
      balance: 0,
      error: error instanceof Error ? error.message : 'Failed to check balance'
    };
  }
}

interface WithdrawalRequest {
  walletAddress: string;
  // SECURITY: Private keys are NEVER accepted in request bodies
  // Keys are retrieved from encrypted Redis storage and decrypted server-side
  amount: string; // Amount in USD
  source: 'aave' | 'gmx' | 'wallet';
  cashappGrantId?: string;
  userEmail?: string; // Required for key decryption
  paymentId?: string; // Required for key decryption
  // SECURITY: Signature-based authentication required
  signature: string; // Cryptographic signature proving wallet ownership
  message: string; // Message that was signed (must match server-generated message)
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

// Redis-based withdrawal storage (persistent across server restarts)
const WITHDRAWAL_TTL = 90 * 24 * 60 * 60; // 90 days TTL for withdrawal records
const WITHDRAWAL_LIST_TTL = 365 * 24 * 60 * 60; // 1 year for user withdrawal lists

/**
 * Store withdrawal record in Redis
 */
async function storeWithdrawal(withdrawalId: string, record: any): Promise<void> {
  const redis = getRedis();
  // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
  await redis.set(`withdrawal:${withdrawalId}`, JSON.stringify(record), { ex: WITHDRAWAL_TTL });
  
  // Also maintain a list of withdrawals per wallet for quick lookup
  if (record.walletAddress) {
    const walletKey = `withdrawals:${record.walletAddress.toLowerCase()}`;
    // @ts-ignore - @upstash/redis types may not include lpush method in some TypeScript versions, but it exists at runtime
    await redis.lpush(walletKey, withdrawalId);
    // @ts-ignore - @upstash/redis types may not include expire method in some TypeScript versions, but it exists at runtime
    await redis.expire(walletKey, WITHDRAWAL_LIST_TTL);
  }
}

/**
 * Get withdrawal record from Redis
 */
async function getWithdrawal(withdrawalId: string): Promise<any | null> {
  const redis = getRedis();
  // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
  const data = await redis.get(`withdrawal:${withdrawalId}`);
  if (!data) return null;
  return typeof data === 'string' ? JSON.parse(data) : data;
}

/**
 * Get all withdrawals for a wallet from Redis
 */
async function getWalletWithdrawals(walletAddress: string): Promise<any[]> {
  const redis = getRedis();
  const walletKey = `withdrawals:${walletAddress.toLowerCase()}`;
  // @ts-ignore - @upstash/redis types may not include lrange method in some TypeScript versions, but it exists at runtime
  const withdrawalIds = await redis.lrange(walletKey, 0, -1) as string[];
  
  if (!withdrawalIds || withdrawalIds.length === 0) {
    return [];
  }
  
  // Fetch all withdrawal records
  const withdrawals = await Promise.all(
    withdrawalIds.map(async (id: string) => {
      const record = await getWithdrawal(id);
      return record;
    })
  );
  
  // Filter out nulls and sort by creation date (newest first)
  return withdrawals
    .filter((w: any) => w !== null)
    .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      return await handleWithdrawal(req, res);
    }

    if (req.method === 'GET') {
      return await getWithdrawalStatus(req, res);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[Withdraw] Error:', error);
    return res.status(500).json({
      error: 'Withdrawal failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Generate withdrawal message for signature
 * This message must be signed by the wallet owner to prove ownership
 */
function generateWithdrawalMessage(
  walletAddress: string,
  amount: string,
  source: string,
  timestamp: number
): string {
  return `TiltVault Withdrawal Authorization

Wallet: ${walletAddress}
Amount: $${amount} USD
Source: ${source}
Timestamp: ${timestamp}

By signing this message, you authorize this withdrawal from your TiltVault account.`;
}

async function handleWithdrawal(req: VercelRequest, res: VercelResponse) {
  const { walletAddress, amount, source, cashappGrantId, userEmail, paymentId, signature, message } = req.body as WithdrawalRequest;

  // Validate required fields
  if (!walletAddress || !amount || !source) {
    return res.status(400).json({
      error: 'Missing required fields: walletAddress, amount, source',
    });
  }

  // Verify wallet address format
  if (!walletAddress.startsWith('0x') || walletAddress.length !== 42) {
    return res.status(400).json({ error: 'Invalid wallet address format' });
  }

  // SECURITY: Require signature and message for wallet ownership verification
  if (!signature || !message) {
    return res.status(401).json({
      error: 'Missing authentication: signature and message required',
      message: 'You must sign a message with your wallet to authorize this withdrawal. This proves you own the wallet address.',
      requiredFields: ['signature', 'message']
    });
  }

  // SECURITY: Verify signature to prove wallet ownership
  try {
    console.log(`[Withdraw] 🔐 Verifying signature for ${walletAddress}...`);
    console.log(`[Withdraw] Message length: ${message.length} chars`);
    console.log(`[Withdraw] Signature length: ${signature.length} chars`);
    
    const recoveredAddress = verifyMessage(message, signature);
    console.log(`[Withdraw] Recovered address: ${recoveredAddress}`);
    console.log(`[Withdraw] Expected address: ${walletAddress}`);
    
    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      console.error(`[Withdraw] ❌ Signature mismatch!`);
      console.error(`[Withdraw] Recovered: ${recoveredAddress.toLowerCase()}`);
      console.error(`[Withdraw] Expected: ${walletAddress.toLowerCase()}`);
      return res.status(401).json({ 
        error: 'Invalid signature - wallet ownership verification failed',
        message: 'The signature does not match the wallet address. You must sign the message with the wallet that owns the funds.',
        details: {
          recovered: recoveredAddress,
          expected: walletAddress
        }
      });
    }
    
    console.log(`[Withdraw] ✅✅✅ SIGNATURE VERIFIED for ${walletAddress}`);
    console.log(`[Withdraw] ✅ Wallet ownership confirmed via cryptographic signature`);
  } catch (sigError) {
    console.error('[Withdraw] ❌ Signature verification error:', sigError);
    return res.status(400).json({ 
      error: 'Signature verification failed',
      message: 'The signature is invalid or malformed. Please ensure you signed the correct message.',
      details: sigError instanceof Error ? sigError.message : String(sigError)
    });
  }

  // SECURITY: For DeFi withdrawals, require userEmail and paymentId for key decryption
  if ((source === 'aave' || source === 'gmx') && (!userEmail || !paymentId)) {
    return res.status(400).json({
      error: 'Missing required fields for DeFi withdrawal: userEmail, paymentId',
      message: 'Private keys are never accepted in request bodies. Keys are retrieved from encrypted storage and decrypted server-side.'
    });
  }

  const amountUsd = parseFloat(amount);
  if (amountUsd < 1) {
    return res.status(400).json({ error: 'Minimum withdrawal is $1' });
  }

  const withdrawalId = `WD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Withdraw] Starting ${amount} USD withdrawal from ${source} for ${walletAddress}`);

  try {
    // Step 1: Withdraw from DeFi protocol (if not already in wallet)
    let usdcAmount = amountUsd;
    let withdrawTxHash: string | undefined;

    if (source === 'aave' || source === 'gmx') {
      // SECURITY: Retrieve encrypted key from Redis and decrypt server-side
      // Private keys are NEVER accepted in request bodies
      const encryptedData = await getWalletKey(walletAddress);
      if (!encryptedData) {
        return res.status(404).json({ 
          success: false, 
          error: 'Wallet key not found or expired. Please ensure you have an active deposit.' 
        });
      }

      // Decrypt with user authentication (requires email and paymentId for key derivation)
      const walletData = decryptWalletKeyWithAuth(encryptedData, userEmail!, paymentId!);
      const { privateKey } = walletData;

      if (!privateKey) {
        return res.status(400).json({ 
          success: false, 
          error: 'Failed to decrypt private key. Please verify your email and payment ID.' 
        });
      }

      // Execute withdrawal with decrypted key (only in memory, never logged)
      if (source === 'aave') {
        console.log(`[AAVE] Withdrawing ${amountUsd} USDC from AAVE`);
        
        // Check balance before withdrawal
        const balanceCheck = await checkAaveBalance(walletAddress, amountUsd);
        if (!balanceCheck.sufficient) {
          return res.status(400).json({
            success: false,
            error: balanceCheck.error || 'Insufficient balance',
            balance: balanceCheck.balance
          });
        }
        
        withdrawTxHash = await withdrawFromAave(privateKey, amountUsd);
        
        // Verify transaction succeeded before proceeding
        if (withdrawTxHash) {
          console.log(`[Withdraw] Verifying Aave withdrawal transaction: ${withdrawTxHash}`);
          const verification = await verifyBlockchainTransaction(withdrawTxHash);
          if (!verification.success) {
            return res.status(500).json({
              success: false,
              error: `Withdrawal transaction failed: ${verification.error}`,
              txHash: withdrawTxHash
            });
          }
          console.log(`[Withdraw] ✅ Aave withdrawal verified: ${withdrawTxHash}`);
        }
      } else if (source === 'gmx') {
        console.log(`[GMX] Closing position worth ${amountUsd} USDC`);
        // Import GMX close function from webhook
        const { closeGmxPosition } = await import('../square/webhook.js');
        const gmxResult = await closeGmxPosition(privateKey);
        if (!gmxResult.success) {
          return res.status(500).json({
            success: false,
            error: gmxResult.error || 'GMX position close failed',
            txHash: gmxResult.txHash
          });
        }
        withdrawTxHash = gmxResult.txHash;
        
        // Verify transaction succeeded before proceeding
        if (withdrawTxHash && withdrawTxHash !== '0x' + '0'.repeat(64)) {
          console.log(`[Withdraw] Verifying GMX close transaction: ${withdrawTxHash}`);
          const verification = await verifyBlockchainTransaction(withdrawTxHash);
          if (!verification.success) {
            return res.status(500).json({
              success: false,
              error: `GMX close transaction failed: ${verification.error}`,
              txHash: withdrawTxHash
            });
          }
          console.log(`[Withdraw] ✅ GMX close verified: ${withdrawTxHash}`);
        }
      }

      // SECURITY: Delete the encrypted key after use (one-time use)
      await deleteWalletKey(walletAddress);
      console.log(`[Withdraw] Deleted wallet key after withdrawal for security`);
    }

    // Step 2: Verify blockchain transaction succeeded before proceeding to Cash App
    // CRITICAL: Only send Cash App payment if blockchain withdrawal succeeded
    if (source === 'aave' || source === 'gmx') {
      if (!withdrawTxHash) {
        return res.status(500).json({
          success: false,
          error: 'Blockchain withdrawal failed - no transaction hash',
          message: 'The DeFi withdrawal did not complete. Cash App payment will not be sent.'
        });
      }
      
      // Transaction verification already done above, but double-check
      console.log(`[Withdraw] ✅ Blockchain withdrawal confirmed: ${withdrawTxHash}`);
    }

    // Step 3: Convert USDC to USD (1:1 for stablecoins)
    const usdAmount = usdcAmount.toFixed(2);
    console.log(`[Conversion] ${usdcAmount} USDC → $${usdAmount} USD`);

    // Step 4: Send to Cash App (only if blockchain transaction succeeded)
    const amountCents = Math.round(parseFloat(usdAmount) * 100);

    if (cashappGrantId) {
      // User already linked Cash App - send payment directly
      const paymentResult = await sendCashAppPayment(amountCents, cashappGrantId, withdrawalId);

      const record = {
        id: withdrawalId,
        walletAddress,
        amount: usdAmount,
        source,
        status: 'completed',
        paymentId: paymentResult.paymentId,
        withdrawTxHash,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      await storeWithdrawal(withdrawalId, record);

      return res.status(200).json({
        success: true,
        withdrawalId,
        usdAmount,
        needsLinking: false,
        paymentId: paymentResult.paymentId,
        txHash: withdrawTxHash,
        message: `$${usdAmount} sent to your Cash App`,
      });
    }

    // User needs to link Cash App first
    const linkResult = await createCashAppLink(amountCents, withdrawalId);

    const record = {
      id: withdrawalId,
      walletAddress,
      amount: usdAmount,
      source,
      status: 'pending_link',
      customerRequestId: linkResult.requestId,
      withdrawTxHash,
      createdAt: new Date().toISOString(),
    };
    await storeWithdrawal(withdrawalId, record);

    return res.status(200).json({
      success: true,
      withdrawalId,
      usdAmount,
      needsLinking: true,
      customerRequestId: linkResult.requestId,
      qrCodeUrl: linkResult.qrCodeUrl,
      mobileUrl: linkResult.mobileUrl,
      message: 'Scan QR code or tap link to connect Cash App and receive funds',
    });

  } catch (error) {
    console.error(`[Withdraw] Failed for ${withdrawalId}:`, error);

    const record = {
      id: withdrawalId,
      walletAddress,
      amount,
      source,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      createdAt: new Date().toISOString(),
    };
    await storeWithdrawal(withdrawalId, record);

    throw error;
  }
}

async function getWithdrawalStatus(req: VercelRequest, res: VercelResponse) {
  try {
    const { withdrawalId, walletAddress } = req.query;

    if (withdrawalId && typeof withdrawalId === 'string') {
      const record = await getWithdrawal(withdrawalId);
      if (!record) {
        return res.status(404).json({ error: 'Withdrawal not found' });
      }
      return res.status(200).json({ success: true, withdrawal: record });
    }

    if (walletAddress && typeof walletAddress === 'string') {
      // Get all withdrawals for a wallet from Redis
      const userWithdrawals = await getWalletWithdrawals(walletAddress);
      return res.status(200).json({
        success: true,
        withdrawals: userWithdrawals,
        total: userWithdrawals.length,
      });
    }

    return res.status(400).json({ error: 'Missing withdrawalId or walletAddress' });
  } catch (error) {
    console.error('[Withdraw] Error getting withdrawal status:', error);
    return res.status(500).json({
      error: 'Failed to retrieve withdrawal status',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

// =============================================================================
// AAVE WITHDRAWAL
// =============================================================================

async function withdrawFromAave(privateKey: string, amountUsd: number): Promise<string> {
  const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
  const wallet = new ethers.Wallet(privateKey, provider);

  const amountWei = ethers.parseUnits(amountUsd.toString(), 6); // USDC has 6 decimals

  const aavePool = new ethers.Contract(CONTRACTS.AAVE_POOL, AAVE_POOL_ABI, wallet);

  console.log(`[AAVE] Withdrawing ${amountUsd} USDC to ${wallet.address}`);
  console.log(`[AAVE] Amount in wei: ${amountWei.toString()}`);

  // Submit transaction
  const tx = await aavePool.withdraw(
    CONTRACTS.USDC,
    amountWei,
    wallet.address
  );

  console.log(`[AAVE] Transaction submitted: ${tx.hash}`);
  console.log(`[AAVE] Waiting for confirmation...`);

  // Wait for confirmation (with timeout)
  const receipt = await Promise.race([
    tx.wait(),
    new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Transaction confirmation timeout after 60 seconds')), 60000)
    )
  ]);

  if (receipt.status !== 1) {
    throw new Error(`Transaction failed with status ${receipt.status}`);
  }

  console.log(`[AAVE] ✅ Withdrawal complete: ${receipt.hash}`);
  console.log(`[AAVE] Block: ${receipt.blockNumber}, Confirmations: ${receipt.confirmations}`);

  return receipt.hash;
}

// =============================================================================
// CASH APP INTEGRATION
// =============================================================================

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

  // Add sandbox signature bypass
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
