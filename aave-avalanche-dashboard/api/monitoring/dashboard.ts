import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/monitoring/dashboard
 * Returns dashboard metrics and status
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
    // Mock dashboard data - in production, this would aggregate real metrics
    const dashboardData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      
      // System metrics
      system: {
        memory: {
          used: Math.random() * 100, // Mock data
          total: 512,
          unit: 'MB'
        },
        cpu: {
          usage: Math.random() * 100, // Mock data
          cores: 1
        }
      },
      
      // API metrics
      api: {
        endpoints: {
          total: 15,
          healthy: 15,
          unhealthy: 0
        },
        requests: {
          total: Math.floor(Math.random() * 10000),
          success: Math.floor(Math.random() * 9500),
          errors: Math.floor(Math.random() * 500)
        },
        responseTime: {
          average: Math.random() * 500 + 100, // 100-600ms
          p95: Math.random() * 1000 + 200 // 200-1200ms
        }
      },
      
      // Business metrics
      business: {
        users: {
          total: Math.floor(Math.random() * 1000),
          active: Math.floor(Math.random() * 500),
          newToday: Math.floor(Math.random() * 50)
        },
        transactions: {
          total: Math.floor(Math.random() * 5000),
          today: Math.floor(Math.random() * 100),
          volume: Math.random() * 100000
        }
      },
      
      // Health checks
      healthChecks: {
        database: 'healthy',
        redis: 'healthy',
        externalApis: 'healthy',
        blockchain: 'healthy'
      }
    };

    return res.status(200).json(dashboardData);
  } catch (error) {
    console.error('[Monitoring Dashboard] Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
}
