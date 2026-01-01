import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/cashapp/config
 * Returns Cash App API configuration
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const clientId = process.env.CASHAPP_CLIENT_ID;
    const environment = process.env.CASHAPP_ENVIRONMENT || 'sandbox';

    if (!clientId) {
      return res.status(500).json({ 
        error: 'Cash App configuration not found',
        has_client_id: !!clientId
      });
    }

    // Determine API base URL based on environment
    const apiBaseUrl = environment === 'sandbox' 
      ? 'https://sandbox.api.cash.app'
      : 'https://api.cash.app';

    return res.status(200).json({
      client_id: clientId,
      environment,
      api_base_url: apiBaseUrl,
    });
  } catch (error) {
    console.error('[Cash App Config] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
