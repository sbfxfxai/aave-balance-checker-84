/**
 * Test to verify network configuration and wallet addresses
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Network-Test] ===== NETWORK CONFIGURATION VERIFICATION =====');
    
    // Check environment variables
    const config = {
      ARBITRUM_RPC_URL: process.env.ARBITRUM_RPC_URL,
      ARBITRUM_HUB_WALLET_PRIVATE_KEY: process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY ? 'SET' : 'NOT SET',
      ARBITRUM_HUB_WALLET_ADDRESS: process.env.ARBITRUM_HUB_WALLET_ADDRESS,
      HUB_WALLET_PRIVATE_KEY: process.env.HUB_WALLET_PRIVATE_KEY ? 'SET' : 'NOT SET',
      HUB_WALLET_ADDRESS: process.env.HUB_WALLET_ADDRESS,
      AVALANCHE_RPC_URL: process.env.AVALANCHE_RPC_URL
    };
    
    console.log('[Network-Test] Environment Variables:', config);
    
    // Test Arbitrum connection
    const arbitrumRpc = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';
    const arbitrumProvider = new ethers.JsonRpcProvider(arbitrumRpc);
    const arbitrumNetwork = await arbitrumProvider.getNetwork();
    
    console.log('[Network-Test] Arbitrum Network:', {
      chainId: arbitrumNetwork.chainId.toString(),
      name: arbitrumNetwork.name
    });
    
    // Test Avalanche connection
    const avalancheRpc = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
    const avalancheProvider = new ethers.JsonRpcProvider(avalancheRpc);
    const avalancheNetwork = await avalancheProvider.getNetwork();
    
    console.log('[Network-Test] Avalanche Network:', {
      chainId: avalancheNetwork.chainId.toString(),
      name: avalancheNetwork.name
    });
    
    // Check wallet addresses on both networks
    const arbitrumKey = process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY || process.env.HUB_WALLET_PRIVATE_KEY;
    const avalancheKey = process.env.HUB_WALLET_PRIVATE_KEY;
    
    let arbitrumWalletAddress = null;
    let avalancheWalletAddress = null;
    
    if (arbitrumKey) {
      const arbitrumWallet = new ethers.Wallet(arbitrumKey);
      arbitrumWalletAddress = arbitrumWallet.address;
      console.log('[Network-Test] Arbitrum Wallet Address:', arbitrumWalletAddress);
    }
    
    if (avalancheKey) {
      const avalancheWallet = new ethers.Wallet(avalancheKey);
      avalancheWalletAddress = avalancheWallet.address;
      console.log('[Network-Test] Avalanche Wallet Address:', avalancheWalletAddress);
    }
    
    // Check if they're the same (this could be the issue)
    const sameWallet = arbitrumWalletAddress && avalancheWalletAddress && 
                      arbitrumWalletAddress.toLowerCase() === avalancheWalletAddress.toLowerCase();
    
    console.log('[Network-Test] Same wallet used for both networks:', sameWallet);
    
    // Test USDC contracts on both networks
    const usdcArbitrum = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const usdcAvalanche = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
    
    let arbitrumUsdcExists = false;
    let avalancheUsdcExists = false;
    
    try {
      const arbitrumUsdcContract = new ethers.Contract(usdcArbitrum, ['function name() view returns (string)'], arbitrumProvider);
      await arbitrumUsdcContract.name();
      arbitrumUsdcExists = true;
    } catch (e) {
      console.log('[Network-Test] Arbitrum USDC not found:', e);
    }
    
    try {
      const avalancheUsdcContract = new ethers.Contract(usdcAvalanche, ['function name() view returns (string)'], avalancheProvider);
      await avalancheUsdcContract.name();
      avalancheUsdcExists = true;
    } catch (e) {
      console.log('[Network-Test] Avalanche USDC not found:', e);
    }
    
    const result = {
      success: true,
      config,
      networks: {
        arbitrum: {
          chainId: arbitrumNetwork.chainId.toString(),
          name: arbitrumNetwork.name,
          walletAddress: arbitrumWalletAddress,
          usdcExists: arbitrumUsdcExists,
          usdcAddress: usdcArbitrum
        },
        avalanche: {
          chainId: avalancheNetwork.chainId.toString(),
          name: avalancheNetwork.name,
          walletAddress: avalancheWalletAddress,
          usdcExists: avalancheUsdcExists,
          usdcAddress: usdcAvalanche
        }
      },
      sameWalletUsed: sameWallet,
      recommendations: [] as string[]
    };
    
    // Add recommendations
    if (sameWallet) {
      result.recommendations.push('⚠️ Same wallet used for both networks - consider using separate wallets');
    }
    
    if (!arbitrumUsdcExists) {
      result.recommendations.push('❌ Arbitrum USDC contract not found');
    }
    
    if (!avalancheUsdcExists) {
      result.recommendations.push('❌ Avalanche USDC contract not found');
    }
    
    if (!process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY) {
      result.recommendations.push('⚠️ ARBITRUM_HUB_WALLET_PRIVATE_KEY not set, falling back to HUB_WALLET_PRIVATE_KEY');
    }
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('[Network-Test] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export default handler;
