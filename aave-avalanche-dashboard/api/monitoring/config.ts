import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/monitoring/config
 * Returns monitoring configuration
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
    const config = {
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0',
      features: {
        monitoring: true,
        healthChecks: true,
        metrics: true,
        debugging: process.env.NODE_ENV === 'development'
      },
      endpoints: {
        health: '/api/monitoring/health',
        config: '/api/monitoring/config',
        dashboard: '/api/monitoring/dashboard',
        test: '/api/monitoring/test'
      },
      thresholds: {
        responseTime: 2000, // ms
        errorRate: 0.05, // 5%
        uptime: 0.99 // 99%
      }
    };

    return res.status(200).json(config);
  } catch (error) {
    console.error('[Monitoring Config] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
