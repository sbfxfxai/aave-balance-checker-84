/**
 * Test using the exact same approach as the original code
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Morpho-Original] ===== TESTING WITH ORIGINAL APPROACH =====');
    
    const { walletAddress, amount = 1.00 } = req.body;
    
    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }
    
    // Configuration - exactly same as original
    const ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc';
    const ARBITRUM_HUB_WALLET_PRIVATE_KEY = process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY || process.env.HUB_WALLET_PRIVATE_KEY || '';
    const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65';
    
    // Connect to Arbitrum
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    const hubWallet = new ethers.Wallet(ARBITRUM_HUB_WALLET_PRIVATE_KEY, provider);
    
    console.log('[Morpho-Original] Hub wallet:', hubWallet.address);
    console.log('[Morpho-Original] Target wallet:', walletAddress);
    console.log('[Morpho-Original] Amount:', amount);
    
    // Use exact same ABIs as original
    const ERC20_ABI = [
      'function balanceOf(address) view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 amount) returns (bool)'
    ];
    
    const ERC4626_VAULT_ABI = [
      'function asset() view returns (address)',
      'function totalAssets() view returns (uint256)',
      'function maxDeposit(address) view returns (uint256)',
      'function deposit(uint256 assets, address receiver) external returns (uint256 shares)',
      'function balanceOf(address account) view returns (uint256)'
    ];
    
    // Create contracts exactly like original
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, ERC20_ABI, hubWallet);
    const gauntletVault = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, ERC4626_VAULT_ABI, hubWallet);
    
    // Convert amounts exactly like original
    const amountWei = BigInt(Math.floor(amount * 1_000_000));
    
    console.log('[Morpho-Original] Amount in wei:', amountWei.toString());
    
    // Check balance
    const hubBalance = await usdcContract.balanceOf(hubWallet.address);
    const hubBalanceUsd = Number(hubBalance) / 1_000_000;
    
    console.log('[Morpho-Original] Hub wallet USDC balance: $' + hubBalanceUsd.toFixed(6));
    
    if (hubBalance < amountWei) {
      return res.status(400).json({
        success: false,
        error: `Insufficient USDC. Have: $${hubBalanceUsd.toFixed(6)}, Need: $${amount.toFixed(6)}`
      });
    }
    
    // Get gas price exactly like original
    async function getOptimalGasPrice(provider: ethers.JsonRpcProvider): Promise<bigint> {
      return ethers.parseUnits('0.1', 'gwei'); // Use fixed low gas price for testing
    }
    
    const gasPrice = await getOptimalGasPrice(provider);
    const gasPriceGwei = Number(gasPrice) / 1e9;
    console.log('[Morpho-Original] Using gas price: ' + gasPriceGwei.toFixed(2) + ' gwei');
    
    // Check and approve exactly like original
    const gauntletAllowance = await usdcContract.allowance(hubWallet.address, MORPHO_GAUNTLET_USDC_VAULT);
    console.log('[Morpho-Original] Current allowance:', Number(gauntletAllowance) / 1_000_000);
    
    let approveTxHash = null;
    
    if (gauntletAllowance < amountWei) {
      console.log('[Morpho-Original] Approving USDC for GauntletUSDC vault...');
      
      const approveTx = await usdcContract.approve(MORPHO_GAUNTLET_USDC_VAULT, ethers.MaxUint256, { gasPrice });
      approveTxHash = approveTx.hash;
      console.log('[Morpho-Original] Approval transaction:', approveTxHash);
      
      const approveReceipt = await approveTx.wait();
      console.log('[Morpho-Original] Approval confirmed:', approveReceipt?.hash);
      
      if (!approveReceipt || approveReceipt.status !== 1) {
        return res.status(500).json({
          success: false,
          error: 'Approval transaction failed',
          txHash: approveTxHash
        });
      }
    }
    
    // Check user balance before
    const userBalanceBefore = await gauntletVault.balanceOf(walletAddress);
    console.log('[Morpho-Original] User balance before:', Number(userBalanceBefore) / 1e18);
    
    // Deposit exactly like original
    console.log('[Morpho-Original] Depositing $' + amount + ' to GauntletUSDC vault...');
    
    const depositGauntletTx = await gauntletVault.deposit(amountWei, walletAddress, { gasPrice });
    const gauntletTxHash = depositGauntletTx.hash;
    console.log('[Morpho-Original] GauntletUSDC deposit transaction:', gauntletTxHash);
    
    const depositReceipt = await depositGauntletTx.wait();
    console.log('[Morpho-Original] Deposit confirmed:', depositReceipt?.hash);
    
    if (!depositReceipt || depositReceipt.status !== 1) {
      return res.status(500).json({
        success: false,
        error: 'Deposit transaction failed',
        txHash: gauntletTxHash,
        receipt: depositReceipt
      });
    }
    
    // Check user balance after
    const userBalanceAfter = await gauntletVault.balanceOf(walletAddress);
    console.log('[Morpho-Original] User balance after:', Number(userBalanceAfter) / 1e18);
    
    const sharesReceived = userBalanceAfter - userBalanceBefore;
    
    return res.status(200).json({
      success: true,
      approveTxHash,
      depositTxHash: gauntletTxHash,
      depositReceipt: {
        hash: depositReceipt?.hash,
        gasUsed: depositReceipt?.gasUsed?.toString(),
        status: depositReceipt?.status
      },
      sharesReceived: (Number(sharesReceived) / 1e18).toFixed(18),
      userBalance: (Number(userBalanceAfter) / 1e18).toFixed(18)
    });
    
  } catch (error) {
    console.error('[Morpho-Original] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default handler;
