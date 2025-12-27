import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CASHAPP_CONFIG, getCashAppHeaders, generateIdempotencyKey } from './config';

interface PaymentRequestBody {
  amount: number; // Amount in cents
  grantId: string; // Grant ID from approved customer request
  referenceId: string; // External reference (e.g., withdrawal ID)
  capture?: boolean; // Whether to capture immediately (default: true)
}

interface PaymentResponse {
  id: string;
  status: string;
  amount: number;
  currency: string;
  created_at: string;
}

// Create a payment (withdrawal to Cash App)
async function createPayment(
  amount: number,
  grantId: string,
  referenceId: string,
  capture: boolean = true
): Promise<PaymentResponse> {
  const response = await fetch(
    `${CASHAPP_CONFIG.BASE_URL}/network/v1/payments`,
    {
      method: 'POST',
      headers: getCashAppHeaders(false), // Server-side API
      body: JSON.stringify({
        payment: {
          capture,
          amount,
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

  return response.json();
}

// Refund a payment
async function refundPayment(paymentId: string, amount?: number): Promise<PaymentResponse> {
  const response = await fetch(
    `${CASHAPP_CONFIG.BASE_URL}/network/v1/payments/${paymentId}/refund`,
    {
      method: 'POST',
      headers: getCashAppHeaders(false),
      body: JSON.stringify({
        amount, // Optional: partial refund amount
        idempotency_key: generateIdempotencyKey(),
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cash App Refund API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, grantId, referenceId, capture } = req.body as PaymentRequestBody;

    if (!amount || !grantId || !referenceId) {
      return res.status(400).json({ 
        error: 'Missing required fields: amount, grantId, referenceId' 
      });
    }

    // Validate amount (must be positive)
    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    const result = await createPayment(amount, grantId, referenceId, capture ?? true);

    return res.status(200).json({
      success: true,
      paymentId: result.id,
      status: result.status,
      amount: result.amount,
      currency: result.currency,
      createdAt: result.created_at,
    });
  } catch (error) {
    console.error('Cash App payment error:', error);
    return res.status(500).json({
      error: 'Failed to process Cash App payment',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
