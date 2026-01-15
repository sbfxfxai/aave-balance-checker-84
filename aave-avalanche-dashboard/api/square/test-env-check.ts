/**
 * Check environment variables for Morpho strategy
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log('[Env-Check] ===== CHECKING ENVIRONMENT VARIABLES =====');
    
    const envVars = {
      ENABLE_MORPHO_STRATEGY: process.env.ENABLE_MORPHO_STRATEGY,
      ARBITRUM_HUB_WALLET_PRIVATE_KEY: process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY ? 'SET' : 'NOT SET',
      ARBITRUM_RPC_URL: process.env.ARBITRUM_RPC_URL,
      NODE_ENV: process.env.NODE_ENV
    };
    
    console.log('[Env-Check] Environment Variables:', envVars);
    
    const isMorphoEnabled = process.env.ENABLE_MORPHO_STRATEGY === 'true';
    
    console.log('[Env-Check] Morpho Strategy Enabled:', isMorphoEnabled);
    
    return res.status(200).json({
      success: true,
      envVars,
      isMorphoEnabled,
      issue: !isMorphoEnabled ? 'Morpho strategy is not enabled - aggressive payments will fall through to Aave' : null,
      recommendation: !isMorphoEnabled ? 'Set ENABLE_MORPHO_STRATEGY=true to enable Morpho vault routing' : 'Morpho strategy is properly enabled'
    });
    
  } catch (error) {
    console.error('[Env-Check] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export default handler;
