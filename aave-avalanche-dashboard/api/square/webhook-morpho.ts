/**
 * Enhanced Morpho Webhook - Production-Ready Implementation
 * 
 * Handles Morpho vault deposits on Arbitrum with comprehensive error handling,
 * monitoring, and security features.
 */

import { ethers } from 'ethers';
import { updatePosition } from '../positions/store';

// Configuration with fallbacks
const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';
const ARBITRUM_HUB_WALLET_PRIVATE_KEY = process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY || process.env.HUB_WALLET_PRIVATE_KEY || '';
const ARBITRUM_HUB_WALLET_ADDRESS = process.env.ARBITRUM_HUB_WALLET_ADDRESS || process.env.HUB_WALLET_ADDRESS || '0x34c11928868d14bdD7Be55A0D9f9e02257240c24';

// Morpho Vault addresses on Arbitrum
const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65';
const MORPHO_HYPERITHM_USDC_VAULT = '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027';

// Token addresses
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // 6 decimals

// Limits
const MIN_DEPOSIT_PER_VAULT_USD = 1;
const MAX_GAS_PRICE_GWEI = 100;
const MIN_GAS_PRICE_GWEI = 0.1;
const TRANSACTION_TIMEOUT_MS = 180000; // 3 minutes
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// ABIs
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const ERC4626_VAULT_ABI = [
  'function deposit(uint256 assets, address onBehalf) external returns (uint256 shares)',
  'function asset() external view returns (address)',
  'function balanceOf(address account) view returns (uint256)',
  'function previewDeposit(uint256 assets) public view returns (uint256)',
  'function totalAssets() external view returns (uint256)',
  'function paused() external view returns (bool)', // Some vaults have pause functionality
  'function maxDeposit(address) external view returns (uint256)', // ERC-4626 optional: max deposit per user
];

interface MorphoDepositResult {
  success: boolean;
  gauntletTxHash?: string;
  hyperithmTxHash?: string;
  gauntletShares?: string;
  hyperithmShares?: string;
  totalGasUsed?: string;
  error?: string;
  errorCode?: string;
}

function validatePrivateKey(key: string): { valid: boolean; cleanKey?: string; error?: string } {
  if (!key || key === '') {
    return { valid: false, error: 'Private key not configured' };
  }
  
  const cleanKey = key.startsWith('0x') ? key : `0x${key}`;
  
  if (cleanKey.length !== 66) {
    return { valid: false, error: 'Private key must be 32 bytes (64 hex chars)' };
  }
  
  if (!/^0x[a-fA-F0-9]{64}$/.test(cleanKey)) {
    return { valid: false, error: 'Private key contains invalid characters' };
  }
  
  return { valid: true, cleanKey };
}

function validateWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyContractExists(provider: ethers.Provider, address: string, name: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const code = await provider.getCode(address);
    
    if (!code || code === '0x' || code.length < 4) {
      return { valid: false, error: `${name} contract not found at ${address}` };
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: `Failed to verify ${name} contract: ${error instanceof Error ? error.message : 'Unknown'}` };
  }
}

async function getOptimalGasPrice(provider: ethers.Provider): Promise<bigint> {
  try {
    const feeData = await provider.getFeeData();
    const rawGasPrice = feeData.gasPrice || feeData.maxFeePerGas;
    let gasPrice = rawGasPrice ? BigInt(rawGasPrice.toString()) : ethers.parseUnits('70', 'gwei');
    
    // Add 20% buffer to base fee if available
    const block = await provider.getBlock('latest');
    if (block?.baseFeePerGas) {
      const baseFee = BigInt(block.baseFeePerGas.toString());
      const minGasPrice = (baseFee * 120n) / 100n;
      if (gasPrice < minGasPrice) {
        gasPrice = minGasPrice;
      }
    }
    
    // Apply bounds
    const minGasPrice = ethers.parseUnits(MIN_GAS_PRICE_GWEI.toString(), 'gwei');
    const maxGasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    
    if (gasPrice < minGasPrice) gasPrice = minGasPrice;
    if (gasPrice > maxGasPrice) gasPrice = maxGasPrice;
    
    return gasPrice;
  } catch (error) {
    console.warn('[MORPHO] Failed to fetch gas price, using default 70 gwei');
    return ethers.parseUnits('70', 'gwei');
  }
}

