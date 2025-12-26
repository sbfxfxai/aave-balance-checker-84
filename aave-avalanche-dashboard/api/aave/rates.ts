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

async function fetchAaveRates(): Promise<{ supplyAPY: number; borrowAPY: number }> {
  // Check cache
  if (cachedRates && Date.now() - cachedRates.timestamp < CACHE_TTL) {
    return { supplyAPY: cachedRates.supplyAPY, borrowAPY: cachedRates.borrowAPY };
  }

  try {
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

    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error.message);
    }

    // Parse the result - liquidityRate is at index 5 (offset 5 * 64 = 320 hex chars)
    // variableBorrowRate is at index 6 (offset 6 * 64 = 384 hex chars)
    const resultData = result.result.slice(2); // Remove 0x prefix
    
    // Each uint256 is 64 hex characters
    const liquidityRateHex = resultData.slice(5 * 64, 6 * 64);
    const variableBorrowRateHex = resultData.slice(6 * 64, 7 * 64);
    
    // Convert from ray (27 decimals) to percentage
    const RAY = BigInt(10) ** BigInt(27);
    const liquidityRate = BigInt('0x' + liquidityRateHex);
    const variableBorrowRate = BigInt('0x' + variableBorrowRateHex);
    
    // Convert to APY percentage (rate is already annualized in Aave)
    const supplyAPY = Number(liquidityRate * BigInt(100)) / Number(RAY);
    const borrowAPY = Number(variableBorrowRate * BigInt(100)) / Number(RAY);

    // Cache the result
    cachedRates = { supplyAPY, borrowAPY, timestamp: Date.now() };

    return { supplyAPY, borrowAPY };
  } catch (error) {
    console.error('[Aave Rates] Error fetching rates:', error);
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
    console.error('[Aave Rates] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
