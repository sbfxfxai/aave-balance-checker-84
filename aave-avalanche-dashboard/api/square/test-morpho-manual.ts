/**
 * Test with manual transaction data encoding
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Morpho-Manual] ===== MANUAL TRANSACTION ENCODING =====');
    
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
    
    console.log('[Morpho-Manual] Hub wallet:', hubWallet.address);
    console.log('[Morpho-Manual] Target wallet:', walletAddress);
    console.log('[Morpho-Manual] Amount:', amount);
    
    // Create interface for encoding
    const vaultInterface = new ethers.Interface([
      'function deposit(uint256 assets, address receiver) external returns (uint256 shares)',
      'function submit(uint256 assets, address onBehalf) external returns (uint256 shares)'
    ]);
    
    // Encode the function call manually
    const amountWei = ethers.parseUnits(amount.toString(), 6);
    
    // Try deposit function
    const depositData = vaultInterface.encodeFunctionData('deposit', [amountWei, walletAddress]);
    console.log('[Morpho-Manual] Deposit function data:', depositData);
    
    // Try submit function
    const submitData = vaultInterface.encodeFunctionData('submit', [amountWei, walletAddress]);
    console.log('[Morpho-Manual] Submit function data:', submitData);
    
    // Create USDC contract for approval
    const usdcInterface = new ethers.Interface([
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)'
    ]);
    
    // Check allowance
    const allowanceData = usdcInterface.encodeFunctionData('allowance', [hubWallet.address, MORPHO_GAUNTLET_USDC_VAULT]);
    const allowanceCall = await provider.call({
      to: USDC_ARBITRUM,
      data: allowanceData
    });
    const allowance = BigInt(allowanceCall);
    
    console.log('[Morpho-Manual] Current allowance:', ethers.formatUnits(allowance, 6));
    
    let approveTxHash = null;
    
    // Approve if needed
    if (allowance < amountWei) {
      console.log('[Morpho-Manual] Approving USDC...');
      
      const approveData = usdcInterface.encodeFunctionData('approve', [MORPHO_GAUNTLET_USDC_VAULT, amountWei]);
      
      const approveTx = await hubWallet.sendTransaction({
        to: USDC_ARBITRUM,
        data: approveData,
        gasPrice: ethers.parseUnits('0.1', 'gwei'),
        gasLimit: 50000
      });
      
      approveTxHash = approveTx.hash;
      console.log('[Morpho-Manual] Approve tx:', approveTxHash);
      
      const approveReceipt = await approveTx.wait();
      console.log('[Morpho-Manual] Approve confirmed:', approveReceipt?.hash);
      
      if (!approveReceipt || approveReceipt.status !== 1) {
        return res.status(500).json({
          success: false,
          error: 'Approval transaction failed',
          txHash: approveTxHash
        });
      }
    }
    
    // Try deposit with manual encoding
    console.log('[Morpho-Manual] Trying deposit with manual encoding...');
    
    try {
      const depositTx = await hubWallet.sendTransaction({
        to: MORPHO_GAUNTLET_USDC_VAULT,
        data: depositData,
        gasPrice: ethers.parseUnits('0.1', 'gwei'),
        gasLimit: 500000
      });
      
      console.log('[Morpho-Manual] Deposit tx:', depositTx.hash);
      
      const depositReceipt = await depositTx.wait();
      console.log('[Morpho-Manual] Deposit confirmed:', depositReceipt?.hash);
      
      if (!depositReceipt || depositReceipt.status !== 1) {
        throw new Error('Deposit transaction failed');
      }
      
      return res.status(200).json({
        success: true,
        function: 'deposit(uint256 assets, address receiver)',
        method: 'manual encoding',
        approveTxHash,
        depositTxHash: depositTx.hash,
        depositReceipt: {
          hash: depositReceipt?.hash,
          gasUsed: depositReceipt?.gasUsed?.toString(),
          status: depositReceipt?.status
        }
      });
      
    } catch (depositError) {
      console.log('[Morpho-Manual] Deposit failed, trying submit...');
      
      // Try submit with manual encoding
      const submitTx = await hubWallet.sendTransaction({
        to: MORPHO_GAUNTLET_USDC_VAULT,
        data: submitData,
        gasPrice: ethers.parseUnits('0.1', 'gwei'),
        gasLimit: 500000
      });
      
      console.log('[Morpho-Manual] Submit tx:', submitTx.hash);
      
      const submitReceipt = await submitTx.wait();
      console.log('[Morpho-Manual] Submit confirmed:', submitReceipt?.hash);
      
      if (!submitReceipt || submitReceipt.status !== 1) {
        throw new Error('Submit transaction failed');
      }
      
      return res.status(200).json({
        success: true,
        function: 'submit(uint256 assets, address onBehalf)',
        method: 'manual encoding',
        approveTxHash,
        submitTxHash: submitTx.hash,
        submitReceipt: {
          hash: submitReceipt?.hash,
          gasUsed: submitReceipt?.gasUsed?.toString(),
          status: submitReceipt?.status
        }
      });
    }
    
  } catch (error) {
    console.error('[Morpho-Manual] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default handler;
