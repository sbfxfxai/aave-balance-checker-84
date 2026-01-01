import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/monitoring/health
 * Basic health check endpoint
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
    const startTime = Date.now();
    
    // Basic health checks
    const healthChecks = {
      server: true,
      memory: process.memoryUsage().heapUsed < 500 * 1024 * 1024, // < 500MB
      uptime: process.uptime() > 0
    };

    const allHealthy = Object.values(healthChecks).every(check => check === true);
    const responseTime = Date.now() - startTime;

    const healthData = {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: responseTime,
      checks: healthChecks,
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };

    return res.status(allHealthy ? 200 : 503).json(healthData);
  } catch (error) {
    console.error('[Health Check] Error:', error);
    return res.status(503).json({ 
      status: 'unhealthy',
      error: 'Health check failed',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
}
