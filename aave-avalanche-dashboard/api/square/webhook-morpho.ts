/**
 * Clean Morpho Webhook - Standalone Implementation
 * 
 * This is a clean, focused implementation for Morpho vault deposits on Arbitrum.
 * Separated from the main webhook to keep it simple and maintainable.
 */

import { ethers } from 'ethers';

// Configuration
const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';
const ARBITRUM_HUB_WALLET_PRIVATE_KEY = process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY || process.env.HUB_WALLET_PRIVATE_KEY || '';
const ARBITRUM_HUB_WALLET_ADDRESS = process.env.ARBITRUM_HUB_WALLET_ADDRESS || process.env.HUB_WALLET_ADDRESS || '0x34c11928868d14bdD7Be55A0D9f9e02257240c24';

// Morpho Vault addresses on Arbitrum (verified)
const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65'; // Morpho GauntletUSDC Core Vault
const MORPHO_HYPERITHM_USDC_VAULT = '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027'; // Morpho HyperithmUSDC Vault

// Token addresses on Arbitrum
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // Native USDC on Arbitrum (6 decimals)

// Minimums
const AAVE_MIN_SUPPLY_USD = 1; // Minimum $1 per vault
const MAX_GAS_PRICE_GWEI = 100;

// ABIs
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const ERC4626_VAULT_ABI = [
  'function deposit(uint256 assets, address onBehalf) external returns (uint256 shares)',
  'function asset() external view returns (address)',
  'function balanceOf(address account) view returns (uint256)',
  'function previewDeposit(uint256 assets) public view returns (uint256)',
];

/**
 * Execute Morpho strategy from hub wallet on Arbitrum
 * 
 * Deposits USDC to Morpho vaults on Arbitrum:
 * - 50% to GauntletUSDC Core Vault
 * - 50% to HyperithmUSDC Vault
 * 
 * Vault shares are credited to the user's wallet address.
 */
