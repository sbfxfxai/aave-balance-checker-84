import { avalanche, arbitrum } from 'wagmi/chains'

// ERGC Token ABI (simplified for reference)
export const ergcTokenAbi = [
  {
    inputs: [
      { internalType: 'string', name: 'name', type: 'string' },
      { internalType: 'string', name: 'symbol', type: 'string' },
      { internalType: 'uint8', name: 'decimals', type: 'uint8' },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

// Aave Pool Data Provider ABI (simplified)
export const aavePoolDataProviderAbi = [
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'getUserAccountData',
    outputs: [
      {
        components: [
          { internalType: 'uint256', name: 'totalCollateralBase', type: 'uint256' },
          { internalType: 'uint256', name: 'totalDebtBase', type: 'uint256' },
          { internalType: 'uint256', name: 'availableBorrowsBase', type: 'uint256' },
          { internalType: 'uint256', name: 'currentLiquidationThreshold', type: 'uint256' },
          { internalType: 'uint256', name: 'ltv', type: 'uint256' },
          { internalType: 'uint256', name: 'healthFactor', type: 'uint256' },
        ],
        internalType: 'struct AaveProtocolDataProvider.UserAccountData',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const

// Enhanced Avalanche configuration
export const supportedChains = {
  avalanche: {
    ...avalanche,
    name: 'Avalanche C-Chain',
    nativeCurrency: {
      ...avalanche.nativeCurrency,
      name: 'AVAX',
      symbol: 'AVAX',
      decimals: 18,
    },
    blockExplorers: {
      default: { name: 'Snowtrace', url: 'https://snowtrace.io' },
      snowtrace: { name: 'Snowtrace', url: 'https://snowtrace.io' },
    },
    contracts: {
      // Aave V3 Contracts on Avalanche
      poolDataProvider: {
        address: '0x69FA6884D2e0C7D0c0C368bBbF0Ea816548438e6', // Aave V3 Pool Data Provider
        abi: aavePoolDataProviderAbi,
      },
      pool: {
        address: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // Aave V3 Pool
      },
      aToken: {
        address: '0x625eDD8bA69A7444225d972e4455F7DAe6397Cbe', // aAVAX
      },
      variableDebtToken: {
        address: '0x72E95b893197485dF5480EB54849B653F58c71E4', // Variable Debt AVAX
      },
      stableDebtToken: {
        address: '0xA4F70C1b735622cF9765A16b7Ab6e3d8a5e9A0C8', // Stable Debt AVAX
      },
      
      // ERGC Token Contract (if deployed)
      ergcToken: {
        address: import.meta.env.VITE_ERGC_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000',
        abi: ergcTokenAbi,
      },
      
      // Common ERC20 Tokens on Avalanche
      usdc: {
        address: '0xB97EF9Ef8734C71904D8002F8b6Bc4Dd79c1555c', // USDC.e
      },
      usdt: {
        address: '0xde3A2402858088a48A694681986b518c2FC04De7', // USDT.e
      },
      dai: {
        address: '0xd586E7F844eA0537bDA5789a627694485366A4f1', // DAI.e
      },
      wbtc: {
        address: '0x408D5cD7F13bFd3D987b2Bc0403225bDfD6D8774', // WBTC.e
      },
      weth: {
        address: '0x49D5c2BdF8b38d7836643A7c61cD9498086a31A8', // WAVAX
      },
    },
  },
  
  arbitrum: {
    ...arbitrum,
    name: 'Arbitrum One',
    nativeCurrency: {
      ...arbitrum.nativeCurrency,
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    blockExplorers: {
      default: { name: 'Arbiscan', url: 'https://arbiscan.io' },
      arbiscan: { name: 'Arbiscan', url: 'https://arbiscan.io' },
    },
    contracts: {
      // Morpho Blue Contracts on Arbitrum
      morphoBlue: {
        address: '0xAAAAe7238682C31C4F69AB581eBA0D1E4e4143F', // Morpho Blue Meta-Morpho
        abi: [], // Add Morpho ABI when needed
      },
      morphoMarket: {
        address: '0x33333333fCB1d3a44c0cB0d5114B689f7B6512A7', // Example Morpho Market
        abi: [], // Add Morpho Market ABI when needed
      },
      
      // Common ERC20 Tokens on Arbitrum
      usdc: {
        address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
        abi: [], // Standard ERC20 ABI
      },
      usdt: {
        address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
        abi: [], // USDT specific ABI
      },
      dai: {
        address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
        abi: [], // Standard ERC20 ABI
      },
      wbtc: {
        address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', // WBTC
        abi: [], // Standard ERC20 ABI
      },
      weth: {
        address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
        abi: [], // Standard ERC20 ABI
      },
    },
  },
} as const

// Chain type exports
export type SupportedChain = typeof supportedChains.avalanche | typeof supportedChains.arbitrum

// Helper functions
export const getChainById = (chainId: number) => {
  switch (chainId) {
    case avalanche.id:
      return supportedChains.avalanche
    case arbitrum.id:
      return supportedChains.arbitrum
    default:
      return null
  }
}

export const getChainName = (chainId: number): string => {
  const chain = getChainById(chainId)
  return chain?.name || `Chain ${chainId}`
}

export const getBlockExplorer = (chainId: number) => {
  const chain = getChainById(chainId)
  return chain?.blockExplorers?.default
}

// Contract type definition
interface ContractConfig {
  address: string
  abi: readonly unknown[]
}

interface ChainContracts {
  [key: string]: ContractConfig
}

interface EnhancedChain {
  name: string
  nativeCurrency: {
    name: string
    symbol: string
    decimals: number
  }
  blockExplorers: {
    default: { name: string; url: string }
    [key: string]: { name: string; url: string }
  }
  contracts: ChainContracts
}

export const getContract = (chainId: number, contractName: string): ContractConfig | null => {
  const chain = getChainById(chainId) as EnhancedChain
  if (!chain || !chain.contracts) return null
  
  return chain.contracts[contractName] || null
}

// Default export for easy importing
export default supportedChains
