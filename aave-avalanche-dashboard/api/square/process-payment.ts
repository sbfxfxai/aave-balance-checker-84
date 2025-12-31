import { VercelRequest, VercelResponse } from '@vercel/node';

// Square configuration
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN || '';
const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID || '';
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'production';
const SQUARE_API_BASE_URL = SQUARE_ENVIRONMENT === 'sandbox' 
  ? 'https://connect.squareupsandbox.com'
  : 'https://connect.squareup.com';
const SQUARE_API_VERSION = process.env.SQUARE_API_VERSION || '2024-10-16';

interface ProcessPaymentRequest {
  source_id?: string;
  sourceId?: string;
  token?: string;
  amount: number;
  currency?: string;
  idempotency_key?: string;
  idempotencyKey?: string;
  orderId?: string;
  payment_id?: string;
  wallet_address?: string;
  user_email?: string;
  risk_profile?: string;
  include_ergc?: number;
  use_existing_ergc?: number;
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
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('[ProcessPayment] Request body keys:', Object.keys(req.body || {}));
    
    const body = req.body as ProcessPaymentRequest;
    
    // Extract source_id (accept multiple field names)
    const sourceId = body.source_id || body.sourceId || body.token;
    const amount = body.amount;
    const currency = (body.currency || 'USD').toUpperCase();
    const idempotencyKey = body.idempotency_key || body.idempotencyKey || body.orderId;
    const paymentId = body.payment_id;
    const walletAddress = body.wallet_address;
    const userEmail = body.user_email;
    const riskProfile = body.risk_profile;
    const includeErgc = body.include_ergc;
    const useExistingErgc = body.use_existing_ergc;

    // Validate required fields
    if (!sourceId) {
      return res.status(400).json({ error: 'Missing required field: source_id (or sourceId/token)' });
    }
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Missing or invalid amount' });
    }

    // Validate Square credentials
    if (!SQUARE_ACCESS_TOKEN) {
      console.error('[ProcessPayment] SQUARE_ACCESS_TOKEN not configured');
      return res.status(500).json({ error: 'Square API not configured' });
    }
    if (!SQUARE_LOCATION_ID) {
      console.error('[ProcessPayment] SQUARE_LOCATION_ID not configured');
      return res.status(500).json({ error: 'Square location not configured' });
    }

    // Generate idempotency key if not provided
    const finalIdempotencyKey = idempotencyKey || `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    // Convert amount to cents
    const amountCents = Math.round(amount * 100);

    // Build payment note for webhook
    const noteParts: string[] = [];
    if (paymentId) {
      noteParts.push(`payment_id:${paymentId}`);
    }
    if (walletAddress) {
      noteParts.push(`wallet:${walletAddress.toLowerCase()}`);
    }
    if (riskProfile) {
      noteParts.push(`risk:${riskProfile}`);
    }
    if (userEmail) {
      noteParts.push(`email:${userEmail.trim().toLowerCase()}`);
    }
    if (includeErgc !== undefined) {
      noteParts.push(`ergc:${Math.floor(includeErgc)}`);
    }
    if (useExistingErgc !== undefined) {
      noteParts.push(`debit_ergc:${Math.floor(useExistingErgc)}`);
    }

    // Prepare Square API payload
    const squarePayload: any = {
      source_id: sourceId,
      idempotency_key: finalIdempotencyKey,
      amount_money: {
        amount: amountCents,
        currency: currency,
      },
      location_id: SQUARE_LOCATION_ID,
      autocomplete: true,
    };

    if (noteParts.length > 0) {
      squarePayload.note = noteParts.join(' ');
    }

    console.log('[ProcessPayment] Calling Square API:', {
      environment: SQUARE_ENVIRONMENT,
      amount: `$${amount} (${amountCents} cents)`,
      locationId: SQUARE_LOCATION_ID,
      hasNote: !!squarePayload.note,
      paymentId: paymentId || 'none',
    });

    // Call Square Payments API
    const squareResponse = await fetch(`${SQUARE_API_BASE_URL}/v2/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Square-Version': SQUARE_API_VERSION,
      },
      body: JSON.stringify(squarePayload),
    });

    const responseData = await squareResponse.json();

    if (!squareResponse.ok) {
      const errors = responseData.errors || [];
      const errorMessage = errors[0]?.detail || `Square API error: ${squareResponse.status}`;
      const errorCode = errors[0]?.code || 'UNKNOWN';
      
      console.error('[ProcessPayment] Square API error:', {
        status: squareResponse.status,
        code: errorCode,
        message: errorMessage,
      });

      return res.status(squareResponse.status).json({
        success: false,
        error: errorMessage,
        code: `SQUARE_${errorCode}`,
      });
    }

    // Extract payment data
    const payment = responseData.payment || {};
    const squarePaymentId = payment.id;
    const paymentStatus = payment.status;

    console.log('[ProcessPayment] Payment processed successfully:', {
      squarePaymentId,
      status: paymentStatus,
      paymentId: paymentId || 'none',
    });

    return res.status(200).json({
      success: true,
      payment_id: squarePaymentId,
      status: paymentStatus,
      order_id: payment.order_id,
      transaction_id: squarePaymentId,
      message: 'Payment processed successfully',
      amount_money: payment.amount_money,
    });

  } catch (error: any) {
    console.error('[ProcessPayment] Error:', error);
    
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      message: error.message || 'Unknown error occurred'
    });
  }
}