export async function executeMorphoFromHubWallet(
  walletAddress: string,
  gauntletAmount: number,
  hyperithmAmount: number,
  paymentId: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  console.log(`[MORPHO] Executing Morpho strategy for ${walletAddress}...`);
  console.log(`[MORPHO] GauntletUSDC: $${gauntletAmount}, HyperithmUSDC: $${hyperithmAmount}`);

  // Validate configuration
  if (!ARBITRUM_HUB_WALLET_PRIVATE_KEY || ARBITRUM_HUB_WALLET_PRIVATE_KEY === '') {
    return { success: false, error: 'ARBITRUM_HUB_WALLET_PRIVATE_KEY not configured' };
  }

  const cleanKey = ARBITRUM_HUB_WALLET_PRIVATE_KEY.startsWith('0x') 
    ? ARBITRUM_HUB_WALLET_PRIVATE_KEY 
    : `0x${ARBITRUM_HUB_WALLET_PRIVATE_KEY}`;

  if (cleanKey.length !== 66) {
    return { success: false, error: 'ARBITRUM_HUB_WALLET_PRIVATE_KEY must be a 32-byte hex string' };
  }

  // Check minimums
  if (gauntletAmount < AAVE_MIN_SUPPLY_USD || hyperithmAmount < AAVE_MIN_SUPPLY_USD) {
    return { success: false, error: `Minimum deposit is $${AAVE_MIN_SUPPLY_USD} per vault` };
  }

  try {
    // Connect to Arbitrum
    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    const network = await provider.getNetwork();
    
    if (network.chainId !== 42161n) {
      return { success: false, error: `Wrong network: Expected Arbitrum (42161), got ${network.chainId}` };
    }

    const hubWallet = new ethers.Wallet(cleanKey, provider);
    
    if (hubWallet.address.toLowerCase() !== ARBITRUM_HUB_WALLET_ADDRESS.toLowerCase()) {
      return { success: false, error: 'Private key does not match hub wallet address' };
    }

    // Verify contracts exist
    const usdcCode = await provider.getCode(USDC_ARBITRUM);
    const gauntletCode = await provider.getCode(MORPHO_GAUNTLET_USDC_VAULT);
    const hyperithmCode = await provider.getCode(MORPHO_HYPERITHM_USDC_VAULT);
    
    if (!usdcCode || usdcCode === '0x' || usdcCode.length < 4) {
      return { success: false, error: `USDC contract not found at ${USDC_ARBITRUM}` };
    }
    if (!gauntletCode || gauntletCode === '0x' || gauntletCode.length < 4) {
      return { success: false, error: `GauntletUSDC vault not found at ${MORPHO_GAUNTLET_USDC_VAULT}` };
    }
    if (!hyperithmCode || hyperithmCode === '0x' || hyperithmCode.length < 4) {
      return { success: false, error: `HyperithmUSDC vault not found at ${MORPHO_HYPERITHM_USDC_VAULT}` };
    }

    // Create contract instances
    const usdcContract = new ethers.Contract(USDC_ARBITRUM, ERC20_ABI, hubWallet);
    const gauntletVault = new ethers.Contract(MORPHO_GAUNTLET_USDC_VAULT, ERC4626_VAULT_ABI, hubWallet);
    const hyperithmVault = new ethers.Contract(MORPHO_HYPERITHM_USDC_VAULT, ERC4626_VAULT_ABI, hubWallet);

    // Convert amounts to wei (USDC has 6 decimals)
    const gauntletAmountWei = BigInt(Math.floor(Number(gauntletAmount) * 1_000_000));
    const hyperithmAmountWei = BigInt(Math.floor(Number(hyperithmAmount) * 1_000_000));
    const totalAmountWei = gauntletAmountWei + hyperithmAmountWei;

    // Check hub wallet balance
    const hubBalance = await usdcContract.balanceOf(hubWallet.address);
    const hubBalanceFormatted = Number(hubBalance) / 1_000_000;
    
    if (hubBalance < totalAmountWei) {
      return { 
        success: false, 
        error: `Insufficient USDC balance. Have: $${hubBalanceFormatted}, Need: $${gauntletAmount + hyperithmAmount}` 
      };
    }

    // Get gas price
    let networkGasPrice: bigint;
    try {
      const feeData = await provider.getFeeData();
      const rawGasPrice = feeData.gasPrice || feeData.maxFeePerGas;
      networkGasPrice = rawGasPrice ? BigInt(rawGasPrice.toString()) : ethers.parseUnits('70', 'gwei');
      
      const block = await provider.getBlock('latest');
      if (block?.baseFeePerGas) {
        const baseFee = BigInt(block.baseFeePerGas.toString());
        const minGasPrice = (baseFee * 120n) / 100n;
        if (networkGasPrice < minGasPrice) {
          networkGasPrice = minGasPrice;
        }
      }
    } catch (error) {
      console.warn('[MORPHO] Failed to fetch gas price, using default 70 gwei');
      networkGasPrice = ethers.parseUnits('70', 'gwei');
    }
    
    const maxGasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    const gasPrice = networkGasPrice > maxGasPrice ? maxGasPrice : networkGasPrice;

    // Step 1: Deposit to GauntletUSDC vault
    console.log(`[MORPHO] Depositing $${gauntletAmount} to GauntletUSDC vault...`);
    
    // Check and approve USDC
    const gauntletAllowance = await usdcContract.allowance(hubWallet.address, MORPHO_GAUNTLET_USDC_VAULT);
    if (gauntletAllowance < gauntletAmountWei) {
      const approveTx = await usdcContract.approve(MORPHO_GAUNTLET_USDC_VAULT, ethers.MaxUint256, { gasPrice });
      await approveTx.wait();
    }

    // Deposit
    const depositGauntletTx = await gauntletVault.deposit(gauntletAmountWei, walletAddress, { gasPrice });
    const depositGauntletReceipt = await depositGauntletTx.wait();
    
    if (depositGauntletReceipt?.status !== 1) {
      throw new Error(`GauntletUSDC vault deposit failed. Status: ${depositGauntletReceipt?.status}`);
    }
    
    console.log(`[MORPHO] ✅ GauntletUSDC deposit confirmed: ${depositGauntletTx.hash}`);

    // Step 2: Deposit to HyperithmUSDC vault
    console.log(`[MORPHO] Depositing $${hyperithmAmount} to HyperithmUSDC vault...`);
    
    // Check and approve USDC
    const hyperithmAllowance = await usdcContract.allowance(hubWallet.address, MORPHO_HYPERITHM_USDC_VAULT);
    if (hyperithmAllowance < hyperithmAmountWei) {
      const approveTx = await usdcContract.approve(MORPHO_HYPERITHM_USDC_VAULT, ethers.MaxUint256, { gasPrice });
      await approveTx.wait();
    }

    // Deposit
    const depositHyperithmTx = await hyperithmVault.deposit(hyperithmAmountWei, walletAddress, { gasPrice });
    const depositHyperithmReceipt = await depositHyperithmTx.wait();
    
    if (depositHyperithmReceipt?.status !== 1) {
      throw new Error(`HyperithmUSDC vault deposit failed. Status: ${depositHyperithmReceipt?.status}`);
    }
    
    console.log(`[MORPHO] ✅ HyperithmUSDC deposit confirmed: ${depositHyperithmTx.hash}`);

    return {
      success: true,
      txHash: depositHyperithmTx.hash, // Return last transaction hash
    };

  } catch (error) {
    console.error('[MORPHO] Execution error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

