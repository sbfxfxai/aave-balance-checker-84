/**
 * Debug the vault contract to see available functions
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Vault-Debug] ===== DEBUGGING VAULT CONTRACT =====');
    
    const ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc';
    const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65';
    
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    
    // Get the contract ABI from the actual contract
    const code = await provider.getCode(MORPHO_GAUNTLET_USDC_VAULT);
    console.log('[Vault-Debug] Contract code length:', code.length);
    
    if (code === '0x') {
      return res.status(500).json({
        success: false,
        error: 'No contract code at this address'
      });
    }
    
    // Try to call the deposit function with different signatures
    const testWallet = '0x5c71b7be6aac81b3b1a8b88adf475dde24293c67';
    const testAmount = ethers.parseUnits('1', 6);
    
    const results: any = {
      contractExists: true,
      tests: []
    };
    
    // Test 1: Standard ERC4626 deposit(uint256 assets, address receiver)
    try {
      const vaultABI = [
        'function deposit(uint256 assets, address receiver) external returns (uint256 shares)'
      ];
      const vaultContract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, vaultABI, provider);
      
      // Try to encode the function call
      const encodedData = vaultContract.interface.encodeFunctionData('deposit', [testAmount, testWallet]);
      console.log('[Vault-Debug] Standard deposit encoded data:', encodedData);
      
      results.tests.push({
        function: 'deposit(uint256 assets, address receiver)',
        encodedData: encodedData,
        success: true
      });
    } catch (e) {
      console.log('[Vault-Debug] Standard deposit failed:', (e as Error).message);
      results.tests.push({
        function: 'deposit(uint256 assets, address receiver)',
        error: (e as Error).message,
        success: false
      });
    }
    
    // Test 2: Alternative signature deposit(uint256 assets, address to)
    try {
      const vaultABI = [
        'function deposit(uint256 assets, address to) external returns (uint256 shares)'
      ];
      const vaultContract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, vaultABI, provider);
      
      const encodedData = vaultContract.interface.encodeFunctionData('deposit', [testAmount, testWallet]);
      console.log('[Vault-Debug] Alternative deposit encoded data:', encodedData);
      
      results.tests.push({
        function: 'deposit(uint256 assets, address to)',
        encodedData: encodedData,
        success: true
      });
    } catch (e) {
      console.log('[Vault-Debug] Alternative deposit failed:', (e as Error).message);
      results.tests.push({
        function: 'deposit(uint256 assets, address to)',
        error: (e as Error).message,
        success: false
      });
    }
    
    // Test 3: Check if it's a Morpho vault with specific functions
    try {
      const morphoABI = [
        'function submit(uint256 assets, address onBehalf) external returns (uint256 shares)',
        'function deposit(uint256 assets, address onBehalf) external returns (uint256 shares)',
        'function mint(uint256 shares, address to) external returns (uint256 assets)'
      ];
      const vaultContract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, morphoABI, provider);
      
      // Test submit function
      try {
        const encodedData = vaultContract.interface.encodeFunctionData('submit', [testAmount, testWallet]);
        console.log('[Vault-Debug] Submit encoded data:', encodedData);
        results.tests.push({
          function: 'submit(uint256 assets, address onBehalf)',
          encodedData: encodedData,
          success: true
        });
      } catch (e) {
        results.tests.push({
          function: 'submit(uint256 assets, address onBehalf)',
          error: (e as Error).message,
          success: false
        });
      }
      
      // Test mint function
      try {
        const shares = ethers.parseUnits('1', 18); // 1 share
        const encodedData = vaultContract.interface.encodeFunctionData('mint', [shares, testWallet]);
        console.log('[Vault-Debug] Mint encoded data:', encodedData);
        results.tests.push({
          function: 'mint(uint256 shares, address to)',
          encodedData: encodedData,
          success: true
        });
      } catch (e) {
        results.tests.push({
          function: 'mint(uint256 shares, address to)',
          error: (e as Error).message,
          success: false
        });
      }
      
    } catch (e) {
      console.log('[Vault-Debug] Morpho ABI test failed:', (e as Error).message);
    }
    
    return res.status(200).json({
      success: true,
      results
    });
    
  } catch (error) {
    console.error('[Vault-Debug] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export default handler;
