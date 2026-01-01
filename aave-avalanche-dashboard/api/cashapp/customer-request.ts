import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * POST /api/cashapp/customer-request
 * Handles customer requests for Cash App
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
    const { customerId, amount, currency, requestId } = req.body;

    if (!customerId || !amount || !currency) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['customerId', 'amount', 'currency']
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
      requestId: requestId || `req_${Date.now()}`,
      customerId,
      amount,
      currency,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    console.log(`[Cash App] Customer request created:`, mockResponse);

    return res.status(200).json(mockResponse);
  } catch (error) {
    console.error('[Cash App] Error creating customer request:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
