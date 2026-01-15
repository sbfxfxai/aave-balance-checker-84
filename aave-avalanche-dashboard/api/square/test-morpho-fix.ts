/**
 * Test to fix Morpho transaction routing
 * This will ensure Morpho transactions go to Arbitrum, not Avalanche
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Morpho-Fix] ===== FIXING MORPHO TRANSACTION ROUTING =====');
    
    // Force use of Arbitrum-specific configuration
    const ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc';
    const ARBITRUM_HUB_WALLET_PRIVATE_KEY = process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY || process.env.HUB_WALLET_PRIVATE_KEY || '';
    
    if (!ARBITRUM_HUB_WALLET_PRIVATE_KEY) {
      return res.status(500).json({
        success: false,
        error: 'No Arbitrum hub wallet private key configured'
      });
    }
    
    // Connect to Arbitrum ONLY
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    const network = await provider.getNetwork();
    
    console.log('[Morpho-Fix] Connected to network:', {
      chainId: network.chainId.toString(),
      name: network.name
    });
    
    if (network.chainId !== 42161n) {
      return res.status(500).json({
        success: false,
        error: 'Not connected to Arbitrum',
        actualChainId: network.chainId.toString(),
        expectedChainId: '42161'
      });
    }
    
    // Create wallet for Arbitrum
    const hubWallet = new ethers.Wallet(ARBITRUM_HUB_WALLET_PRIVATE_KEY, provider);
    console.log('[Morpho-Fix] Hub wallet address on Arbitrum:', hubWallet.address);
    
    // Test vault contract on Arbitrum
    const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65';
    const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    
    const vaultABI = ['function asset() view returns (address)', 'function name() view returns (string)'];
    const vaultContract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, vaultABI, provider);
    
    const vaultAsset = await vaultContract.asset();
    const vaultName = await vaultContract.name();
    
    console.log('[Morpho-Fix] Vault verification:', {
      name: vaultName,
      asset: vaultAsset,
      expectedAsset: USDC_ARBITRUM,
      isCorrectAsset: vaultAsset.toLowerCase() === USDC_ARBITRUM.toLowerCase()
    });
    
    // Check USDC balance
    const usdcABI = ['function balanceOf(address) view returns (uint256)'];
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, usdcABI, provider);
    const balance = await usdcContract.balanceOf(hubWallet.address);
    const balanceUsd = Number(ethers.formatUnits(balance, 6));
    
    console.log('[Morpho-Fix] USDC balance on Arbitrum:', balanceUsd.toFixed(6));
    
    return res.status(200).json({
      success: true,
      network: {
        chainId: network.chainId.toString(),
        name: network.name,
        isArbitrum: network.chainId === 42161n
      },
      wallet: {
        address: hubWallet.address,
        usdcBalance: balanceUsd.toFixed(6)
      },
      vault: {
        address: MORPHO_GAUNTLET_USDC_VAULT,
        name: vaultName,
        asset: vaultAsset,
        expectedAsset: USDC_ARBITRUM,
        isCorrectAsset: vaultAsset.toLowerCase() === USDC_ARBITRUM.toLowerCase()
      },
      canDeposit: balanceUsd >= 1.00,
      recommendations: balanceUsd < 1.00 ? ['Insufficient USDC balance for minimum deposit'] : []
    });
    
  } catch (error) {
    console.error('[Morpho-Fix] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export default handler;
