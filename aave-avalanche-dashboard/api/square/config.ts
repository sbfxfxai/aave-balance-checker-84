import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/square/config
 * Returns Square API configuration (application ID, location ID, etc.)
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
    const applicationId = process.env.SQUARE_APPLICATION_ID;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const environment = process.env.SQUARE_ENVIRONMENT || 'production';
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;

    if (!applicationId || !locationId) {
      return res.status(500).json({ 
        error: 'Square configuration not found',
        has_access_token: !!accessToken
      });
    }

    // Determine API base URL based on environment
    const apiBaseUrl = environment === 'sandbox' 
      ? 'https://connect.squareupsandbox.com'
      : 'https://connect.squareup.com';

    return res.status(200).json({
      application_id: applicationId,
      location_id: locationId,
      environment,
      api_base_url: apiBaseUrl,
      has_access_token: !!accessToken,
    });
  } catch (error) {
    console.error('[Square Config] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

