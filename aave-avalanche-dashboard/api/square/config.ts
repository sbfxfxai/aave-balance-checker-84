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
    // Backend can use SQUARE_APPLICATION_ID or fallback to VITE_SQUARE_APPLICATION_ID (same value)
    const applicationId = process.env.SQUARE_APPLICATION_ID || process.env.VITE_SQUARE_APPLICATION_ID;
    const locationId = process.env.SQUARE_LOCATION_ID;
    const environment = process.env.SQUARE_ENVIRONMENT || 'production';
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;

    // Return config even if incomplete (frontend will handle validation)
    // This allows the frontend to use env vars as fallback
    if (!applicationId || !locationId) {
      console.warn('[Square Config] Missing config:', {
        hasAppId: !!applicationId,
        hasLocationId: !!locationId,
        hasAccessToken: !!accessToken
      });
      
      // Return partial config instead of 500 - frontend can use env vars
      return res.status(200).json({
        application_id: applicationId || '',
        location_id: locationId || '',
        environment,
        api_base_url: environment === 'sandbox' 
          ? 'https://connect.squareupsandbox.com'
          : 'https://connect.squareup.com',
        has_access_token: !!accessToken,
        incomplete: !applicationId || !locationId
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

