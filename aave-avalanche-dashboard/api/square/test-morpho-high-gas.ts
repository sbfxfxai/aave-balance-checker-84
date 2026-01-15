/**
 * Test Morpho deposit with higher gas price
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Morpho-High-Gas] ===== TESTING WITH HIGHER GAS PRICE =====');
    
    const { walletAddress, amount = 1.00 } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }
    
    // Configuration
    const ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc';
    const ARBITRUM_HUB_WALLET_PRIVATE_KEY = process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY || process.env.HUB_WALLET_PRIVATE_KEY || '';
    const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65';
    
    // Connect to Arbitrum
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    const hubWallet = new ethers.Wallet(ARBITRUM_HUB_WALLET_PRIVATE_KEY, provider);
    
    console.log('[Morpho-High-Gas] Hub wallet:', hubWallet.address);
    console.log('[Morpho-High-Gas] Target wallet:', walletAddress);
    console.log('[Morpho-High-Gas] Amount:', amount);
    
    // Create contracts
    const usdcABI = [
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)'
    ];
    
    const vaultABI = [
      'function deposit(uint256 assets, address onBehalf) external returns (uint256 shares)'
    ];
    
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, usdcABI, hubWallet);
    const vaultContract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, vaultABI, hubWallet);
    
    // Check balance
    const usdcBalance = await usdcContract.balanceOf(hubWallet.address);
    const usdcBalanceUsd = Number(ethers.formatUnits(usdcBalance, 6));
    
    console.log('[Morpho-High-Gas] USDC Balance:', usdcBalanceUsd.toFixed(6));
    
    if (usdcBalanceUsd < amount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient USDC. Have: $${usdcBalanceUsd.toFixed(6)}, Need: $${amount.toFixed(6)}`
      });
    }
    
    // Check allowance
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    const allowance = await usdcContract.allowance(hubWallet.address, MORPHO_GAUNTLET_USDC_VAULT);
    
    console.log('[Morpho-High-Gas] Current allowance:', ethers.formatUnits(allowance, 6));
    
    let approveTxHash = null;
    
    // Approve if needed
    if (allowance < amountWei) {
      console.log('[Morpho-High-Gas] Approving USDC...');
      
      const approveTx = await usdcContract.approve(MORPHO_GAUNTLET_USDC_VAULT, amountWei, {
        gasPrice: ethers.parseUnits('0.1', 'gwei'),
        gasLimit: 50000
      });
      
      approveTxHash = approveTx.hash;
      console.log('[Morpho-High-Gas] Approve tx:', approveTxHash);
      
      const approveReceipt = await approveTx.wait();
      console.log('[Morpho-High-Gas] Approve confirmed:', approveReceipt?.hash);
      
      if (!approveReceipt || approveReceipt.status !== 1) {
        return res.status(500).json({
          success: false,
          error: 'Approval transaction failed',
          txHash: approveTxHash
        });
      }
    }
    
    // Get current gas price
    const currentGasPrice = await provider.getFeeData();
    const suggestedGasPrice = currentGasPrice.gasPrice || ethers.parseUnits('0.1', 'gwei');
    const suggestedGasPriceGwei = Number(ethers.formatUnits(suggestedGasPrice, 'gwei'));
    
    console.log('[Morpho-High-Gas] Suggested gas price:', suggestedGasPriceGwei.toFixed(4), 'gwei');
    
    // Try with higher gas price
    const highGasPrice = ethers.parseUnits('0.5', 'gwei'); // 0.5 gwei
    const highGasPriceGwei = Number(ethers.formatUnits(highGasPrice, 'gwei'));
    
    console.log('[Morpho-High-Gas] Using higher gas price:', highGasPriceGwei.toFixed(4), 'gwei');
    
    // Deposit with higher gas price
    console.log('[Morpho-High-Gas] Depositing to vault...');
    
    const depositTx = await vaultContract.deposit(amountWei, walletAddress, {
      gasPrice: highGasPrice,
      gasLimit: 500000
    });
    
    console.log('[Morpho-High-Gas] Deposit tx:', depositTx.hash);
    
    const depositReceipt = await depositTx.wait();
    console.log('[Morpho-High-Gas] Deposit confirmed:', depositReceipt?.hash);
    
    if (!depositReceipt || depositReceipt.status !== 1) {
      return res.status(500).json({
        success: false,
        error: 'Deposit transaction failed',
        txHash: depositTx.hash,
        receipt: depositReceipt
      });
    }
    
    return res.status(200).json({
      success: true,
      gasPrice: {
        suggested: suggestedGasPriceGwei.toFixed(4),
        used: highGasPriceGwei.toFixed(4)
      },
      approveTxHash,
      depositTxHash: depositTx.hash,
      depositReceipt: {
        hash: depositReceipt?.hash,
        gasUsed: depositReceipt?.gasUsed?.toString(),
        status: depositReceipt?.status
      }
    });
    
  } catch (error) {
    console.error('[Morpho-High-Gas] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default handler;
