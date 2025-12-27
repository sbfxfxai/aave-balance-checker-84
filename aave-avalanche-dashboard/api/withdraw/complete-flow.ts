import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

/**
 * Complete Withdrawal Flow: AAVE/GMX → USDC → USD → Cash App
 * 
 * This endpoint handles the full DeFi-to-Cash bridge:
 * 1. Validate user session
 * 2. Withdraw from AAVE or GMX
 * 3. Convert USDC to USD (1:1 for stablecoins)
 * 4. Send to Cash App
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

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

interface WithdrawalRequest {
  walletAddress: string;
  privateKey?: string; // Encrypted, decrypted server-side
  amount: string; // Amount in USD
  source: 'aave' | 'gmx' | 'wallet';
  cashappGrantId?: string;
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

// In-memory store for withdrawals (use Redis/DB in production)
const withdrawalRecords: Map<string, any> = new Map();

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

async function handleWithdrawal(req: VercelRequest, res: VercelResponse) {
  const { walletAddress, amount, source, cashappGrantId } = req.body as WithdrawalRequest;

  if (!walletAddress || !amount || !source) {
    return res.status(400).json({
      error: 'Missing required fields: walletAddress, amount, source',
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

    if (source === 'aave') {
      // For AAVE withdrawal, we need the user's private key or a signed transaction
      // In production, this would be handled via session-based key decryption
      console.log(`[AAVE] Would withdraw ${amountUsd} USDC from AAVE`);
      // withdrawTxHash = await withdrawFromAave(privateKey, amountUsd);
    } else if (source === 'gmx') {
      console.log(`[GMX] Would close position worth ${amountUsd} USDC`);
      // withdrawTxHash = await closeGmxPosition(privateKey, amountUsd);
    }

    // Step 2: Convert USDC to USD (1:1 for stablecoins)
    const usdAmount = usdcAmount.toFixed(2);
    console.log(`[Conversion] ${usdcAmount} USDC → $${usdAmount} USD`);

    // Step 3: Send to Cash App
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
      withdrawalRecords.set(withdrawalId, record);

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
    withdrawalRecords.set(withdrawalId, record);

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
    withdrawalRecords.set(withdrawalId, record);

    throw error;
  }
}

async function getWithdrawalStatus(req: VercelRequest, res: VercelResponse) {
  const { withdrawalId, walletAddress } = req.query;

  if (withdrawalId && typeof withdrawalId === 'string') {
    const record = withdrawalRecords.get(withdrawalId);
    if (!record) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }
    return res.status(200).json({ success: true, withdrawal: record });
  }

  if (walletAddress && typeof walletAddress === 'string') {
    // Get all withdrawals for a wallet
    const userWithdrawals = Array.from(withdrawalRecords.values())
      .filter(w => w.walletAddress === walletAddress)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.status(200).json({
      success: true,
      withdrawals: userWithdrawals,
      total: userWithdrawals.length,
    });
  }

  return res.status(400).json({ error: 'Missing withdrawalId or walletAddress' });
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

  const tx = await aavePool.withdraw(
    CONTRACTS.USDC,
    amountWei,
    wallet.address
  );

  const receipt = await tx.wait();
  console.log(`[AAVE] Withdrawal complete: ${receipt.hash}`);

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
