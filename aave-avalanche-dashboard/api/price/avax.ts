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

async function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, { signal: controller.signal });
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
    
    const url = `${baseUrl}/simple/price?ids=avalanche-2&vs_currencies=usd`;
    const headers = apiKey ? { 'x-cg-pro-api-key': apiKey } : {};
    
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      console.error(`[Price API] CoinGecko HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const price = data['avalanche-2']?.usd;
    
    if (typeof price === 'number' && price > 0) {
      return price;
    }
    
    return null;
  } catch (error) {
    console.error('[Price API] CoinGecko error:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}

async function fetchCoinCap(): Promise<number | null> {
  try {
    const response = await fetchWithTimeout(
      'https://api.coincap.io/v2/assets/avalanche',
      REQUEST_TIMEOUT
    );
    
    if (!response.ok) {
      console.error(`[Price API] CoinCap HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const price = parseFloat(data.data?.priceUsd);
    
    if (!isNaN(price) && price > 0) {
      return price;
    }
    
    return null;
  } catch (error) {
    console.error('[Price API] CoinCap error:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}

async function fetchBinance(): Promise<number | null> {
  try {
    const response = await fetchWithTimeout(
      'https://api.binance.com/api/v3/ticker/price?symbol=AVAXUSDT',
      REQUEST_TIMEOUT
    );
    
    if (!response.ok) {
      console.error(`[Price API] Binance HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const price = parseFloat(data.price);
    
    if (!isNaN(price) && price > 0) {
      return price;
    }
    
    return null;
  } catch (error) {
    console.error('[Price API] Binance error:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}

async function fetchCryptoCompare(): Promise<number | null> {
  try {
    const apiKey = process.env.CRYPTOCOMPARE_API_KEY;
    const url = 'https://min-api.cryptocompare.com/data/price?fsym=AVAX&tsyms=USD';
    const headers = apiKey ? { authorization: `Apikey ${apiKey}` } : {};
    
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT);
    
    if (!response.ok) {
      console.error(`[Price API] CryptoCompare HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    const price = data.USD;
    
    if (typeof price === 'number' && price > 0) {
      return price;
    }
    
    return null;
  } catch (error) {
    console.error('[Price API] CryptoCompare error:', error instanceof Error ? error.message : 'Unknown');
    return null;
  }
}

async function fetchPriceWithFallback(): Promise<PriceCache | null> {
  const sources: PriceSource[] = [
    { name: 'coingecko', confidence: 'high', fetch: fetchCoinGecko },
    { name: 'binance', confidence: 'high', fetch: fetchBinance },
    { name: 'coincap', confidence: 'medium', fetch: fetchCoinCap },
    { name: 'cryptocompare', confidence: 'medium', fetch: fetchCryptoCompare },
  ];
  
  // Try sources in order, return first success
  for (const source of sources) {
    const price = await source.fetch();
    if (price !== null) {
      console.log(`[Price API] ${source.name} success: $${price}`);
      return {
        price,
        source: source.name,
        timestamp: Date.now(),
        confidence: source.confidence,
      };
    }
  }
  
  // If all sources fail, try to aggregate multiple sources in parallel
  console.log('[Price API] Attempting parallel fetch from all sources');
  const results = await Promise.allSettled(sources.map(s => s.fetch()));
  
  const prices = results
    .filter((r): r is PromiseFulfilledResult<number> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
  
  if (prices.length > 0) {
    // Use median price for better accuracy
    prices.sort((a, b) => a - b);
    const medianPrice = prices[Math.floor(prices.length / 2)];
    
    console.log(`[Price API] Aggregated from ${prices.length} sources: $${medianPrice}`);
    return {
      price: medianPrice,
      source: `aggregated_${prices.length}_sources`,
      timestamp: Date.now(),
      confidence: prices.length >= 2 ? 'high' : 'low',
    };
  }
  
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  
  // CORS
  setCorsHeaders(res);
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed',
      allowed: ['GET', 'OPTIONS']
    });
  }
  
  try {
    const clientIp = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown') as string;
    
    // Rate limiting
    if (!checkRateLimit(clientIp)) {
      console.warn('[Price API] Rate limit exceeded', { ip: clientIp });
      return res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: `Maximum ${MAX_REQUESTS_PER_MINUTE} requests per minute` 
      });
    }
    
    // Check fresh cache first
    if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_TTL) {
      const responseTime = Date.now() - startTime;
      console.log('[Price API] Returning cached price:', cachedPrice.price);
      
      return res
        .setHeader('Cache-Control', `public, max-age=${Math.floor((CACHE_TTL - (Date.now() - cachedPrice.timestamp)) / 1000)}`)
        .status(200)
        .json({
          success: true,
          ...cachedPrice,
          cached: true,
          responseTime: `${responseTime}ms` 
        });
    }
    
    // Fetch new price
    const newPrice = await fetchPriceWithFallback();
    
    if (newPrice) {
      cachedPrice = newPrice;
      const responseTime = Date.now() - startTime;
      
      return res
        .setHeader('Cache-Control', `public, max-age=${Math.floor(CACHE_TTL / 1000)}`)
        .status(200)
        .json({
          success: true,
          ...newPrice,
          cached: false,
          responseTime: `${responseTime}ms` 
        });
    }
    
    // If fetch failed but we have stale cache, serve it with warning
    if (cachedPrice && Date.now() - cachedPrice.timestamp < STALE_CACHE_TTL) {
      const responseTime = Date.now() - startTime;
      const age = Math.floor((Date.now() - cachedPrice.timestamp) / 1000);
      
      console.warn(`[Price API] Serving stale cache (${age}s old)`);
      
      return res
        .setHeader('Cache-Control', 'public, max-age=30')
        .setHeader('Warning', '110 - "Response is Stale"')
        .status(200)
        .json({
          success: true,
          ...cachedPrice,
          cached: true,
          stale: true,
          age: `${age}s`,
          warning: 'Price data may be outdated',
          responseTime: `${responseTime}ms` 
        });
    }
    
    // Complete failure
    const responseTime = Date.now() - startTime;
    console.error('[Price API] All price sources failed');
    
    return res.status(503).json({
      success: false,
      error: 'Service temporarily unavailable',
      message: 'All price APIs are currently unavailable',
      responseTime: `${responseTime}ms`,
      retry: 'Please try again in a few moments'
    });
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    console.error('[Price API] Unexpected error:', errorMessage);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'production' 
        ? 'Failed to fetch price' 
        : errorMessage,
      responseTime: `${responseTime}ms` 
    });
  }
}

export const config = {
  maxDuration: 10,
};
