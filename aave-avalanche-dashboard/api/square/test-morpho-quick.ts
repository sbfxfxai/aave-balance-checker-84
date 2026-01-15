/**
 * Quick test to verify Morpho vault on Arbitrum
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Morpho-Quick-Test] ===== QUICK MORPHO VERIFICATION =====');
    
    // Test both Arbitrum and Avalanche to see which one works
    const arbitrumRpc = 'https://arb1.arbitrum.io/rpc';
    const avalancheRpc = 'https://api.avax.network/ext/bc/C/rpc';
    
    const vaultAddress = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65';
    const usdcArbitrum = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const usdcAvalanche = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
    
    const minimalABI = [
      'function asset() view returns (address)',
      'function totalAssets() view returns (uint256)',
      'function name() view returns (string)'
    ];
    
    // Test Arbitrum
    console.log('[Morpho-Quick-Test] Testing Arbitrum...');
    try {
      const arbitrumProvider = new ethers.JsonRpcProvider(arbitrumRpc);
      const vaultContract = new ethers.Contract(vaultAddress, minimalABI, arbitrumProvider);
      
      const asset = await vaultContract.asset();
      const totalAssets = await vaultContract.totalAssets();
      const name = await vaultContract.name();
      
      console.log('[Morpho-Quick-Test] Arbitrum Results:');
      console.log('  - Vault Name:', name);
      console.log('  - Asset Address:', asset);
      console.log('  - Total Assets:', ethers.formatUnits(totalAssets, 6));
      console.log('  - Expected USDC:', usdcArbitrum);
      console.log('  - Match:', asset.toLowerCase() === usdcArbitrum.toLowerCase());
      
      return res.status(200).json({
        success: true,
        network: 'Arbitrum',
        vaultName: name,
        assetAddress: asset,
        totalAssets: ethers.formatUnits(totalAssets, 6),
        expectedUsdc: usdcArbitrum,
        isCorrectAsset: asset.toLowerCase() === usdcArbitrum.toLowerCase()
      });
      
    } catch (arbitrumError) {
      console.log('[Morpho-Quick-Test] Arbitrum failed:', arbitrumError);
      
      // Test Avalanche as fallback
      console.log('[Morpho-Quick-Test] Testing Avalanche...');
      try {
        const avalancheProvider = new ethers.JsonRpcProvider(avalancheRpc);
        const vaultContract = new ethers.Contract(vaultAddress, minimalABI, avalancheProvider);
        
        const asset = await vaultContract.asset();
        const totalAssets = await vaultContract.totalAssets();
        const name = await vaultContract.name();
        
        console.log('[Morpho-Quick-Test] Avalanche Results:');
        console.log('  - Vault Name:', name);
        console.log('  - Asset Address:', asset);
        console.log('  - Total Assets:', ethers.formatUnits(totalAssets, 6));
        console.log('  - Expected USDC:', usdcAvalanche);
        console.log('  - Match:', asset.toLowerCase() === usdcAvalanche.toLowerCase());
        
        return res.status(200).json({
          success: true,
          network: 'Avalanche',
          vaultName: name,
          assetAddress: asset,
          totalAssets: ethers.formatUnits(totalAssets, 6),
          expectedUsdc: usdcAvalanche,
          isCorrectAsset: asset.toLowerCase() === usdcAvalanche.toLowerCase()
        });
        
      } catch (avalancheError) {
        console.log('[Morpho-Quick-Test] Avalanche also failed:', avalancheError);
        
        return res.status(500).json({
          success: false,
          error: 'Vault not found on either network',
          arbitrumError: arbitrumError instanceof Error ? arbitrumError.message : String(arbitrumError),
          avalancheError: avalancheError instanceof Error ? avalancheError.message : String(avalancheError)
        });
      }
    }
    
  } catch (error) {
    console.error('[Morpho-Quick-Test] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export default handler;
