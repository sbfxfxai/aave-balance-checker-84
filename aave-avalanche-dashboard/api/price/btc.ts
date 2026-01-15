import type { VercelRequest, VercelResponse } from '@vercel/node';

// Price cache with TTL
interface PriceCache {
  price: number;
  source: string;
  timestamp: number;
  confidence: 'high' | 'medium' | 'low';
}

let cachedPrice: PriceCache | null = null;
const CACHE_TTL = 60000; // 60 seconds
const STALE_CACHE_TTL = 300000; // 5 minutes - serve stale data if APIs fail
const REQUEST_TIMEOUT = 5000; // 5 second timeout per API

// Rate limiting for price fetching (prevents API abuse)
const fetchLog = new Map<string, number>();
const MAX_REQUESTS_PER_MINUTE = 100;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const recentRequests = Array.from(fetchLog.entries())
    .filter(([_, time]) => now - time < 60000);
  
  fetchLog.clear();
  recentRequests.forEach(([ip, time]) => fetchLog.set(ip, time));
  
  const ipRequests = recentRequests.filter(([reqIp]) => reqIp === ip).length;
  
  if (ipRequests >= MAX_REQUESTS_PER_MINUTE) {
    return false;
  }
  
  fetchLog.set(`${ip}_${now}`, now);
  return true;
}

function setCorsHeaders(res: VercelResponse): void {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '3600');
}

async function fetchWithTimeout(url: string, timeout: number, headers?: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: headers || {}
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

interface PriceSource {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  fetch: () => Promise<number | null>;
}

async function fetchCoinGecko(): Promise<number | null> {
  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const baseUrl = apiKey 
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
    
    const url = `${baseUrl}/simple/price?ids=bitcoin&vs_currencies=usd`;
    const headers = apiKey ? { 'x-cg-pro-api-key': apiKey } : undefined;
    
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT, headers);
    
    if (!response.ok) {
      console.error(`[BTC Price API] CoinGecko HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const price = data.bitcoin?.usd;
    
    if (typeof price === 'number' && price > 0) {
      return price;
    }
    
    return null;
  } catch (error) {
    console.error('[BTC Price API] CoinGecko error:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}

async function fetchCoinCap(): Promise<number | null> {
  try {
    const response = await fetchWithTimeout(
      'https://api.coincap.io/v2/assets/bitcoin',
      REQUEST_TIMEOUT
    );
    
    if (!response.ok) {
      console.error(`[BTC Price API] CoinCap HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const price = parseFloat(data.data?.price);
    
    if (typeof price === 'number' && price > 0) {
      return price;
    }
    
    return null;
  } catch (error) {
    console.error('[BTC Price API] CoinCap error:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}

async function fetchCryptoCompare(): Promise<number | null> {
  try {
    const apiKey = process.env.CRYPTOCOMPARE_API_KEY;
    const url = apiKey
      ? `https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD&api_key=${apiKey}`
      : 'https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD';
    
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      console.error(`[BTC Price API] CryptoCompare HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const price = data.USD;
    
    if (typeof price === 'number' && price > 0) {
      return price;
    }
    
    return null;
  } catch (error) {
    console.error('[BTC Price API] CryptoCompare error:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}

async function fetchPriceWithFallback(): Promise<PriceCache | null> {
  const sources: PriceSource[] = [
    { name: 'coingecko', confidence: 'high', fetch: fetchCoinGecko },
    { name: 'coincap', confidence: 'high', fetch: fetchCoinCap },
    { name: 'cryptocompare', confidence: 'medium', fetch: fetchCryptoCompare },
  ];
  
  // Try sources in order of confidence
  for (const source of sources) {
    try {
      const price = await source.fetch();
      if (price !== null) {
        return {
          price,
          source: source.name,
          timestamp: Date.now(),
          confidence: source.confidence,
        };
      }
    } catch (error) {
      console.error(`[BTC Price API] ${source.name} failed:`, error instanceof Error ? error.message : 'Unknown');
      continue;
    }
  }
  
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  
  try {
    const clientIP = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
    const ip = Array.isArray(clientIP) ? clientIP[0] : clientIP;
    
    // Check rate limit
    if (!checkRateLimit(ip as string)) {
      res.status(429).json({ 
        error: 'Rate limit exceeded',
        message: 'Too many requests. Please try again later.'
      });
      return;
    }
    
    const now = Date.now();
    
    // Return cached price if still valid
    if (cachedPrice && (now - cachedPrice.timestamp) < CACHE_TTL) {
      res.status(200).json({
        price: cachedPrice.price,
        source: cachedPrice.source,
        timestamp: cachedPrice.timestamp,
        confidence: cachedPrice.confidence,
        cached: true,
      });
      return;
    }
    
    // Try to fetch fresh price
    const freshPrice = await fetchPriceWithFallback();
    
    if (freshPrice) {
      cachedPrice = freshPrice;
      res.status(200).json({
        price: freshPrice.price,
        source: freshPrice.source,
        timestamp: freshPrice.timestamp,
        confidence: freshPrice.confidence,
        cached: false,
      });
      return;
    }
    
    // If all sources failed, try to return stale cache
    if (cachedPrice && (now - cachedPrice.timestamp) < STALE_CACHE_TTL) {
      console.warn('[BTC Price API] All sources failed, serving stale cache');
      res.status(200).json({
        price: cachedPrice.price,
        source: cachedPrice.source,
        timestamp: cachedPrice.timestamp,
        confidence: cachedPrice.confidence,
        cached: true,
        stale: true,
      });
      return;
    }
    
    // No cache available and all sources failed
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Unable to fetch BTC price from any source. Please try again later.',
    });
    
  } catch (error) {
    console.error('[BTC Price API] Handler error:', error);
    
    // Try to return stale cache on error
    if (cachedPrice) {
      res.status(200).json({
        price: cachedPrice.price,
        source: cachedPrice.source,
        timestamp: cachedPrice.timestamp,
        confidence: cachedPrice.confidence,
        cached: true,
        stale: true,
      });
      return;
    }
    
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
