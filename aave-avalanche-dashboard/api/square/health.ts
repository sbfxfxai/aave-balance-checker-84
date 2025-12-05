import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(200).json({
    status: 'healthy',
    service: 'square-payment-api',
    environment: {
      SQUARE_ACCESS_TOKEN: process.env.SQUARE_ACCESS_TOKEN ? 'set' : 'MISSING',
      SQUARE_LOCATION_ID: process.env.SQUARE_LOCATION_ID ? 'set' : 'MISSING',
      SQUARE_ENVIRONMENT: process.env.SQUARE_ENVIRONMENT || 'not_set',
    },
  });
}