async function waitForTransaction(
  tx: ethers.TransactionResponse,
  description: string
): Promise<{ success: boolean; receipt?: ethers.TransactionReceipt; error?: string }> {
  try {
    const receipt = await Promise.race([
      tx.wait(),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Transaction timeout')), TRANSACTION_TIMEOUT_MS)
      )
    ]);
    
    if (!receipt || receipt.status !== 1) {
      return { 
        success: false, 
        error: `${description} failed. Status: ${receipt?.status || 'unknown'}` 
      };
    }
    
    return { success: true, receipt };
  } catch (error) {
    if (error instanceof Error && error.message === 'Transaction timeout') {
      return { success: false, error: `${description} timed out after ${TRANSACTION_TIMEOUT_MS / 1000}s` };
    }
    
    return { 
      success: false, 
      error: `${description} error: ${error instanceof Error ? error.message : 'Unknown'}` 
    };
  }
}

/**
 * Execute Morpho strategy with comprehensive error handling and monitoring
 */
export async function executeMorphoFromHubWallet(
  walletAddress: string,
  gauntletAmount: number,
  hyperithmAmount: number,
  paymentId: string,
  positionId?: string
): Promise<MorphoDepositResult> {
  console.log(`[MORPHO] Starting execution for ${walletAddress}`, {
    gauntletAmount: `$${gauntletAmount}`,
    hyperithmAmount: `$${hyperithmAmount}`,
    paymentId,
    positionId,
  });
  
  // Validate wallet address
  if (!validateWalletAddress(walletAddress)) {
    return { 
      success: false, 
      error: 'Invalid wallet address format',
      errorCode: 'INVALID_WALLET_ADDRESS'
    };
  }
  
  // Validate amounts
  if (gauntletAmount < MIN_DEPOSIT_PER_VAULT_USD) {
    return { 
      success: false, 
      error: `GauntletUSDC amount must be at least $${MIN_DEPOSIT_PER_VAULT_USD}`,
      errorCode: 'AMOUNT_TOO_LOW'
    };
  }
  
  if (hyperithmAmount < MIN_DEPOSIT_PER_VAULT_USD) {
    return { 
      success: false, 
      error: `HyperithmUSDC amount must be at least $${MIN_DEPOSIT_PER_VAULT_USD}`,
      errorCode: 'AMOUNT_TOO_LOW'
    };
  }
  
  // Validate configuration
  const keyValidation = validatePrivateKey(ARBITRUM_HUB_WALLET_PRIVATE_KEY);
  if (!keyValidation.valid) {
    return { 
      success: false, 
      error: keyValidation.error!,
      errorCode: 'INVALID_CONFIG'
    };
  }
  
  const cleanKey = keyValidation.cleanKey!;
  
  try {
    // Update position status
    if (positionId) {
      await updatePosition(positionId, { 
        status: 'executing'
      });
    }
    
    // Connect to Arbitrum
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    const network = await provider.getNetwork();
    
    if (network.chainId !== 42161n) {
      return { 
        success: false, 
        error: `Wrong network: Expected Arbitrum (42161), got ${network.chainId}`,
        errorCode: 'WRONG_NETWORK'
      };
    }
    
    const hubWallet = new ethers.Wallet(cleanKey, provider);
    
    // Verify hub wallet address matches
    if (hubWallet.address.toLowerCase() !== ARBITRUM_HUB_WALLET_ADDRESS.toLowerCase()) {
      return { 
        success: false, 
        error: 'Private key does not match configured hub wallet address',
        errorCode: 'WALLET_MISMATCH'
      };
    }
    
    console.log(`[MORPHO] Connected to Arbitrum, hub wallet: ${hubWallet.address}`);
    
    // Verify all contracts exist
    const contractChecks = await Promise.all([
      verifyContractExists(provider, USDC_ARBITRUM, 'USDC'),
      verifyContractExists(provider, MORPHO_GAUNTLET_USDC_VAULT, 'GauntletUSDC Vault'),
      verifyContractExists(provider, MORPHO_HYPERITHM_USDC_VAULT, 'HyperithmUSDC Vault'),
    ]);
    
    const failedCheck = contractChecks.find(check => !check.valid);
    if (failedCheck) {
      return { 
        success: false, 
        error: failedCheck.error!,
        errorCode: 'CONTRACT_NOT_FOUND'
      };
    }
    
    // Create contract instances
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, ERC20_ABI, hubWallet);
    const gauntletVault = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, ERC4626_VAULT_ABI, hubWallet);
    const hyperithmVault = new ethers.Contract(MORPHO_HYPERITHM_USDC_VAULT, ERC4626_VAULT_ABI, hubWallet);
    
    // Convert amounts (USDC has 6 decimals)
    const gauntletAmountWei = BigInt(Math.floor(gauntletAmount * 1_000_000));
    const hyperithmAmountWei = BigInt(Math.floor(hyperithmAmount * 1_000_000));
    const totalAmountWei = gauntletAmountWei + hyperithmAmountWei;
    
    // Check hub wallet balance
    const hubBalance = await usdcContract.balanceOf(hubWallet.address);
    const hubBalanceUsd = Number(hubBalance) / 1_000_000;
    
    console.log(`[MORPHO] Hub wallet USDC balance: $${hubBalanceUsd}`);
    
    if (hubBalance < totalAmountWei) {
      return { 
        success: false, 
        error: `Insufficient USDC in hub wallet. Have: $${hubBalanceUsd.toFixed(2)}, Need: $${(gauntletAmount + hyperithmAmount).toFixed(2)}`,
        errorCode: 'INSUFFICIENT_BALANCE'
      };
    }
    
    // Get optimal gas price
    const gasPrice = await getOptimalGasPrice(provider);
    const gasPriceGwei = Number(gasPrice) / 1e9;
    console.log(`[MORPHO] Using gas price: ${gasPriceGwei.toFixed(2)} gwei`);
    
    let totalGasUsed = 0n;
    
    // === Pre-flight checks: Vault utilization and health ===
    console.log(`[MORPHO] Performing pre-flight vault checks...`);
    
    // Check Gauntlet vault
    const gauntletVaultContract = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, ERC4626_VAULT_ABI, provider);
    try {
      const gauntletTotalAssets = await gauntletVaultContract.totalAssets();
      const gauntletTotalAssetsUsd = Number(gauntletTotalAssets) / 1_000_000;
      console.log(`[MORPHO] GauntletUSDC vault total assets: $${gauntletTotalAssetsUsd.toFixed(2)}`);
      
      // Check if vault is paused (if supported)
      try {
        const gauntletPaused = await gauntletVaultContract.paused();
        if (gauntletPaused) {
          return {
            success: false,
            error: 'GauntletUSDC vault is paused - deposits are temporarily disabled',
            errorCode: 'VAULT_PAUSED'
          };
        }
      } catch {
        // Pause function not available - vault doesn't support pausing, continue
      }
      
      // Preview deposit to check if it would succeed
      try {
        const gauntletPreviewShares = await gauntletVaultContract.previewDeposit(gauntletAmountWei);
        console.log(`[MORPHO] GauntletUSDC deposit preview: ${gauntletAmountWei} assets → ${gauntletPreviewShares} shares`);
        if (gauntletPreviewShares === 0n) {
          return {
            success: false,
            error: 'GauntletUSDC vault deposit would result in zero shares - vault may be at capacity',
            errorCode: 'VAULT_CAPACITY_EXCEEDED'
          };
        }
      } catch (previewError) {
        console.warn('[MORPHO] Could not preview GauntletUSDC deposit (may not be supported):', previewError);
      }
    } catch (checkError) {
      console.warn('[MORPHO] Could not check GauntletUSDC vault status:', checkError);
      // Continue with deposit attempt - some checks may not be available
    }
    
    // Check Hyperithm vault
    const hyperithmVaultContract = new ethers.Contract(MORPHO_HYPERITHM_USDC_VAULT, ERC4626_VAULT_ABI, provider);
    try {
      const hyperithmTotalAssets = await hyperithmVaultContract.totalAssets();
      const hyperithmTotalAssetsUsd = Number(hyperithmTotalAssets) / 1_000_000;
      console.log(`[MORPHO] HyperithmUSDC vault total assets: $${hyperithmTotalAssetsUsd.toFixed(2)}`);
      
      // Check if vault is paused (if supported)
      try {
        const hyperithmPaused = await hyperithmVaultContract.paused();
        if (hyperithmPaused) {
          return {
            success: false,
            error: 'HyperithmUSDC vault is paused - deposits are temporarily disabled',
            errorCode: 'VAULT_PAUSED'
          };
        }
      } catch {
        // Pause function not available - vault doesn't support pausing, continue
      }
      
      // Preview deposit to check if it would succeed
      try {
        const hyperithmPreviewShares = await hyperithmVaultContract.previewDeposit(hyperithmAmountWei);
        console.log(`[MORPHO] HyperithmUSDC deposit preview: ${hyperithmAmountWei} assets → ${hyperithmPreviewShares} shares`);
        if (hyperithmPreviewShares === 0n) {
          return {
            success: false,
            error: 'HyperithmUSDC vault deposit would result in zero shares - vault may be at capacity',
            errorCode: 'VAULT_CAPACITY_EXCEEDED'
          };
        }
      } catch (previewError) {
        console.warn('[MORPHO] Could not preview HyperithmUSDC deposit (may not be supported):', previewError);
      }
    } catch (checkError) {
      console.warn('[MORPHO] Could not check HyperithmUSDC vault status:', checkError);
      // Continue with deposit attempt - some checks may not be available
    }
    
    console.log(`[MORPHO] ✅ Pre-flight checks passed - proceeding with deposits`);
    
    // === Step 1: Deposit to GauntletUSDC Vault ===
    console.log(`[MORPHO] Step 1: Depositing $${gauntletAmount} to GauntletUSDC vault...`);
    
    // Check and approve if needed
    const gauntletAllowance = await usdcContract.allowance(hubWallet.address, MORPHO_GAUNTLET_USDC_VAULT);
    if (gauntletAllowance < gauntletAmountWei) {
      console.log('[MORPHO] Approving USDC for GauntletUSDC vault...');
      const approveTx = await usdcContract.approve(MORPHO_GAUNTLET_USDC_VAULT, ethers.MaxUint256, { gasPrice });
      const approveResult = await waitForTransaction(approveTx, 'GauntletUSDC approval');
      
      if (!approveResult.success) {
        return { 
          success: false, 
          error: approveResult.error!,
          errorCode: 'APPROVAL_FAILED'
        };
      }
      
      totalGasUsed += approveResult.receipt!.gasUsed;
    }
    
    // Deposit to GauntletUSDC vault
    const depositGauntletTx = await gauntletVault.deposit(gauntletAmountWei, walletAddress, { gasPrice });
    const gauntletTxHash = depositGauntletTx.hash;
    console.log(`[MORPHO] GauntletUSDC deposit transaction: ${gauntletTxHash}`);
    
    const gauntletResult = await waitForTransaction(depositGauntletTx, 'GauntletUSDC deposit');
    
    if (!gauntletResult.success) {
      return { 
        success: false, 
        error: gauntletResult.error!,
        gauntletTxHash,
        errorCode: 'GAUNTLET_DEPOSIT_FAILED'
      };
    }
    
    totalGasUsed += gauntletResult.receipt!.gasUsed;
    console.log(`[MORPHO] ✅ GauntletUSDC deposit confirmed`);
    
    // Get shares received
    const gauntletShares = await gauntletVault.balanceOf(walletAddress);
    
    // === Step 2: Deposit to HyperithmUSDC Vault ===
    console.log(`[MORPHO] Step 2: Depositing $${hyperithmAmount} to HyperithmUSDC vault...`);
    
    // Check and approve if needed
    const hyperithmAllowance = await usdcContract.allowance(hubWallet.address, MORPHO_HYPERITHM_USDC_VAULT);
    if (hyperithmAllowance < hyperithmAmountWei) {
      console.log('[MORPHO] Approving USDC for HyperithmUSDC vault...');
      const approveTx = await usdcContract.approve(MORPHO_HYPERITHM_USDC_VAULT, ethers.MaxUint256, { gasPrice });
      const approveResult = await waitForTransaction(approveTx, 'HyperithmUSDC approval');
      
      if (!approveResult.success) {
        return { 
          success: false, 
          error: approveResult.error!,
          gauntletTxHash,
          errorCode: 'APPROVAL_FAILED'
        };
      }
      
      totalGasUsed += approveResult.receipt!.gasUsed;
    }
    
    // Deposit to HyperithmUSDC vault
    const depositHyperithmTx = await hyperithmVault.deposit(hyperithmAmountWei, walletAddress, { gasPrice });
    const hyperithmTxHash = depositHyperithmTx.hash;
    console.log(`[MORPHO] HyperithmUSDC deposit transaction: ${hyperithmTxHash}`);
    
    const hyperithmResult = await waitForTransaction(depositHyperithmTx, 'HyperithmUSDC deposit');
    
    if (!hyperithmResult.success) {
      return { 
        success: false, 
        error: hyperithmResult.error!,
        gauntletTxHash,
        hyperithmTxHash,
        errorCode: 'HYPERITHM_DEPOSIT_FAILED'
      };
    }
    
    totalGasUsed += hyperithmResult.receipt!.gasUsed;
    console.log(`[MORPHO] ✅ HyperithmUSDC deposit confirmed`);
    
    // Get shares received
    const hyperithmShares = await hyperithmVault.balanceOf(walletAddress);
    
    // Update position with success
    if (positionId) {
      await updatePosition(positionId, {
        status: 'active',
        executedAt: new Date().toISOString(),
        aaveSupplyAmount: gauntletAmount + hyperithmAmount,
        aaveSupplyTxHash: hyperithmTxHash, // Store last tx hash
      });
    }
    
    const result: MorphoDepositResult = {
      success: true,
      gauntletTxHash,
      hyperithmTxHash,
      gauntletShares: gauntletShares.toString(),
      hyperithmShares: hyperithmShares.toString(),
      totalGasUsed: totalGasUsed.toString(),
    };
    
    console.log('[MORPHO] ✅ Execution completed successfully', result);
    
    return result;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[MORPHO] Execution error:', {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      walletAddress,
      paymentId,
    });
    
    // Update position with error
    if (positionId) {
      await updatePosition(positionId, {
        status: 'failed',
        error: errorMessage,
      });
    }
    
    return { 
      success: false, 
      error: errorMessage,
      errorCode: 'EXECUTION_ERROR'
    };
  }
}

