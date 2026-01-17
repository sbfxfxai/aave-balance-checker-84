import { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { getAddress } from 'ethers';
import { getRedis } from '../utils/redis';
import { Ratelimit } from '@upstash/ratelimit';

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
];

// ERC20 ABI for approval checks
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

// Arbitrum RPC
const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';

interface MorphoWithdrawRequest {
  walletAddress: string;  
  withdrawAll?: boolean;
  usdcAmount?: string;
}

interface MorphoWithdrawResponse {
  success: boolean;
  message: string;
  results?: Array<{
    vault: string;
    shares?: string;
    assets?: string;
    success: boolean;
    error?: string;
    note?: string;
  }>;
  note?: string;
}

function isValidEthereumAddress(address: string): boolean {
  try {
    getAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check inflation attack protection - dead address should have substantial shares
 */
async function checkInflationProtection(vaultContract: ethers.Contract): Promise<boolean> {
  try {
    const deadAddress = '0x000000000000000000000000000000000000dEaD';
    const deadShares = await vaultContract.balanceOf(deadAddress);
    const decimals = await vaultContract.decimals();
    
    // Requirement: at least 1e9 shares for assets with >9 decimals, 1e12 otherwise
    const minShares = decimals > 9 ? 1_000_000_000n : 1_000_000_000_000n;
    
    console.log(`[InflationProtection] Dead shares: ${ethers.formatUnits(deadShares, decimals)}, Min required: ${ethers.formatUnits(minShares, decimals)}`);
    
    return deadShares >= minShares;
  } catch (error) {
    console.error('[InflationProtection] Check failed:', error);
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize Redis for rate limiting
    const redis = await getRedis();
    const ratelimit = new Ratelimit({
      redis: redis as any, // Type cast to satisfy @upstash/ratelimit interface
      limiter: Ratelimit.slidingWindow(5, '60 s'), // 5 withdrawals per minute
    });
    const { walletAddress, withdrawAll = true, usdcAmount } = req.body as MorphoWithdrawRequest;

    // Validate inputs
    if (!walletAddress || !isValidEthereumAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    if (!withdrawAll && !usdcAmount) {
      return res.status(400).json({ error: 'Must specify USDC amount when not withdrawing all' });
    }

    // Rate limiting
    const identifier = `morpho-withdraw:${walletAddress}`;
    const { success: rateLimitSuccess } = await ratelimit.limit(identifier);
    
    if (!rateLimitSuccess) {
      return res.status(429).json({ 
        error: 'Too many withdrawal requests. Please wait a moment.' 
      });
    }

    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    const normalizedAddress = getAddress(walletAddress);

    console.log('[MorphoWithdraw] Processing withdrawal request:', {
      walletAddress: normalizedAddress,
      withdrawAll,
      usdcAmount,
    });

    // Initialize vault contracts (read-only for checks)
    const gauntletVault = new ethers.Contract(
      MORPHO_GAUNTLET_USDC_VAULT,
      ERC4626_VAULT_ABI,
      provider
    );

    const hyperithmVault = new ethers.Contract(
      MORPHO_HYPERITHM_USDC_VAULT,
      ERC4626_VAULT_ABI,
      provider
    );

    // Check inflation protection on both vaults
    const gauntletProtected = await checkInflationProtection(gauntletVault);
    const hyperithmProtected = await checkInflationProtection(hyperithmVault);

    if (!gauntletProtected || !hyperithmProtected) {
      console.error('[MorphoWithdraw] Vault inflation protection failed', {
        gauntletProtected,
        hyperithmProtected,
      });
      return res.status(500).json({
        error: 'Vault security check failed. Please contact support.',
        details: 'Inflation attack protection verification failed',
      });
    }

    const results = [];

    // Process Gauntlet Vault withdrawal (read-only check)
    try {
      const gauntletShares = await gauntletVault.balanceOf(normalizedAddress);
      console.log('[MorphoWithdraw] Gauntlet shares for', normalizedAddress, ':', ethers.formatUnits(gauntletShares, 18));
      
      if (gauntletShares > 0n) {
        const gauntletAssets = await gauntletVault.convertToAssets(gauntletShares);
        console.log('[MorphoWithdraw] Gauntlet assets to withdraw:', ethers.formatUnits(gauntletAssets, 6));
        
        results.push({
          vault: 'Gauntlet USDC',
          shares: ethers.formatUnits(gauntletShares, 18),
          assets: ethers.formatUnits(gauntletAssets, 6),
          success: true,
          note: 'User must sign transaction to withdraw',
        });
      } else {
        console.log('[MorphoWithdraw] No Gauntlet shares to withdraw');
        results.push({
          vault: 'Gauntlet USDC',
          shares: '0',
          assets: '0',
          success: true,
          note: 'No shares to withdraw',
        });
      }
    } catch (error) {
      console.error('[MorphoWithdraw] Gauntlet withdrawal error:', error);
      results.push({
        vault: 'Gauntlet USDC',
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      });
    }

    // Process Hyperithm Vault withdrawal (read-only check)
    try {
      const hyperithmShares = await hyperithmVault.balanceOf(normalizedAddress);
      console.log('[MorphoWithdraw] Hyperithm shares for', normalizedAddress, ':', ethers.formatUnits(hyperithmShares, 18));
      
      if (hyperithmShares > 0n) {
        const hyperithmAssets = await hyperithmVault.convertToAssets(hyperithmShares);
        console.log('[MorphoWithdraw] Hyperithm assets to withdraw:', ethers.formatUnits(hyperithmAssets, 6));
        
        results.push({
          vault: 'Hyperithm USDC',
          shares: ethers.formatUnits(hyperithmShares, 18),
          assets: ethers.formatUnits(hyperithmAssets, 6),
          success: true,
          note: 'User must sign transaction to withdraw',
        });
      } else {
        console.log('[MorphoWithdraw] No Hyperithm shares to withdraw');
        results.push({
          vault: 'Hyperithm USDC',
          shares: '0',
          assets: '0',
          success: true,
          note: 'No shares to withdraw',
        });
      }
    } catch (error) {
      console.error('[MorphoWithdraw] Hyperithm withdrawal error:', error);
      results.push({
        vault: 'Hyperithm USDC',
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      });
    }

    // Store withdrawal record
    const withdrawalId = `morpho_withdraw_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    await redis.set(withdrawalId, JSON.stringify({
      walletAddress: normalizedAddress,
      results,
      timestamp: Date.now(),
      withdrawAll,
      type: 'estimate', // Mark as estimate since user signs transactions
    }), { ex: 7 * 24 * 60 * 60 }); // 7 days

    const successfulWithdrawals = results.filter(r => r.success && parseFloat(r.assets || '0') > 0);
    const failedWithdrawals = results.filter(r => !r.success);

    console.log('[MorphoWithdraw] Withdrawal results:', {
      successfulWithdrawals,
      failedWithdrawals,
      totalResults: results.length,
      hasAnyShares: results.some(r => r.success && (parseFloat(r.shares || '0') > 0 || r.note)),
    });

    // If no shares were found, return success but indicate nothing to withdraw
    const hasSharesToWithdraw = results.some(r => 
      r.success && (parseFloat(r.shares || '0') > 0 || r.note)
    );

    if (!hasSharesToWithdraw) {
      return res.status(200).json({
        success: true,
        message: 'No shares found to withdraw',
        results,
        note: 'User has no shares in Morpho vaults',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Found ${successfulWithdrawals.length} vault(s) with withdrawable shares. User must sign transactions to complete withdrawal.`,
      results,
      withdrawalId,
      note: 'User must sign transactions with their wallet to withdraw funds',
    });

  } catch (error) {
    console.error('[MorphoWithdraw] Unexpected error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
