/**
 * Check Morpho vault status and requirements
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Vault-Status] ===== CHECKING VAULT STATUS =====');
    
    const ARBITRUM_RPC = 'https://arb1.arbitrum.io/rpc';
    const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65';
    const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    
    // Full ERC4626 vault ABI with all possible functions
    const vaultABI = [
      'function asset() external view returns (address)',
      'function totalAssets() external view returns (uint256)',
      'function maxDeposit(address) external view returns (uint256)',
      'function maxDeposit(address user) external view returns (uint256)',
      'function maxMint(address) external view returns (uint256)',
      'function maxWithdraw(address) external view returns (uint256)',
      'function maxRedeem(address) external view returns (uint256)',
      'function previewDeposit(uint256 assets) external view returns (uint256)',
      'function previewMint(uint256 shares) external view returns (uint256)',
      'function previewWithdraw(uint256 assets) external view returns (uint256)',
      'function previewRedeem(uint256 shares) external view returns (uint256)',
      'function paused() external view returns (bool)',
      'function deposit(uint256 assets, address receiver) external returns (uint256)',
      'function mint(uint256 shares, address receiver) external returns (uint256)',
      'function withdraw(uint256 assets, address receiver, address owner) external returns (uint256)',
      'function redeem(uint256 shares, address receiver, address owner) external returns (uint256)',
      'function balanceOf(address account) external view returns (uint256)',
      'function totalSupply() external view returns (uint256)',
      'function name() external view returns (string)',
      'function symbol() external view returns (string)',
      'function decimals() external view returns (uint8)',
      'function apiVersion() external view returns (string)'
    ];
    
    const vaultContract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, vaultABI, provider);
    
    const status: any = {
      address: MORPHO_GAUNTLET_USDC_VAULT,
      checks: {}
    };
    
    try {
      // Basic info
      status.checks.name = await vaultContract.name();
      status.checks.symbol = await vaultContract.symbol();
      status.checks.decimals = await vaultContract.decimals();
      status.checks.asset = await vaultContract.asset();
      status.checks.totalAssets = ethers.formatUnits(await vaultContract.totalAssets(), 6);
      status.checks.totalSupply = ethers.formatUnits(await vaultContract.totalSupply(), 18);
      
      // Check if paused
      try {
        status.checks.paused = await vaultContract.paused();
      } catch (e) {
        status.checks.paused = 'Function not available';
      }
      
      // Check API version
      try {
        status.checks.apiVersion = await vaultContract.apiVersion();
      } catch (e) {
        status.checks.apiVersion = 'Not available';
      }
      
      // Check max deposit for test user
      const testUser = '0x5c71b7be6aac81b3b1a8b88adf475dde24293c67';
      try {
        const maxDeposit = await vaultContract.maxDeposit(testUser);
        status.checks.maxDeposit = ethers.formatUnits(maxDeposit, 6);
        status.checks.maxDepositRaw = maxDeposit.toString();
      } catch (e) {
        status.checks.maxDeposit = `Error: ${(e as Error).message}`;
      }
      
      // Preview deposit of 1 USDC
      try {
        const previewAmount = ethers.parseUnits('1', 6);
        const previewShares = await vaultContract.previewDeposit(previewAmount);
        status.checks.previewDeposit = {
          amount: '1.000000',
          shares: ethers.formatUnits(previewShares, 18),
          sharesRaw: previewShares.toString()
        };
      } catch (e) {
        status.checks.previewDeposit = `Error: ${(e as Error).message}`;
      }
      
      // Check if vault would accept deposit
      try {
        const testAmount = ethers.parseUnits('1', 6);
        const maxDeposit = await vaultContract.maxDeposit(testUser);
        status.checks.canDeposit = maxDeposit >= testAmount;
        status.checks.depositReason = maxDeposit >= testAmount ? 'Can deposit' : `Max deposit: ${ethers.formatUnits(maxDeposit, 6)}`;
      } catch (e) {
        status.checks.canDeposit = `Error: ${(e as Error).message}`;
        status.checks.depositReason = 'Could not determine';
      }
      
      // Check vault balance
      try {
        const vaultBalance = await provider.getBalance(MORPHO_GAUNTLET_USDC_VAULT);
        status.checks.vaultEthBalance = ethers.formatEther(vaultBalance);
      } catch (e) {
        status.checks.vaultEthBalance = `Error: ${(e as Error).message}`;
      }
      
    } catch (error) {
      status.error = (error as Error).message;
    }
    
    console.log('[Vault-Status] Status check completed');
    
    // Convert BigInt to string for JSON serialization
    const jsonSafeStatus = JSON.parse(JSON.stringify(status, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
    
    return res.status(200).json({
      success: true,
      status: jsonSafeStatus,
      recommendations: []
    });
    
  } catch (error) {
    console.error('[Vault-Status] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export default handler;