/**
 * Health check for Morpho webhook configuration
 */
export async function checkMorphoHealth(): Promise<{ healthy: boolean; error?: string; details?: any }> {
  try {
    // Validate configuration
    const keyValidation = validatePrivateKey(ARBITRUM_HUB_WALLET_PRIVATE_KEY);
    if (!keyValidation.valid) {
      return { healthy: false, error: keyValidation.error };
    }
    
    // Check RPC connection
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    const network = await provider.getNetwork();
    
    if (network.chainId !== 42161n) {
      return { healthy: false, error: `Wrong network: ${network.chainId}` };
    }
    
    // Verify contracts
    const contractChecks = await Promise.all([
      verifyContractExists(provider, USDC_ARBITRUM, 'USDC'),
      verifyContractExists(provider, MORPHO_GAUNTLET_USDC_VAULT, 'GauntletUSDC'),
      verifyContractExists(provider, MORPHO_HYPERITHM_USDC_VAULT, 'HyperithmUSDC'),
    ]);
    
    const failedCheck = contractChecks.find(check => !check.valid);
    if (failedCheck) {
      return { healthy: false, error: failedCheck.error };
    }
    
    // Check hub wallet balance
    const hubWallet = new ethers.Wallet(keyValidation.cleanKey!, provider);
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, ERC20_ABI, hubWallet);
    const balance = await usdcContract.balanceOf(hubWallet.address);
    const balanceUsd = Number(balance) / 1_000_000;
    
    return {
      healthy: true,
      details: {
        network: 'Arbitrum',
        chainId: Number(network.chainId),
        hubWallet: hubWallet.address,
        hubBalance: `$${balanceUsd.toFixed(2)}`,
        contracts: {
          usdc: USDC_ARBITRUM,
          gauntletVault: MORPHO_GAUNTLET_USDC_VAULT,
          hyperithmVault: MORPHO_HYPERITHM_USDC_VAULT,
        }
      }
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
