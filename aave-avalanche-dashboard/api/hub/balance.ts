/**
 * Hub wallet USDC balance check endpoint for Vercel
 * Handles GET /api/hub/balance
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || "https://api.avax.network/ext/bc/C/rpc";
const HUB_WALLET_ADDRESS = process.env.HUB_WALLET_ADDRESS || '0x34c11928868d14bdD7Be55A0D9f9e02257240c24';
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';

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

async function getHubUsdcBalance(): Promise<{
  success: boolean;
  error?: string;
  balance?: number;
  balance_raw?: string;
}> {
  try {
    // Create request body for JSON-RPC
    const requestData = {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        {
          to: USDC_CONTRACT,
          data: `0x70a08231${HUB_WALLET_ADDRESS.slice(2).padStart(64, '0')}` // balanceOf(address) selector + padded address
        },
        "latest"
      ],
      id: 1
    };

    // Make RPC call
    const response = await fetch(AVALANCHE_RPC, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      throw new Error(`RPC call failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.error) {
      throw new Error(`RPC error: ${data.error.message}`);
    }

    const balanceHex = data.result;
    const balanceWei = BigInt(balanceHex);
    const balance = Number(balanceWei) / (10 ** 6); // USDC has 6 decimals

    return {
      success: true,
      balance: balance,
      balance_raw: balanceWei.toString(),
    };

  } catch (error) {
    console.error('[Hub Balance] Balance check error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    // Only allow GET requests
    if (request.method !== 'GET') {
      return response.status(405).json({
        success: false,
        error: "Method not allowed. Use GET."
      });
    }

    console.log(`[Hub Balance] Checking USDC balance for hub wallet ${HUB_WALLET_ADDRESS}`);

    const result = await getHubUsdcBalance();

    if (result.success) {
      return response.status(200).json(result);
    } else {
      return response.status(400).json(result);
    }

  } catch (error) {
    console.error('[Hub Balance] API endpoint error:', error);
    return response.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
}

