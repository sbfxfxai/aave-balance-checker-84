/**
 * Test Morpho deposit with step-by-step debugging
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Morpho-Debug] ===== STEP-BY-STEP MORPHO DEBUG =====');
    
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
    
    console.log('[Morpho-Debug] Hub wallet:', hubWallet.address);
    console.log('[Morpho-Debug] Target wallet:', walletAddress);
    console.log('[Morpho-Debug] Amount:', amount);
    
    // Create contracts
    const usdcABI = [
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function transfer(address to, uint256 amount) returns (bool)'
    ];
    
    const vaultABI = [
      'function asset() view returns (address)',
      'function deposit(uint256 assets, address onBehalf) external returns (uint256 shares)',
      'function balanceOf(address account) view returns (uint256)',
      'function totalAssets() view returns (uint256)',
      'function name() external view returns (string)'
    ];
    
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, usdcABI, hubWallet);
    const vaultContract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, vaultABI, hubWallet);
    
    // Step 1: Check balances
    const usdcBalance = await usdcContract.balanceOf(hubWallet.address);
    const usdcBalanceUsd = Number(ethers.formatUnits(usdcBalance, 6));
    
    console.log('[Morpho-Debug] USDC Balance:', usdcBalanceUsd.toFixed(6));
    
    if (usdcBalanceUsd < amount) {
      return res.status(400).json({
        success: false,
        error: `Insufficient USDC. Have: $${usdcBalanceUsd.toFixed(6)}, Need: $${amount.toFixed(6)}`
      });
    }
    
    // Step 2: Check vault
    const vaultAsset = await vaultContract.asset();
    const vaultName = await vaultContract.name();
    
    console.log('[Morpho-Debug] Vault:', vaultName);
    console.log('[Morpho-Debug] Vault Asset:', vaultAsset);
    console.log('[Morpho-Debug] Expected USDC:', USDC_ARBITRUM);
    
    if (vaultAsset.toLowerCase() !== USDC_ARBITRUM.toLowerCase()) {
      return res.status(500).json({
        success: false,
        error: 'Vault asset is not USDC',
        vaultAsset,
        expectedAsset: USDC_ARBITRUM
      });
    }
    
    // Step 3: Check allowance
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    const allowance = await usdcContract.allowance(hubWallet.address, MORPHO_GAUNTLET_USDC_VAULT);
    
    console.log('[Morpho-Debug] Current allowance:', ethers.formatUnits(allowance, 6));
    console.log('[Morpho-Debug] Required allowance:', ethers.formatUnits(amountWei, 6));
    
    let approveTxHash = null;
    
    // Step 4: Approve if needed
    if (allowance < amountWei) {
      console.log('[Morpho-Debug] Approving USDC...');
      
      const approveTx = await usdcContract.approve(MORPHO_GAUNTLET_USDC_VAULT, amountWei, {
        gasPrice: ethers.parseUnits('0.1', 'gwei'),
        gasLimit: 50000
      });
      
      approveTxHash = approveTx.hash;
      console.log('[Morpho-Debug] Approve tx:', approveTxHash);
      
      const approveReceipt = await approveTx.wait();
      console.log('[Morpho-Debug] Approve confirmed:', approveReceipt?.hash);
      
      if (!approveReceipt || approveReceipt.status !== 1) {
        return res.status(500).json({
          success: false,
          error: 'Approval transaction failed',
          txHash: approveTxHash
        });
      }
    }
    
    // Step 5: Deposit
    console.log('[Morpho-Debug] Depositing to vault...');
    
    const depositTx = await vaultContract.deposit(amountWei, walletAddress, {
      gasPrice: ethers.parseUnits('0.1', 'gwei'),
      gasLimit: 500000
    });
    
    console.log('[Morpho-Debug] Deposit tx:', depositTx.hash);
    
    const depositReceipt = await depositTx.wait();
    console.log('[Morpho-Debug] Deposit confirmed:', depositReceipt?.hash);
    
    if (!depositReceipt || depositReceipt.status !== 1) {
      return res.status(500).json({
        success: false,
        error: 'Deposit transaction failed',
        txHash: depositTx.hash,
        receipt: depositReceipt
      });
    }
    
    // Step 6: Check shares received
    const shares = await vaultContract.balanceOf(walletAddress);
    console.log('[Morpho-Debug] Shares received:', ethers.formatUnits(shares, 18));
    
    return res.status(200).json({
      success: true,
      steps: {
        balance: { checked: true, amount: usdcBalanceUsd.toFixed(6) },
        vault: { checked: true, name: vaultName, asset: vaultAsset },
        allowance: { checked: true, initial: ethers.formatUnits(allowance, 6), approved: allowance < amountWei },
        approve: { checked: true, txHash: approveTxHash },
        deposit: { checked: true, txHash: depositTx.hash, confirmed: depositReceipt?.hash },
        shares: { received: ethers.formatUnits(shares, 18) }
      },
      approveTxHash,
      depositTxHash: depositTx.hash
    });
    
  } catch (error) {
    console.error('[Morpho-Debug] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default handler;
