import type { VercelRequest, VercelResponse } from '@vercel/node';

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
    const response = await fetch('https://auth.privy.io/api/v1/analytics_events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Note: Privy analytics doesn't require auth for public events
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.text();
    
    // Forward the response with the same status
    res.status(response.status).send(data);
  } catch (error) {
    console.error('[PrivyAnalyticsProxy] Error:', error);
    res.status(500).json({ error: 'Failed to proxy analytics event' });
  }
}
