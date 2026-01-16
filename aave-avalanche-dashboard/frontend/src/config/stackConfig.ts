export const STACK_CONFIG = {
  // Risk profile configurations
  aggressive: {
    leverage: '2.5x',
    redirectPath: '/gmx',
  },
  
  // UI text constants
  ui: {
    conservative: {
      description: '100% Savings',
      allocation: '100% USDC',
    },
    morpho: {
      description: '50/50 Gauntlet + Hyperithm',
      allocation: '50% Gauntlet USDC Core / 50% Hyperithm USDC',
    },
    aggressive: {
      description: '100% Bitcoin 2.5x',
      allocation: '100% Lev BTC',
    },
    features: {
      highYield: {
        title: 'High-Yield',
        subtitle: 'via Aave',
      },
      leverage: {
        title: '2.5x Leverage',
        subtitle: 'Bitcoin positions',
      },
      secure: {
        title: 'US Designed',
        subtitle: 'Simple & Secure',
      },
    },
  },
  
    
  // Color schemes for risk profiles
  colors: {
    conservative: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    morpho: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    aggressive: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  },
} as const;

export type StackConfig = typeof STACK_CONFIG;
