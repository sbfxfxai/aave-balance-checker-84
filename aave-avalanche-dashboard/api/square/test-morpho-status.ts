/**
 * Test Morpho Vault Status and Balance
 * 
 * Checks USDC balance in hub wallet and vault status before attempting deposit
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

// Arbitrum RPC
const ARBITRUM_RPC_URL = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';
const ARBITRUM_HUB_WALLET_PRIVATE_KEY = process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY || process.env.HUB_WALLET_PRIVATE_KEY || '';

// Token and vault addresses
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // 6 decimals
const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65';
const MORPHO_HYPERITHM_USDC_VAULT = '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027';

// ERC20 ABI (minimal)
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

// ERC4626 Vault ABI (minimal)
const VAULT_ABI = [
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function paused() view returns (bool)'
];

async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    console.log('[Morpho-Status] ===== CHECKING MORPHO STATUS =====');
    
    // Connect to Arbitrum
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC_URL);
    const hubWallet = new ethers.Wallet(ARBITRUM_HUB_WALLET_PRIVATE_KEY, provider);
    
    console.log('[Morpho-Status] Hub wallet:', hubWallet.address);
    console.log('[Morpho-Status] Connected to Arbitrum');
    
    // Create contracts
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, ERC20_ABI, provider);
    const gauntletVault = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, VAULT_ABI, provider);
    const hyperithmVault = new ethers.Contract(MORPHO_HYPERITHM_USDC_VAULT, VAULT_ABI, provider);
    
    // Check USDC balance
    const usdcBalanceRaw = await usdcContract.balanceOf(hubWallet.address);
    const usdcBalance = Number(ethers.formatUnits(usdcBalanceRaw, 6));
    console.log('[Morpho-Status] USDC Balance:', usdcBalance.toFixed(6), 'USDC');
    
    // Check allowances
    const gauntletAllowanceRaw = await usdcContract.allowance(hubWallet.address, MORPHO_GAUNTLET_USDC_VAULT);
    const hyperithmAllowanceRaw = await usdcContract.allowance(hubWallet.address, MORPHO_HYPERITHM_USDC_VAULT);
    const gauntletAllowance = Number(ethers.formatUnits(gauntletAllowanceRaw, 6));
    const hyperithmAllowance = Number(ethers.formatUnits(hyperithmAllowanceRaw, 6));
    
    console.log('[Morpho-Status] GauntletUSDC Allowance:', gauntletAllowance.toFixed(6), 'USDC');
    console.log('[Morpho-Status] HyperithmUSDC Allowance:', hyperithmAllowance.toFixed(6), 'USDC');
    
    // Check vault status
    const gauntletTotalAssetsRaw = await gauntletVault.totalAssets();
    const hyperithmTotalAssetsRaw = await hyperithmVault.totalAssets();
    const gauntletTotalAssets = Number(ethers.formatUnits(gauntletTotalAssetsRaw, 6));
    const hyperithmTotalAssets = Number(ethers.formatUnits(hyperithmTotalAssetsRaw, 6));
    
    console.log('[Morpho-Status] GauntletUSDC Total Assets:', gauntletTotalAssets.toFixed(6), 'USDC');
    console.log('[Morpho-Status] HyperithmUSDC Total Assets:', hyperithmTotalAssets.toFixed(6), 'USDC');
    
    // Check max deposit
    const gauntletMaxDepositRaw = await gauntletVault.maxDeposit(hubWallet.address);
    const hyperithmMaxDepositRaw = await hyperithmVault.maxDeposit(hubWallet.address);
    const gauntletMaxDeposit = Number(ethers.formatUnits(gauntletMaxDepositRaw, 6));
    const hyperithmMaxDeposit = Number(ethers.formatUnits(hyperithmMaxDepositRaw, 6));
    
    console.log('[Morpho-Status] GauntletUSDC Max Deposit:', gauntletMaxDeposit.toFixed(6), 'USDC');
    console.log('[Morpho-Status] HyperithmUSDC Max Deposit:', hyperithmMaxDeposit.toFixed(6), 'USDC');
    
    // Check if vaults are paused
    let gauntletPaused = false;
    let hyperithmPaused = false;
    
    try {
      gauntletPaused = await gauntletVault.paused();
      console.log('[Morpho-Status] GauntletUSDC Paused:', gauntletPaused);
    } catch (e) {
      console.log('[Morpho-Status] GauntletUSDC: Pause function not available');
    }
    
    try {
      hyperithmPaused = await hyperithmVault.paused();
      console.log('[Morpho-Status] HyperithmUSDC Paused:', hyperithmPaused);
    } catch (e) {
      console.log('[Morpho-Status] HyperithmUSDC: Pause function not available');
    }
    
    // Test amounts
    const testAmount = 1.00;
    const canDepositGauntlet = usdcBalance >= testAmount && gauntletMaxDeposit >= testAmount && !gauntletPaused;
    const canDepositHyperithm = usdcBalance >= testAmount && hyperithmMaxDeposit >= testAmount && !hyperithmPaused;
    
    const result = {
      success: true,
      hubWallet: hubWallet.address,
      usdcBalance: usdcBalance.toFixed(6),
      allowances: {
        gauntlet: gauntletAllowance.toFixed(6),
        hyperithm: hyperithmAllowance.toFixed(6)
      },
      vaults: {
        gauntlet: {
          totalAssets: gauntletTotalAssets.toFixed(6),
          maxDeposit: gauntletMaxDeposit.toFixed(6),
          paused: gauntletPaused,
          canDeposit: canDepositGauntlet
        },
        hyperithm: {
          totalAssets: hyperithmTotalAssets.toFixed(6),
          maxDeposit: hyperithmMaxDeposit.toFixed(6),
          paused: hyperithmPaused,
          canDeposit: canDepositHyperithm
        }
      },
      testAmount: testAmount,
      canDepositBoth: canDepositGauntlet && canDepositHyperithm,
      recommendations: [] as string[]
    };
    
    // Add recommendations
    if (usdcBalance < testAmount * 2) {
      result.recommendations.push(`Insufficient USDC balance. Need at least $${(testAmount * 2).toFixed(2)}, have $${usdcBalance.toFixed(2)}`);
    }
    
    if (gauntletAllowance < testAmount) {
      result.recommendations.push('GauntletUSDC vault needs approval');
    }
    
    if (hyperithmAllowance < testAmount) {
      result.recommendations.push('HyperithmUSDC vault needs approval');
    }
    
    if (!canDepositGauntlet) {
      result.recommendations.push('GauntletUSDC vault cannot accept deposits');
    }
    
    if (!canDepositHyperithm) {
      result.recommendations.push('HyperithmUSDC vault cannot accept deposits');
    }
    
    console.log('[Morpho-Status] Status check completed');
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('[Morpho-Status] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default handler;
