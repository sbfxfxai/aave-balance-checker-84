import { ethers } from 'ethers';
import { arbitrum } from 'wagmi/chains';

// Morpho Vault addresses on Arbitrum
const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65' as const;
const MORPHO_HYPERITHM_USDC_VAULT = '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027' as const;

// ERC-4626 Vault ABI
const ERC4626_VAULT_ABI = [
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
  'function balanceOf(address account) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function asset() view returns (address)',
] as const;

// USDC ABI for approvals
const USDC_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
] as const;

export interface VaultPosition {
  vault: string;
  vaultAddress: string;
  shares: string;
  assets: string;
  success: boolean;
}

export interface WithdrawalResult {
  success: boolean;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  vaultResults?: VaultPosition[];
}

/**
 * Check inflation attack protection for a vault
 */
export async function checkInflationProtection(
  provider: ethers.JsonRpcProvider,
  vaultAddress: string
): Promise<boolean> {
  try {
    const vault = new ethers.Contract(vaultAddress, ERC4626_VAULT_ABI, provider);
    const deadAddress = '0x000000000000000000000000000000000000dEaD';
    const deadShares = await vault.balanceOf(deadAddress);
    const decimals = await vault.decimals();
    
    // Requirement: at least 1e9 shares for assets with >9 decimals, 1e12 otherwise
    const minShares = decimals > 9 ? 1_000_000_000n : 1_000_000_000_000n;
    
    console.log(`[InflationProtection] Dead shares: ${ethers.formatUnits(deadShares, decimals)}, Min required: ${ethers.formatUnits(minShares, decimals)}`);
    
    return deadShares >= minShares;
  } catch (error) {
    console.error('[InflationProtection] Check failed:', error);
    return false;
  }
}

/**
 * Get user's vault positions (read-only)
 */
export async function getVaultPositions(
  provider: ethers.JsonRpcProvider,
  userAddress: string
): Promise<VaultPosition[]> {
  const positions: VaultPosition[] = [];
  const normalizedAddress = ethers.getAddress(userAddress);

  // Check both vaults
  const vaults = [
    { name: 'Gauntlet USDC', address: MORPHO_GAUNTLET_USDC_VAULT },
    { name: 'Hyperithm USDC', address: MORPHO_HYPERITHM_USDC_VAULT },
  ];

  for (const vault of vaults) {
    try {
      const vaultContract = new ethers.Contract(vault.address, ERC4626_VAULT_ABI, provider);
      const shares = await vaultContract.balanceOf(normalizedAddress);
      
      if (shares > 0n) {
        const assets = await vaultContract.convertToAssets(shares);
        positions.push({
          vault: vault.name,
          vaultAddress: vault.address,
          shares: ethers.formatUnits(shares, 18),
          assets: ethers.formatUnits(assets, 6),
          success: true,
        });
      }
    } catch (error) {
      console.error(`[getVaultPositions] Error for ${vault.name}:`, error);
      positions.push({
        vault: vault.name,
        vaultAddress: vault.address,
        shares: '0',
        assets: '0',
        success: false,
      });
    }
  }

  return positions;
}

/**
 * Withdraw from a specific vault using user's wallet
 */
export async function withdrawFromVault(
  signer: ethers.JsonRpcSigner,
  vaultAddress: string,
  shares?: string,
  assets?: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const vault = new ethers.Contract(vaultAddress, ERC4626_VAULT_ABI, signer);
    const userAddress = await signer.getAddress();

    // Prefer redeem() for full withdrawals (shares-based)
    if (shares && parseFloat(shares) > 0) {
      const sharesBigInt = ethers.parseUnits(shares, 18);
      console.log(`[withdrawFromVault] Redeeming ${shares} shares from ${vaultAddress}`);
      
      const tx = await vault.redeem(
        sharesBigInt,
        userAddress, // receiver
        userAddress, // owner
        {
          gasLimit: 500000,
        }
      );

      const receipt = await tx.wait(1);
      
      if (receipt.status === 1) {
        return { success: true, txHash: tx.hash };
      } else {
        return { success: false, error: 'Transaction failed' };
      }
    }
    // Fallback to withdraw() for asset-based withdrawals
    else if (assets && parseFloat(assets) > 0) {
      const assetsBigInt = ethers.parseUnits(assets, 6);
      console.log(`[withdrawFromVault] Withdrawing ${assets} assets from ${vaultAddress}`);
      
      const tx = await vault.withdraw(
        assetsBigInt,
        userAddress, // receiver
        userAddress, // owner
        {
          gasLimit: 500000,
        }
      );

      const receipt = await tx.wait(1);
      
      if (receipt.status === 1) {
        return { success: true, txHash: tx.hash };
      } else {
        return { success: false, error: 'Transaction failed' };
      }
    }

    return { success: false, error: 'No valid amount specified' };
  } catch (error) {
    console.error('[withdrawFromVault] Error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Complete withdrawal process for all vaults
 */
export async function withdrawAllFromMorpho(
  signer: ethers.JsonRpcSigner
): Promise<WithdrawalResult> {
  try {
    const provider = signer.provider as ethers.JsonRpcProvider;
    const userAddress = await signer.getAddress();

    console.log('[withdrawAllFromMorpho] Starting withdrawal for:', userAddress);

    // Check inflation protection first
    const gauntletProtected = await checkInflationProtection(provider, MORPHO_GAUNTLET_USDC_VAULT);
    const hyperithmProtected = await checkInflationProtection(provider, MORPHO_HYPERITHM_USDC_VAULT);

    if (!gauntletProtected || !hyperithmProtected) {
      return {
        success: false,
        error: 'Vault security check failed. Inflation attack protection verification failed.',
      };
    }

    // Get current positions
    const positions = await getVaultPositions(provider, userAddress);
    const vaultResults: VaultPosition[] = [];
    const txHashes: string[] = [];

    // Process each vault with shares
    for (const position of positions) {
      if (position.success && parseFloat(position.shares) > 0) {
        console.log(`[withdrawAllFromMorpho] Processing ${position.vault}: ${position.shares} shares`);
        
        const result = await withdrawFromVault(signer, position.vaultAddress, position.shares);
        
        vaultResults.push({
          ...position,
          success: result.success,
        });

        if (result.success && result.txHash) {
          txHashes.push(result.txHash);
        }
      } else {
        vaultResults.push(position);
      }
    }

    const successfulVaults = vaultResults.filter(r => r.success);
    const hasAnySuccess = successfulVaults.length > 0;

    return {
      success: hasAnySuccess,
      txHash: txHashes[0], // Return first transaction hash
      explorerUrl: txHashes[0] ? `https://arbiscan.io/tx/${txHashes[0]}` : undefined,
      vaultResults,
      error: hasAnySuccess ? undefined : 'No successful withdrawals',
    };

  } catch (error) {
    console.error('[withdrawAllFromMorpho] Unexpected error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    };
  }
}
