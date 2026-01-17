import { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { getAddress } from 'ethers';

// Morpho Vault addresses on Arbitrum
const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65' as const;
const MORPHO_HYPERITHM_USDC_VAULT = '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027' as const;

// ERC-4626 Vault ABI
const ERC4626_VAULT_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
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

    console.log('[MorphoTest] Checking shares for:', normalizedAddress);

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

    const results: any = {
      walletAddress: normalizedAddress,
      timestamp: new Date().toISOString(),
    };

    try {
      const gauntletShares = await gauntletVault.balanceOf(normalizedAddress);
      results.gauntletShares = ethers.formatUnits(gauntletShares, 18);
      results.gauntletSharesRaw = gauntletShares.toString();
      results.hasGauntletShares = gauntletShares > 0n;
    } catch (error) {
      results.gauntletError = error instanceof Error ? error.message : 'Unknown error';
    }

    try {
      const hyperithmShares = await hyperithmVault.balanceOf(normalizedAddress);
      results.hyperithmShares = ethers.formatUnits(hyperithmShares, 18);
      results.hyperithmSharesRaw = hyperithmShares.toString();
      results.hasHyperithmShares = hyperithmShares > 0n;
    } catch (error) {
      results.hyperithmError = error instanceof Error ? error.message : 'Unknown error';
    }

    console.log('[MorphoTest] Results:', results);

    return res.status(200).json(results);

  } catch (error) {
    console.error('[MorphoTest] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}
