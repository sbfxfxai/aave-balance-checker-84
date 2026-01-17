/**
 * Environment validation utility
 * Ensures all required environment variables are present before app starts
 */

export interface EnvVarConfig {
  name: string;
  description: string;
  getUrl?: string;
  required: boolean;
}

const ENVIRONMENT_VARIABLES: EnvVarConfig[] = [
  {
    name: 'VITE_WALLETCONNECT_PROJECT_ID',
    description: 'WalletConnect Project ID for wallet connections',
    getUrl: 'https://cloud.walletconnect.com',
    required: true,
  },
  {
    name: 'VITE_AVALANCHE_RPC_URL',
    description: 'Avalanche RPC endpoint for blockchain data',
    getUrl: 'https://dashboard.alchemy.com',
    required: true,
  },
  {
    name: 'VITE_ARBITRUM_RPC_URL',
    description: 'Arbitrum RPC endpoint for Morpho vault data',
    getUrl: 'https://dashboard.alchemy.com',
    required: true,
  },
  {
    name: 'VITE_COINGECKO_API_KEY',
    description: 'CoinGecko API key for price data (optional - has fallback)',
    required: false,
  },
]

export function validateEnvironment(): void {
  console.log('[Env] 🔍 Validating environment variables...')
  
  const missing: EnvVarConfig[] = []
  const present: string[] = []
  
  for (const config of ENVIRONMENT_VARIABLES) {
    const value = import.meta.env[config.name]
    
    if (config.required && (!value || value.trim() === '')) {
      missing.push(config)
    } else if (value) {
      present.push(config.name)
    }
  }
  
  // Log present variables (without values for security)
  if (present.length > 0) {
    console.log(`[Env] ✅ Found ${present.length} required variables:`, present)
  }
  
  // If any required variables are missing, throw a detailed error
  if (missing.length > 0) {
    const errorMessage = [
      '\n🚨 CRITICAL: Missing required environment variables',
      '=' .repeat(60),
      '',
      ...missing.map(config => [
        `❌ ${config.name}`,
        `   Description: ${config.description}`,
        config.getUrl ? `   Get it at: ${config.getUrl}` : '',
        '',
      ]).flat(),
      'How to fix:',
      '1. Add missing variables to your .env.local file for development',
      '2. Add them to Vercel Environment Variables for production',
      '3. Restart the application',
      '',
      'Example .env.local:',
      ...missing.map(config => `${config.name}="your_value_here"`),
      '=' .repeat(60),
    ].join('\n')
    
    console.error(errorMessage)
    
    // Also show a user-friendly error in the UI
    if (typeof window !== 'undefined') {
      const loadingText = document.querySelector('.tv-initial-loading') as HTMLElement
      if (loadingText) {
        loadingText.textContent = 'Configuration Error: Missing environment variables. Check console for details.'
        loadingText.style.color = '#ef4444'
      }
    }
    
    throw new Error(`Missing required environment variables: ${missing.map(v => v.name).join(', ')}`)
  }
  
  console.log('[Env] ✅ All required environment variables are present')
  
  // Validate specific variable formats
  const walletConnectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID
  if (walletConnectId && walletConnectId === 'default-project-id') {
    throw new Error(
      'VITE_WALLETCONNECT_PROJECT_ID cannot be "default-project-id". ' +
      'Get a real project ID from https://cloud.walletconnect.com'
    )
  }
  
  // Validate RPC URLs don't use public endpoints
  const avalancheRpc = import.meta.env.VITE_AVALANCHE_RPC_URL
  const arbitrumRpc = import.meta.env.VITE_ARBITRUM_RPC_URL
  
  if (avalancheRpc?.includes('api.avax.network')) {
    console.warn('[Env] ⚠️ Warning: Using public Avalanche RPC. This has rate limits and may fail under load.')
  }
  
  if (arbitrumRpc?.includes('arb1.arbitrum.io')) {
    console.warn('[Env] ⚠️ Warning: Using public Arbitrum RPC. This has rate limits and may fail under load.')
  }
  
  console.log('[Env] ✅ Environment validation complete')
}

/**
 * Get environment variable status for debugging
 */
export function getEnvironmentStatus(): { present: string[]; missing: string[] } {
  const present = ENVIRONMENT_VARIABLES
    .filter(config => import.meta.env[config.name])
    .map(config => config.name)
  
  const missing = ENVIRONMENT_VARIABLES
    .filter(config => config.required && !import.meta.env[config.name])
    .map(config => config.name)
  
  return { present, missing }
}
