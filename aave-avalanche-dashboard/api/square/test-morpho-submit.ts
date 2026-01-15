/**
 * Test Morpho vault using submit function instead of deposit
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Morpho-Submit] ===== TESTING WITH SUBMIT FUNCTION =====');
    
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
    
    console.log('[Morpho-Submit] Hub wallet:', hubWallet.address);
    console.log('[Morpho-Submit] Target wallet:', walletAddress);
    console.log('[Morpho-Submit] Amount:', amount);
    
    // Create contracts
    const usdcABI = [
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)'
    ];
    
    const vaultABI = [
      'function submit(uint256 assets, address onBehalf) external returns (uint256 shares)',
      'function balanceOf(address account) view returns (uint256)',
      'function totalAssets() view returns (uint256)'
    ];
    
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, usdcABI, hubWallet);
    const vaultContract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, vaultABI, hubWallet);
    
    // Check balance
    const usdcBalance = await usdcContract.balanceOf(hubWallet.address);
    const usdcBalanceUsd = Number(ethers.formatUnits(usdcBalance, 6));
    
    console.log('[Morpho-Submit] USDC Balance:', usdcBalanceUsd.toFixed(6));
    
    if (usdcBalanceUsd < amount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient USDC. Have: $${usdcBalanceUsd.toFixed(6)}, Need: $${amount.toFixed(6)}`
      });
    }
    
    // Check allowance
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    const allowance = await usdcContract.allowance(hubWallet.address, MORPHO_GAUNTLET_USDC_VAULT);
    
    console.log('[Morpho-Submit] Current allowance:', ethers.formatUnits(allowance, 6));
    
    let approveTxHash = null;
    
    // Approve if needed
    if (allowance < amountWei) {
      console.log('[Morpho-Submit] Approving USDC...');
      
      const approveTx = await usdcContract.approve(MORPHO_GAUNTLET_USDC_VAULT, amountWei, {
        gasPrice: ethers.parseUnits('0.1', 'gwei'),
        gasLimit: 50000
      });
      
      approveTxHash = approveTx.hash;
      console.log('[Morpho-Submit] Approve tx:', approveTxHash);
      
      const approveReceipt = await approveTx.wait();
      console.log('[Morpho-Submit] Approve confirmed:', approveReceipt?.hash);
      
      if (!approveReceipt || approveReceipt.status !== 1) {
        return res.status(500).json({
          success: false,
          error: 'Approval transaction failed',
          txHash: approveTxHash
        });
      }
    }
    
    // Get vault stats before
    const totalAssetsBefore = await vaultContract.totalAssets();
    const balanceBefore = await vaultContract.balanceOf(walletAddress);
    
    console.log('[Morpho-Submit] Vault total assets before:', ethers.formatUnits(totalAssetsBefore, 6));
    console.log('[Morpho-Submit] User balance before:', ethers.formatUnits(balanceBefore, 18));
    
    // Submit to vault (using submit instead of deposit)
    console.log('[Morpho-Submit] Submitting to vault...');
    
    const submitTx = await vaultContract.submit(amountWei, walletAddress, {
      gasPrice: ethers.parseUnits('0.1', 'gwei'),
      gasLimit: 500000
    });
    
    console.log('[Morpho-Submit] Submit tx:', submitTx.hash);
    
    const submitReceipt = await submitTx.wait();
    console.log('[Morpho-Submit] Submit confirmed:', submitReceipt?.hash);
    
    if (!submitReceipt || submitReceipt.status !== 1) {
      return res.status(500).json({
        success: false,
        error: 'Submit transaction failed',
        txHash: submitTx.hash,
        receipt: submitReceipt
      });
    }
    
    // Get vault stats after
    const totalAssetsAfter = await vaultContract.totalAssets();
    const balanceAfter = await vaultContract.balanceOf(walletAddress);
    
    console.log('[Morpho-Submit] Vault total assets after:', ethers.formatUnits(totalAssetsAfter, 6));
    console.log('[Morpho-Submit] User balance after:', ethers.formatUnits(balanceAfter, 18));
    
    // Calculate changes
    const assetsChange = totalAssetsAfter - totalAssetsBefore;
    const sharesReceived = balanceAfter - balanceBefore;
    
    return res.status(200).json({
      success: true,
      function: 'submit(uint256 assets, address onBehalf)',
      approveTxHash,
      submitTxHash: submitTx.hash,
      submitReceipt: {
        hash: submitReceipt?.hash,
        gasUsed: submitReceipt?.gasUsed?.toString(),
        status: submitReceipt?.status
      },
      changes: {
        assetsAdded: ethers.formatUnits(assetsChange, 6),
        sharesReceived: ethers.formatUnits(sharesReceived, 18)
      },
      balances: {
        vaultTotalAssets: ethers.formatUnits(totalAssetsAfter, 6),
        userShares: ethers.formatUnits(balanceAfter, 18)
      }
    });
    
  } catch (error) {
    console.error('[Morpho-Submit] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default handler;
