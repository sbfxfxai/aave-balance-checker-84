import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  console.log('[Test] Endpoint hit:', req.method, req.url);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ 
    message: 'Test endpoint works!',
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString()
  });
}

