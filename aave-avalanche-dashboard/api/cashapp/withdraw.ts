import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * POST /api/cashapp/withdraw
 * Handles withdrawal requests for Cash App
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
    const { withdrawalId, amount, currency, destinationAddress, customerId } = req.body;

    if (!withdrawalId || !amount || !currency || !destinationAddress) {
      return res.status(400).json({ 
        error: 'Missing required parameters',
        required: ['withdrawalId', 'amount', 'currency', 'destinationAddress']
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

    // Validate destination address (basic validation)
    if (typeof destinationAddress !== 'string' || destinationAddress.length < 3) {
      return res.status(400).json({ 
        error: 'Invalid destination address',
        destinationAddress
      });
    }

    // TODO: Implement actual Cash App API integration
    // For now, return a mock response
    const mockResponse = {
      success: true,
      withdrawalId,
      customerId,
      amount,
      currency,
      destinationAddress,
      status: 'processing',
      estimatedCompletion: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      createdAt: new Date().toISOString()
    };

    console.log(`[Cash App] Withdrawal initiated:`, mockResponse);

    return res.status(200).json(mockResponse);
  } catch (error) {
    console.error('[Cash App] Error processing withdrawal:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
