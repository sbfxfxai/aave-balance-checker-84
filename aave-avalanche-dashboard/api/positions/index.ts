import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPositionsByEmail, getPositionsByWallet, getAllPositions } from './store';

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
    const email = req.query.email as string;
    const wallet = req.query.wallet as string;
    
    // Fetch by Wallet Address
    if (wallet) {
      const positions = await getPositionsByWallet(wallet);
      return res.status(200).json({
        success: true,
        wallet,
        positions,
        count: positions.length,
      });
    }

    // Fetch by Email
    if (email) {
      const positions = await getPositionsByEmail(email);
      return res.status(200).json({
        success: true,
        email,
        positions,
        count: positions.length,
      });
    }

    // Return all positions (admin view)
    const positions = await getAllPositions();
    return res.status(200).json({ 
      success: true, 
      positions,
      count: positions.length 
    });

  } catch (error) {
    console.error('[Positions API] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
