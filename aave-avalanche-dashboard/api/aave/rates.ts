import type { VercelRequest, VercelResponse } from '@vercel/node';

// Aave V3 Pool Data Provider on Avalanche
const AAVE_POOL_DATA_PROVIDER = '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654';
const USDC_ADDRESS = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const AVALANCHE_RPC = 'https://api.avax.network/ext/bc/C/rpc';

// ABI for getReserveData
const POOL_DATA_PROVIDER_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'asset', type: 'address' }],
    name: 'getReserveData',
    outputs: [
      { internalType: 'uint256', name: 'unbacked', type: 'uint256' },
      { internalType: 'uint256', name: 'accruedToTreasuryScaled', type: 'uint256' },
      { internalType: 'uint256', name: 'totalAToken', type: 'uint256' },
      { internalType: 'uint256', name: 'totalStableDebt', type: 'uint256' },
      { internalType: 'uint256', name: 'totalVariableDebt', type: 'uint256' },
      { internalType: 'uint256', name: 'liquidityRate', type: 'uint256' },
      { internalType: 'uint256', name: 'variableBorrowRate', type: 'uint256' },
      { internalType: 'uint256', name: 'stableBorrowRate', type: 'uint256' },
      { internalType: 'uint256', name: 'averageStableBorrowRate', type: 'uint256' },
      { internalType: 'uint256', name: 'liquidityIndex', type: 'uint256' },
      { internalType: 'uint256', name: 'variableBorrowIndex', type: 'uint256' },
      { internalType: 'uint40', name: 'lastUpdateTimestamp', type: 'uint40' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
];

// Cache for rates (1 minute TTL)
let cachedRates: { supplyAPY: number; borrowAPY: number; timestamp: number } | null = null;
const CACHE_TTL = 60 * 1000; // 1 minute

// Constants for APY calculation
const SECONDS_PER_YEAR = 31536000;
const RAY = BigInt(10) ** BigInt(27);

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000; // 1 second base delay

// Helper function for exponential backoff retry
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  baseDelay: number = RETRY_DELAY_BASE
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[Aave Rates] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries exceeded');
}

async function fetchAaveRates(): Promise<{ supplyAPY: number; borrowAPY: number }> {
  const startTime = Date.now();
  
  // Check cache
  if (cachedRates && Date.now() - cachedRates.timestamp < CACHE_TTL) {
    console.log('[Aave Rates] Using cached values');
    return { supplyAPY: cachedRates.supplyAPY, borrowAPY: cachedRates.borrowAPY };
  }

  const makeRpcCall = async () => {
    // Encode the function call
    const functionSelector = '0x35ea6a75'; // getReserveData(address)
    const paddedAddress = USDC_ADDRESS.slice(2).toLowerCase().padStart(64, '0');
    const data = functionSelector + paddedAddress;

    // Make eth_call
    const response = await fetch(AVALANCHE_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          { to: AAVE_POOL_DATA_PROVIDER, data },
          'latest',
        ],
        id: 1,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    if (result.error) {
      throw new Error(`RPC error: ${result.error.message}`);
    }

    return result;
  };

  try {
    const result = await retryWithBackoff(makeRpcCall);

    // Parse the result - liquidityRate is at index 5 (offset 5 * 64 = 320 hex chars)
    // variableBorrowRate is at index 6 (offset 6 * 64 = 384 hex chars)
    const resultData = result.result.slice(2); // Remove 0x prefix
    
    // Each uint256 is 64 hex characters
    const liquidityRateHex = resultData.slice(5 * 64, 6 * 64);
    const variableBorrowRateHex = resultData.slice(6 * 64, 7 * 64);
    
    // Convert from ray (27 decimals) to APY percentage
    // Aave rates are already annualized in RAY format
    const liquidityRate = BigInt('0x' + liquidityRateHex);
    const variableBorrowRate = BigInt('0x' + variableBorrowRateHex);
    
    // Convert ray to decimal rate (annualized)
    const supplyAPY = (Number(liquidityRate) / Number(RAY)) * 100;
    const borrowAPY = (Number(variableBorrowRate) / Number(RAY)) * 100;
    
    // Ensure we have reasonable values (not negative or extremely high)
    const finalSupplyAPY = Math.max(0, Math.min(supplyAPY, 100)); // Cap at 100%
    const finalBorrowAPY = Math.max(0, Math.min(borrowAPY, 100)); // Cap at 100%

    // Cache the result
    cachedRates = { supplyAPY: finalSupplyAPY, borrowAPY: finalBorrowAPY, timestamp: Date.now() };

    const duration = Date.now() - startTime;
    console.log('[Aave Rates] Fetch completed', {
      duration: `${duration}ms`,
      cached: false,
      supplyAPY: finalSupplyAPY.toFixed(2),
      borrowAPY: finalBorrowAPY.toFixed(2),
    });

    return { supplyAPY: finalSupplyAPY, borrowAPY: finalBorrowAPY };
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Aave Rates] Error fetching rates:', {
      message,
      duration: `${duration}ms`,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Return fallback values if fetch fails
    return { supplyAPY: 3.5, borrowAPY: 5.0 };
  }
}

/**
 * Get current Aave USDC rates
 * GET /api/aave/rates
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { supplyAPY, borrowAPY } = await fetchAaveRates();

    return res.status(200).json({
      success: true,
      asset: 'USDC',
      chain: 'avalanche',
      supplyAPY: Math.round(supplyAPY * 100) / 100, // Round to 2 decimal places
      borrowAPY: Math.round(borrowAPY * 100) / 100,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Aave Rates] API Error:', {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch rates',
      details: process.env.NODE_ENV === 'development' ? message : undefined,
    });
  }
}
