import { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { getAddress } from 'ethers';

// Morpho Vault addresses on Arbitrum
const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65' as const;
const MORPHO_HYPERITHM_USDC_VAULT = '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027' as const;

// ERC-4626 Vault ABI
const ERC4626_VAULT_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function asset() view returns (address)',
  'function name() view returns (string)',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    const provider = new ethers.JsonRpcProvider('https://arb1.arbitrum.io/rpc');
    const normalizedAddress = getAddress(walletAddress);

    console.log('[MorphoDebug] Checking shares for:', normalizedAddress);

    // Check Gauntlet Vault
    const gauntletVault = new ethers.Contract(
      MORPHO_GAUNTLET_USDC_VAULT,
      ERC4626_VAULT_ABI,
      provider
    );

    // Check Hyperithm Vault
    const hyperithmVault = new ethers.Contract(
      MORPHO_HYPERITHM_USDC_VAULT,
      ERC4626_VAULT_ABI,
      provider
    );

    const results: any = {};

    try {
      const gauntletShares = await gauntletVault.balanceOf(normalizedAddress);
      const gauntletTotalAssets = await gauntletVault.totalAssets();
      const gauntletDecimals = await gauntletVault.decimals();
      const gauntletAsset = await gauntletVault.asset();
      const gauntletName = await gauntletVault.name();

      results.gauntlet = {
        address: MORPHO_GAUNTLET_USDC_VAULT,
        name: gauntletName,
        userShares: ethers.formatUnits(gauntletShares, gauntletDecimals),
        userSharesRaw: gauntletShares.toString(),
        totalAssets: ethers.formatUnits(gauntletTotalAssets, gauntletDecimals),
        asset: gauntletAsset,
        decimals: gauntletDecimals.toString(),
        hasShares: gauntletShares > 0n,
      };
    } catch (error) {
      results.gauntlet = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    try {
      const hyperithmShares = await hyperithmVault.balanceOf(normalizedAddress);
      const hyperithmTotalAssets = await hyperithmVault.totalAssets();
      const hyperithmDecimals = await hyperithmVault.decimals();
      const hyperithmAsset = await hyperithmVault.asset();
      const hyperithmName = await hyperithmVault.name();

      results.hyperithm = {
        address: MORPHO_HYPERITHM_USDC_VAULT,
        name: hyperithmName,
        userShares: ethers.formatUnits(hyperithmShares, hyperithmDecimals),
        userSharesRaw: hyperithmShares.toString(),
        totalAssets: ethers.formatUnits(hyperithmTotalAssets, hyperithmDecimals),
        asset: hyperithmAsset,
        decimals: hyperithmDecimals.toString(),
        hasShares: hyperithmShares > 0n,
      };
    } catch (error) {
      results.hyperithm = {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    console.log('[MorphoDebug] Results:', results);

    return res.status(200).json({
      walletAddress: normalizedAddress,
      results,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('[MorphoDebug] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
