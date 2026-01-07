import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CASHAPP_CONFIG, getCashAppHeaders, generateIdempotencyKey } from './config';
import { getRedis } from '../utils/redis';

/**
 * Cash App Withdrawal Endpoint
 * 
 * Flow:
 * 1. User initiates withdrawal from frontend
 * 2. USDC is swapped to USD (via Trader Joe or similar)
 * 3. Customer request is created for Cash App linking
 * 4. User approves via QR code or mobile link
 * 5. Payment is created to send USD to user's Cash App
 * 
 * This endpoint handles the full withdrawal flow.
 */

interface WithdrawRequestBody {
  walletAddress: string;
  amountUsd: number; // Amount in USD (will be converted to cents)
  grantId?: string; // If user already has a linked Cash App grant
}

interface WithdrawalRecord {
  id: string;
  walletAddress: string;
  amountUsd: number;
  amountCents: number;
  status: 'pending_link' | 'pending_payment' | 'completed' | 'failed';
  customerRequestId?: string;
  grantId?: string;
  paymentId?: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

// Redis-based withdrawal storage (persistent across server restarts)
const CASHAPP_WITHDRAWAL_TTL = 90 * 24 * 60 * 60; // 90 days TTL for withdrawal records
const CASHAPP_WITHDRAWAL_LIST_TTL = 365 * 24 * 60 * 60; // 1 year for user withdrawal lists

/**
 * Store Cash App withdrawal record in Redis
 */
async function storeCashAppWithdrawal(withdrawalId: string, record: WithdrawalRecord): Promise<void> {
  const redis = getRedis();
  // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
  await redis.set(`cashapp_withdrawal:${withdrawalId}`, JSON.stringify(record), { ex: CASHAPP_WITHDRAWAL_TTL });
  
  // Also maintain a list of withdrawals per wallet for quick lookup
  if (record.walletAddress) {
    const walletKey = `cashapp_withdrawals:${record.walletAddress.toLowerCase()}`;
    // @ts-ignore - @upstash/redis types may not include lpush method in some TypeScript versions, but it exists at runtime
    await redis.lpush(walletKey, withdrawalId);
    // @ts-ignore - @upstash/redis types may not include expire method in some TypeScript versions, but it exists at runtime
    await redis.expire(walletKey, CASHAPP_WITHDRAWAL_LIST_TTL);
  }
}

/**
 * Get Cash App withdrawal record from Redis
 */
async function getCashAppWithdrawal(withdrawalId: string): Promise<WithdrawalRecord | null> {
  const redis = getRedis();
  // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
  const data = await redis.get(`cashapp_withdrawal:${withdrawalId}`);
  if (!data) return null;
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    // Validate that parsed data has required fields
    if (parsed && typeof parsed === 'object' && 'id' in parsed && 'walletAddress' in parsed) {
      return parsed as WithdrawalRecord;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get all Cash App withdrawals for a wallet from Redis
 */
async function getCashAppWalletWithdrawals(walletAddress: string): Promise<WithdrawalRecord[]> {
  const redis = getRedis();
  const walletKey = `cashapp_withdrawals:${walletAddress.toLowerCase()}`;
  // @ts-ignore - @upstash/redis types may not include lrange method in some TypeScript versions, but it exists at runtime
  const withdrawalIds = await redis.lrange(walletKey, 0, -1) as string[];
  
  if (!withdrawalIds || withdrawalIds.length === 0) {
    return [];
  }
  
  // Fetch all withdrawal records
  const withdrawals = await Promise.all(
    withdrawalIds.map(async (id: string) => {
      const record = await getCashAppWithdrawal(id);
      return record;
    })
  );
  
  // Filter out nulls and sort by creation date (newest first)
  return withdrawals
    .filter((w: WithdrawalRecord | null): w is WithdrawalRecord => w !== null)
    .sort((a: WithdrawalRecord, b: WithdrawalRecord) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Create customer request for Cash App linking
async function createCustomerRequest(
  amountCents: number,
  referenceId: string
): Promise<{ requestId: string; qrCodeUrl: string; mobileUrl: string }> {
  const response = await fetch(
    `${CASHAPP_CONFIG.BASE_URL}/customer-request/v1/requests`,
    {
      method: 'POST',
      headers: getCashAppHeaders(true),
      body: JSON.stringify({
        request: {
          actions: [
            {
              amount: amountCents,
              currency: 'USD',
              scope_id: CASHAPP_CONFIG.MERCHANT_ID || CASHAPP_CONFIG.BRAND_ID || CASHAPP_CONFIG.CLIENT_ID,
              type: 'ONE_TIME_PAYMENT',
            },
          ],
          reference_id: referenceId,
          channel: 'ONLINE',
        },
        idempotency_key: generateIdempotencyKey(),
      }),
    }
  );

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

// Create payment to send funds to Cash App
async function createPayment(
  amountCents: number,
  grantId: string,
  referenceId: string
): Promise<{ paymentId: string; status: string }> {
  const response = await fetch(
    `${CASHAPP_CONFIG.BASE_URL}/network/v1/payments`,
    {
      method: 'POST',
      headers: getCashAppHeaders(false),
      body: JSON.stringify({
        payment: {
          capture: true,
          amount: amountCents,
          currency: 'USD',
          merchant_id: CASHAPP_CONFIG.MERCHANT_ID,
          grant_id: grantId,
          reference_id: referenceId,
        },
        idempotency_key: generateIdempotencyKey(),
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cash App Payment API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return {
    paymentId: data.id,
    status: data.status,
  };
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
      const { walletAddress, amountUsd, grantId } = req.body as WithdrawRequestBody;

      if (!walletAddress || !amountUsd) {
        return res.status(400).json({ 
          error: 'Missing required fields: walletAddress, amountUsd' 
        });
      }

      if (amountUsd < 1) {
        return res.status(400).json({ error: 'Minimum withdrawal is $1' });
      }

      const amountCents = Math.round(amountUsd * 100);
      const withdrawalId = `WD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // If user already has a grant (linked Cash App), process payment directly
      if (grantId) {
        try {
          const payment = await createPayment(amountCents, grantId, withdrawalId);
          
          const record: WithdrawalRecord = {
            id: withdrawalId,
            walletAddress,
            amountUsd,
            amountCents,
            status: payment.status === 'COMPLETED' ? 'completed' : 'pending_payment',
            grantId,
            paymentId: payment.paymentId,
            createdAt: new Date().toISOString(),
            completedAt: payment.status === 'COMPLETED' ? new Date().toISOString() : undefined,
          };
          
          await storeCashAppWithdrawal(withdrawalId, record);

          return res.status(200).json({
            success: true,
            withdrawalId,
            status: record.status,
            paymentId: payment.paymentId,
            amountUsd,
            message: 'Withdrawal processed. Funds sent to your Cash App.',
          });
        } catch (error) {
          return res.status(500).json({
            error: 'Payment failed',
            details: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // No grant - need to create customer request for linking
      const customerRequest = await createCustomerRequest(amountCents, withdrawalId);

      const record: WithdrawalRecord = {
        id: withdrawalId,
        walletAddress,
        amountUsd,
        amountCents,
        status: 'pending_link',
        customerRequestId: customerRequest.requestId,
        createdAt: new Date().toISOString(),
      };

      await storeCashAppWithdrawal(withdrawalId, record);

      return res.status(200).json({
        success: true,
        withdrawalId,
        status: 'pending_link',
        customerRequestId: customerRequest.requestId,
        qrCodeUrl: customerRequest.qrCodeUrl,
        mobileUrl: customerRequest.mobileUrl,
        amountUsd,
        message: 'Scan the QR code or tap the link to connect your Cash App and receive funds.',
      });
    }

    if (req.method === 'GET') {
      const { withdrawalId } = req.query;

      if (!withdrawalId || typeof withdrawalId !== 'string') {
        return res.status(400).json({ error: 'Missing withdrawalId query parameter' });
      }

      const record = await getCashAppWithdrawal(withdrawalId);
      
      if (!record) {
        return res.status(404).json({ error: 'Withdrawal not found' });
      }

      return res.status(200).json({
        success: true,
        withdrawal: record,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Cash App withdrawal error:', error);
    return res.status(500).json({
      error: 'Failed to process withdrawal',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
