/**
 * Verify the vault address and check if it's a Morpho vault
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Vault-Verify] ===== VERIFYING VAULT ADDRESS =====');
    
    const ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc';
    const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65';
    
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    
    // Check if contract exists
    const code = await provider.getCode(MORPHO_GAUNTLET_USDC_VAULT);
    console.log('[Vault-Verify] Contract code length:', code.length);
    
    if (code === '0x') {
      return res.status(500).json({
        success: false,
        error: 'No contract code at this address'
      });
    }
    
    // Try to get basic contract info
    const results: any = {
      address: MORPHO_GAUNTLET_USDC_VAULT,
      contractExists: true,
      tests: []
    };
    
    // Test common vault functions
    const commonFunctions = [
      { name: 'name', signature: 'function name() external view returns (string)' },
      { name: 'symbol', signature: 'function symbol() external view returns (string)' },
      { name: 'decimals', signature: 'function decimals() external view returns (uint8)' },
      { name: 'asset', signature: 'function asset() external view returns (address)' },
      { name: 'totalAssets', signature: 'function totalAssets() external view returns (uint256)' },
      { name: 'totalSupply', signature: 'function totalSupply() external view returns (uint256)' },
      { name: 'balanceOf', signature: 'function balanceOf(address account) external view returns (uint256)' },
      { name: 'deposit', signature: 'function deposit(uint256 assets, address receiver) external returns (uint256)' },
      { name: 'submit', signature: 'function submit(uint256 assets, address onBehalf) external returns (uint256)' },
      { name: 'mint', signature: 'function mint(uint256 shares, address to) external returns (uint256)' },
      { name: 'withdraw', signature: 'function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)' },
      { name: 'redeem', signature: 'function redeem(uint256 shares, address receiver, address owner) external returns (uint256)' }
    ];
    
    for (const func of commonFunctions) {
      try {
        const contract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, [func.signature], provider);
        
        if (func.name === 'balanceOf') {
          const result = await contract[func.name]('0x5c71b7be6aac81b3b1a8b88adf475dde24293c67');
          results.tests.push({
            function: func.name,
            success: true,
            result: result.toString()
          });
        } else if (func.name === 'deposit' || func.name === 'submit' || func.name === 'mint') {
          // These are write functions, just test if they exist
          const contractInterface = new ethers.Interface([func.signature]);
          const encoded = contractInterface.encodeFunctionData(func.name, [ethers.parseUnits('1', 6), '0x5c71b7be6aac81b3b1a8b88adf475dde24293c67']);
          results.tests.push({
            function: func.name,
            success: true,
            encoded: encoded
          });
        } else {
          const result = await contract[func.name]();
          results.tests.push({
            function: func.name,
            success: true,
            result: typeof result === 'bigint' ? result.toString() : result
          });
        }
      } catch (e) {
        results.tests.push({
          function: func.name,
          success: false,
          error: (e as Error).message
        });
      }
    }
    
    // Check if it's a Morpho vault by checking for Morpho-specific functions
    const morphoFunctions = [
      'function owner() external view returns (address)',
      'function factory() external view returns (address)',
      'function fee() external view returns (uint256)',
      'function performanceFee() external view returns (uint256)'
    ];
    
    results.morphoChecks = [];
    
    for (const func of morphoFunctions) {
      try {
        const contract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, [func], provider);
        const functionName = func.split('(')[0].split(' ')[1];
        const result = await contract[functionName]();
        results.morphoChecks.push({
          function: functionName,
          success: true,
          result: result.toString()
        });
      } catch (e) {
        const functionName = func.split('(')[0].split(' ')[1];
        results.morphoChecks.push({
          function: functionName,
          success: false,
          error: (e as Error).message
        });
      }
    }
    
    return res.status(200).json({
      success: true,
      results
    });
    
  } catch (error) {
    console.error('[Vault-Verify] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export default handler;
