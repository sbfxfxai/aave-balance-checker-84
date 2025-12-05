import { VercelRequest, VercelResponse } from '@vercel/node';

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID;
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';

const SQUARE_API_BASE = SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

interface PaymentRequest {
  sourceId: string;
  amount: number;
  currency?: string;
  riskProfile?: string;
  idempotency_key?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate environment variables
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    console.error('[Square API] Missing Square configuration:', {
      hasToken: !!SQUARE_ACCESS_TOKEN,
      hasLocation: !!SQUARE_LOCATION_ID,
    });
    return res.status(500).json({
      success: false,
      error: 'Square API not configured. Please set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID',
    });
  }

  try {
    const { source_id, sourceId, amount, currency = 'USD', riskProfile, idempotency_key } = req.body as PaymentRequest & { source_id?: string };

    // Support both source_id and sourceId for compatibility
    const token = source_id || sourceId;
    
    if (!token || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sourceId (or source_id) and amount',
      });
    }

    // Convert amount to cents (Square expects integer amounts in smallest currency unit)
    const amountInCents = Math.round(amount * 100);

    if (amountInCents <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be greater than zero',
      });
    }

    console.log('[Square API] Processing payment:', {
      amount: amountInCents,
      currency,
      riskProfile,
      environment: SQUARE_ENVIRONMENT,
    });

    // Create payment with Square
    const squareResponse = await fetch(`${SQUARE_API_BASE}/v2/payments`, {
      method: 'POST',
      headers: {
        'Square-Version': '2024-12-18',
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_id: token,
        idempotency_key: idempotency_key || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        amount_money: {
          amount: amountInCents,
          currency: currency,
        },
        location_id: SQUARE_LOCATION_ID,
        autocomplete: true,
        note: riskProfile ? `Aave deposit - ${riskProfile} strategy` : undefined,
      }),
    });

    const squareData = await squareResponse.json();

    if (!squareResponse.ok) {
      console.error('[Square API] Square API error:', squareData);
      const errorDetail = squareData.errors?.[0]?.detail || 'Payment failed';
      return res.status(squareResponse.status).json({
        success: false,
        error: errorDetail,
        details: squareData.errors,
      });
    }

    console.log('[Square API] Payment successful:', {
      paymentId: squareData.payment?.id,
      status: squareData.payment?.status,
    });

    return res.status(200).json({
      success: true,
      payment_id: squareData.payment?.id,
      paymentId: squareData.payment?.id,
      status: squareData.payment?.status,
      amount: amount,
      currency: currency,
      transaction_id: squareData.payment?.id,
    });
  } catch (error) {
    console.error('[Square API] Payment processing error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

