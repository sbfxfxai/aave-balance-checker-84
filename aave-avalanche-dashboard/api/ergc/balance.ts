/**
 * ERGC balance check endpoint for Vercel
 * Handles GET /api/ergc/balance?address=0x...
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || "https://api.avax.network/ext/bc/C/rpc";
const ERGC_CONTRACT = "0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B";

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

async function getErgcBalance(address: string): Promise<{
  success: boolean;
  error?: string;
  address?: string;
  balance?: number;
  balance_raw?: string;
  has_discount?: boolean;
  tokens_needed?: number;
}> {
  try {
    // Validate address format (basic checksum validation)
    if (!address || !address.startsWith('0x') || address.length !== 42) {
      return { success: false, error: "Invalid address format" };
    }

    // Create request body for JSON-RPC
    const requestData = {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        {
          to: ERGC_CONTRACT,
          data: `0x70a08231${address.slice(2).padStart(64, '0')}` // balanceOf(address) selector + padded address
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
    const balance = Number(balanceWei) / (10 ** 18); // ERGC has 18 decimals

    return {
      success: true,
      address: address,
      balance: balance,
      balance_raw: balanceWei.toString(),
      has_discount: balance >= 100, // Need at least 100 ERGC for discount
      tokens_needed: balance < 100 ? Math.max(0, 100 - balance) : 0
    };

  } catch (error) {
    console.error('[ERGC] Balance check error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    // Parse query parameters
    const address = request.query.address as string;

    if (!address) {
      return response.status(400).json({
        success: false,
        error: "address parameter is required"
      });
    }

    console.log(`[ERGC] Checking balance for ${address}`);

    const result = await getErgcBalance(address);

    if (result.success) {
      return response.status(200).json(result);
    } else {
      return response.status(400).json(result);
    }

  } catch (error) {
    console.error('[ERGC] API endpoint error:', error);
    return response.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
}
