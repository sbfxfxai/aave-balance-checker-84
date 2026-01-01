import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * POST /api/cashapp/payment
 * Handles payment processing for Cash App
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { paymentId, amount, currency, customerId, metadata } = req.body;

    if (!paymentId || !amount || !currency) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['paymentId', 'amount', 'currency']
      });
    }

    // Validate amount
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ 
        error: 'Invalid amount',
        amount
      });
    }

    // Validate currency
    if (currency !== 'USD') {
      return res.status(400).json({ 
        error: 'Unsupported currency',
        supported: ['USD']
      });
    }

    // TODO: Implement actual Cash App API integration
    // For now, return a mock response
    const mockResponse = {
      success: true,
      paymentId,
      customerId,
      amount,
      currency,
      status: 'completed',
      metadata: metadata || {},
      processedAt: new Date().toISOString()
    };

    console.log(`[Cash App] Payment processed:`, mockResponse);

    return res.status(200).json(mockResponse);
  } catch (error) {
    console.error('[Cash App] Error processing payment:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
