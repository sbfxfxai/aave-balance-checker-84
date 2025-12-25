import type { VercelRequest, VercelResponse } from '@vercel/node';

// Cache for AVAX price (60 second TTL)
let cachedPrice: { price: number; source: string; timestamp: number } | null = null;
const CACHE_TTL = 60000; // 60 seconds

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

  // Check cache first
  if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_TTL) {
    console.log('[Price API] Returning cached price:', cachedPrice.price);
    return res.status(200).json(cachedPrice);
  }

  // Try CoinGecko first
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd'
    );
    
    if (response.ok) {
      const data = await response.json();
      const price = data['avalanche-2']?.usd;
      
      if (price && typeof price === 'number') {
        cachedPrice = { price, source: 'coingecko', timestamp: Date.now() };
        console.log('[Price API] CoinGecko price:', price);
        return res.status(200).json(cachedPrice);
      }
    }
  } catch (error) {
    console.error('[Price API] CoinGecko failed:', error);
  }

  // Fallback to CoinCap
  try {
    const response = await fetch('https://api.coincap.io/v2/assets/avalanche');
    
    if (response.ok) {
      const data = await response.json();
      const price = parseFloat(data.data?.priceUsd);
      
      if (price && !isNaN(price)) {
        cachedPrice = { price, source: 'coincap', timestamp: Date.now() };
        console.log('[Price API] CoinCap price:', price);
        return res.status(200).json(cachedPrice);
      }
    }
  } catch (error) {
    console.error('[Price API] CoinCap failed:', error);
  }

  // Return error if both APIs fail
  console.error('[Price API] All price sources failed');
  return res.status(503).json({ 
    error: 'Unable to fetch AVAX price',
    message: 'All price APIs are unavailable'
  });
}
