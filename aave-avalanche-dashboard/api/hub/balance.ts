/**
 * Hub wallet USDC balance check endpoint for Vercel
 * Handles GET /api/hub/balance?chain=avalanche|arbitrum
 * Defaults to Avalanche if no chain parameter is provided
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

const ARBITRUM_RPCS = [
  process.env.ARBITRUM_RPC_URL,
  "https://arb1.arbitrum.io/rpc",
  "https://rpc.ankr.com/arbitrum",
  "https://arbitrum.publicnode.com",
].filter(Boolean) as string[];

const HUB_WALLET_ADDRESS = process.env.HUB_WALLET_ADDRESS || '0x34c11928868d14bdD7Be55A0D9f9e02257240c24';
const CACHE_TTL = 30; // 30 seconds cache

// USDC contract addresses per chain
const USDC_AVALANCHE = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

// Rate limiter
let _ratelimit: any = null;

async function getRatelimit() {
  if (!_ratelimit) {
    const redis = getRedis();
    _ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, '1 m'), // 20 requests per minute per IP
      analytics: true,
    });
  }
  return _ratelimit;
}

// Hash address for logging
function hashAddress(address: string): string {
  return `${address.substring(0, 6)}...${address.substring(38)}`;
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
async function fetchWithFallback(rpcUrls: string[], requestData: any): Promise<any> {
  for (const rpc of rpcUrls) {
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
      console.warn(`[Hub Balance] RPC ${rpc} failed:`, error);
      continue;
    }
  }
  throw new Error('All RPC endpoints failed');
}

async function getHubUsdcBalance(chain: 'avalanche' | 'arbitrum' = 'avalanche'): Promise<{
  success: boolean;
  error?: string;
  balance?: number;
  balance_raw?: string;
  chain?: string;
}> {
  try {
    // Select RPC and USDC contract based on chain
    const rpcUrls = chain === 'arbitrum' ? ARBITRUM_RPCS : AVALANCHE_RPCS;
    const usdcContract = chain === 'arbitrum' ? USDC_ARBITRUM : USDC_AVALANCHE;
    
    // Validate and normalize hub wallet address
    const normalizedHubAddress = getAddress(HUB_WALLET_ADDRESS);
    
    console.log(`[Hub Balance] Checking ${chain} USDC balance for hub wallet ${hashAddress(normalizedHubAddress)}`);
    console.log(`[Hub Balance] Using ${rpcUrls.length} RPC endpoints for ${chain}`);
    console.log(`[Hub Balance] Using USDC contract: ${usdcContract}`);
    
    // Create request body for JSON-RPC
    const requestData = {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        {
          to: usdcContract,
          data: `0x70a08231${normalizedHubAddress.slice(2).padStart(64, '0')}` // balanceOf(address) selector + padded address
        },
        "latest"
      ],
      id: 1
    };

    // Make RPC call with fallback
    const data = await fetchWithFallback(rpcUrls, requestData);
    
    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    const balanceHex = data.result;
    const balanceWei = BigInt(balanceHex);
    const balance = Number(balanceWei) / 1e6; // USDC has 6 decimals

    return {
      success: true,
      balance: balance,
      balance_raw: balanceWei.toString(),
      chain: chain,
    };

  } catch (error) {
    console.error('[Hub Balance] Balance check error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

// Get balance with cache
async function getHubUsdcBalanceWithCache(chain: 'avalanche' | 'arbitrum') {
  const redis = getRedis();
  const cacheKey = `hub_balance:${chain}:usdc`;
  
  // Check cache
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`[Hub Balance] Cache hit for ${chain} USDC balance`);
      return JSON.parse(cached as string);
    }
  } catch (error) {
    console.warn('[Hub Balance] Cache read failed:', error);
  }
  
  // Fetch from blockchain
  const result = await getHubUsdcBalance(chain);
  
  // Cache successful results
  if (result.success) {
    try {
      await redis.set(cacheKey, JSON.stringify(result), { ex: CACHE_TTL });
    } catch (error) {
      console.warn('[Hub Balance] Cache write failed:', error);
    }
  }
  
  return result;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // Only allow GET requests
  if (request.method !== 'GET') {
    return response.status(405).json({
      success: false,
      error: "Method not allowed. Use GET."
    });
  }

  try {
    // Rate limiting
    const ratelimit = await getRatelimit();
    const identifier = (request.headers['x-forwarded-for'] as string) || 
                       (request.headers['x-real-ip'] as string) || 
                       'anonymous';
    
    const { success, remaining } = await ratelimit.limit(identifier);
    
    response.setHeader('X-RateLimit-Remaining', remaining.toString());
    
    if (!success) {
      return response.status(429).json({
        success: false,
        error: 'Too many requests. Please try again later.',
      });
    }

    // Get chain parameter from query string (defaults to 'avalanche')
    const chainParam = (request.query?.chain as string) || 'avalanche';
    const chain = (chainParam === 'arbitrum' ? 'arbitrum' : 'avalanche') as 'avalanche' | 'arbitrum';
    
    console.log(`[Hub Balance] Checking ${chain} USDC balance for hub wallet ${hashAddress(HUB_WALLET_ADDRESS)}`);

    // Get balance (with cache)
    const result = await getHubUsdcBalanceWithCache(chain);

    if (result.success) {
      return response.status(200).json(result);
    } else {
      return response.status(400).json(result);
    }

  } catch (error) {
    console.error('[Hub Balance] API endpoint error:', error);
    
    return response.status(500).json({
      success: false,
      error: "Internal server error",
      details: process.env.NODE_ENV === 'development' 
        ? error instanceof Error ? error.message : String(error)
        : undefined,
    });
  }
}
