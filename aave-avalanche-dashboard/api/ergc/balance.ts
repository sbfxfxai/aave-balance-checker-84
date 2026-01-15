/**
 * ERGC balance check endpoint for Vercel
 * Handles GET /api/ergc/balance?address=0x...
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Ratelimit } from '@upstash/ratelimit';
import { getRedis } from '../utils/redis';
import { getAddress } from 'ethers';

// Configuration
const AVALANCHE_RPCS = [
  process.env.AVALANCHE_RPC_URL,
  "https://api.avax.network/ext/bc/C/rpc",
  "https://rpc.ankr.com/avalanche",
  "https://avalanche-c-chain.publicnode.com",
].filter(Boolean) as string[];

const ERGC_CONTRACT = "0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B";
const DISCOUNT_THRESHOLD = Number(process.env.ERGC_DISCOUNT_THRESHOLD) || 100;
const CACHE_TTL = 60; // 1 minute

// Rate limiter
let _ratelimit: any = null;

async function getRatelimit() {
  if (!_ratelimit) {
    try {
      const redis = await getRedis();
      _ratelimit = new Ratelimit({
        redis: redis as any,
        limiter: Ratelimit.slidingWindow(30, '1 m'),
        analytics: true,
      });
    } catch (error) {
      console.warn('[ERGC] Redis unavailable for rate limiting, continuing without rate limit:', error instanceof Error ? error.message : String(error));
      // Return a no-op rate limiter that always allows requests
      _ratelimit = {
        limit: async () => ({ success: true, remaining: 999 })
      };
    }
  }
  return _ratelimit;
}

// Hash address for logging
function hashAddress(address: string): string {
  return `${address.substring(0, 6)}...${address.substring(38)}`;
}

// Validate Ethereum address
function isValidEthereumAddress(address: string): boolean {
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return false;
  }
  
  try {
    getAddress(address); // Validates checksum
    return true;
  } catch {
    return false;
  }
}

// Minimal ERC20 ABI for balanceOf
const ERC20_ABI = [
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "balance", "type": "uint256"}],
    "type": "function"
  }
] as const;

// Fetch with timeout and fallback
async function fetchWithFallback(requestData: any): Promise<any> {
  for (const rpc of AVALANCHE_RPCS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.warn(`[ERGC] RPC ${rpc} failed:`, error);
      continue;
    }
  }
  throw new Error('All RPC endpoints failed');
}

// Get ERGC balance
async function getErgcBalance(address: string): Promise<{
  success: boolean;
  error?: string;
  address?: string;
  balance?: number;
  balance_raw?: string;
  has_discount?: boolean;
  tokens_needed?: number;
  discount_threshold?: number;
}> {
  try {
    // Validate address
    if (!isValidEthereumAddress(address)) {
      return { success: false, error: "Invalid Ethereum address" };
    }

    // Normalize address to checksum format
    const checksumAddress = getAddress(address);

    // Create request for balanceOf
    const requestData = {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        {
          to: ERGC_CONTRACT,
          data: `0x70a08231${checksumAddress.slice(2).padStart(64, '0')}` 
        },
        "latest"
      ],
      id: 1
    };

    // Make RPC call with fallback
    const data = await fetchWithFallback(requestData);
    
    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    const balanceHex = data.result;
    const balanceWei = BigInt(balanceHex);
    const balance = Number(balanceWei) / 1e18;

    return {
      success: true,
      address: checksumAddress,
      balance: balance,
      balance_raw: balanceWei.toString(),
      has_discount: balance >= DISCOUNT_THRESHOLD,
      tokens_needed: balance < DISCOUNT_THRESHOLD ? Math.max(0, DISCOUNT_THRESHOLD - balance) : 0,
      discount_threshold: DISCOUNT_THRESHOLD,
    };
  } catch (error) {
    console.error('[ERGC] Balance check error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// Get balance with cache
async function getErgcBalanceWithCache(address: string) {
  const normalizedAddress = address.toLowerCase();
  const cacheKey = `ergc_balance:${normalizedAddress}`;
  
  // Check cache (gracefully handle Redis failures)
  try {
    const redis = await getRedis().catch(() => null);
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          console.log(`[ERGC] Cache hit for ${hashAddress(address)}`);
          return JSON.parse(cached as string);
        }
      } catch (cacheError) {
        console.warn('[ERGC] Cache read error, continuing without cache:', cacheError instanceof Error ? cacheError.message : String(cacheError));
      }
    }
  } catch (error) {
    // Redis unavailable - continue without cache
    console.warn('[ERGC] Redis unavailable, continuing without cache:', error instanceof Error ? error.message : String(error));
  }
  
  // Fetch from blockchain
  const result = await getErgcBalance(address);
  
  // Cache successful results (gracefully handle Redis failures)
  if (result.success) {
    try {
      const redis = await getRedis().catch(() => null);
      if (redis) {
        try {
          await redis.set(cacheKey, JSON.stringify(result), { ex: CACHE_TTL });
        } catch (cacheError) {
          // Redis unavailable - continue without caching
          console.warn('[ERGC] Cache write error, continuing without cache:', cacheError instanceof Error ? cacheError.message : String(cacheError));
        }
      }
    } catch (error) {
      // Redis unavailable - continue without caching
      console.warn('[ERGC] Redis unavailable for caching:', error instanceof Error ? error.message : String(error));
    }
  }
  
  return result;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const startTime = Date.now();
  
  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'GET') {
    return response.status(405).json({
      success: false,
      error: 'Method not allowed. Use GET.'
    });
  }

  try {
    // Rate limiting (with error handling)
    let rateLimitSuccess = true;
    try {
      const ratelimit = await getRatelimit().catch(() => ({
        limit: async () => ({ success: true, remaining: 999 })
      }));
      const identifier = (request.headers['x-forwarded-for'] as string) || 
                         (request.headers['x-real-ip'] as string) || 
                         'anonymous';
      
      const rateLimitResult = await ratelimit.limit(identifier).catch(() => ({ success: true, remaining: 999 }));
      rateLimitSuccess = rateLimitResult.success;
      
      response.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
      
      if (!rateLimitSuccess) {
        return response.status(429).json({
          success: false,
          error: 'Too many requests. Please try again later.',
        });
      }
    } catch (rateLimitError) {
      // If rate limiting fails, log but continue (fail open)
      console.warn('[ERGC] Rate limiting check failed, continuing:', rateLimitError instanceof Error ? rateLimitError.message : String(rateLimitError));
    }

    // Parse and validate address parameter
    const address = request.query.address as string;
    
    if (!address) {
      return response.status(400).json({
        success: false,
        error: "address parameter is required",
        example: "/api/ergc/balance?address=0x..."
      });
    }

    console.log(`[ERGC] Checking balance for ${hashAddress(address)}`);

    // Get balance (with cache)
    const result = await getErgcBalanceWithCache(address);

    if (result.success) {
      return response.status(200).json(result);
    } else {
      return response.status(400).json(result);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    console.error('[ERGC] API endpoint error:', {
      error: errorMessage,
      stack: errorStack,
      duration: Date.now() - startTime
    });
    
    return response.status(500).json({
      success: false,
      error: "Internal server error",
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
    });
  }
}

export const config = {
  maxDuration: 10,
};
