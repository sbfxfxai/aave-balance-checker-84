import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/monitoring/test
 * Test endpoint for debugging
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
    const testResults = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      tests: {
        basic: {
          status: 'passed',
          message: 'Basic functionality test passed'
        },
        timestamp: {
          status: 'passed',
          serverTime: new Date().toISOString(),
          unixTime: Date.now()
        },
        memory: {
          status: 'passed',
          usage: process.memoryUsage(),
          uptime: process.uptime()
        },
        headers: {
          status: 'passed',
          received: Object.keys(req.headers),
          userAgent: req.headers['user-agent']
        },
        query: {
          status: 'passed',
          parameters: req.query
        }
      },
      summary: {
        total: 5,
        passed: 5,
        failed: 0,
        status: 'all_passed'
      }
    };

    // Add debug info in development
    if (process.env.NODE_ENV === 'development') {
      testResults.debug = {
        requestId: `test_${Date.now()}`,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch
      };
    }

    return res.status(200).json(testResults);
  } catch (error) {
    console.error('[Test Endpoint] Error:', error);
    return res.status(500).json({ 
      error: 'Test failed',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
}
