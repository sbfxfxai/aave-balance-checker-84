import { erc20Abi } from 'viem';

// Avalanche C-Chain Contract Addresses

export const CONTRACTS = {
  // Tokens
  WAVAX: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Native USDC
  USDC_E: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664', // Bridged USDC.e
  ERGC: '0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B', // EnergyCoin - fee discount token
  
  // Aave V3 Avalanche Mainnet - VERIFIED ADDRESSES
  AAVE_POOL_ADDRESSES_PROVIDER: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
  AAVE_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', 
  AAVE_POOL_DATA_PROVIDER: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654',
  AAVE_UI_POOL_DATA_PROVIDER: '0x53430E0f88cC6d7b204535B3AF47538C0e0a3d48',
  
  // DEX Routers
  TRADER_JOE_ROUTER: '0x60aE616a2155Ee3d9A68541Ba4544862310933d4',
} as const;

// ERGC Fee Discount Constants
export const ERGC_DISCOUNT = {
  THRESHOLD: 100n * 10n ** 18n, // 100 ERGC required for discount
  STANDARD_FEE: 0.23, // 0.23 AVAX standard GMX fee
  DISCOUNTED_FEE: 0.1, // 0.1 AVAX with ERGC discount
  PRICE_USD: 0.10, // $0.10 per ERGC (100 = $10)
  PURCHASE_AMOUNT: 100, // 100 ERGC per purchase ($10)
  SEND_TO_USER: 100, // send full 100 (no burn)
} as const;

export const ERC20_ABI = erc20Abi;

// WAVAX (Wrapped AVAX) ABI - for wrapping native AVAX
export const WAVAX_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: []
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: []
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  ...erc20Abi
] as const;

export const AAVE_POOL_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' }
    ],
    outputs: []
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'borrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'onBehalfOf', type: 'address' }
    ],
    outputs: []
  },
  {
    name: 'repay',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'rateMode', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'getUserAccountData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalCollateralBase', type: 'uint256' },
      { name: 'totalDebtBase', type: 'uint256' },
      { name: 'availableBorrowsBase', type: 'uint256' },
      { name: 'currentLiquidationThreshold', type: 'uint256' },
      { name: 'ltv', type: 'uint256' },
      { name: 'healthFactor', type: 'uint256' }
    ]
  }
] as const;

export const AAVE_POOL_ADDRESSES_PROVIDER_ABI = [
  {
    name: 'getPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    name: 'getPoolAddress',
    type: 'function', 
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    name: 'getAddress',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }]
  }
] as const;

export const AAVE_DATA_PROVIDER_ABI = [
  {
    name: 'getUserReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'user', type: 'address' }
    ],
    outputs: [
      { name: 'currentATokenBalance', type: 'uint256' },
      { name: 'currentStableDebt', type: 'uint256' },
      { name: 'currentVariableDebt', type: 'uint256' },
      { name: 'principalStableDebt', type: 'uint256' },
      { name: 'scaledVariableDebt', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'stableRateLastUpdated', type: 'uint40' },
      { name: 'usageAsCollateralEnabled', type: 'bool' }
    ]
  },
  {
    name: 'getReserveData',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'asset', type: 'address' }],
    outputs: [
      { name: 'unbacked', type: 'uint256' },
      { name: 'accruedToTreasuryScaled', type: 'uint256' },
      { name: 'totalAToken', type: 'uint256' },
      { name: 'totalStableDebt', type: 'uint256' },
      { name: 'totalVariableDebt', type: 'uint256' },
      { name: 'liquidityRate', type: 'uint256' },
      { name: 'variableBorrowRate', type: 'uint256' },
      { name: 'stableBorrowRate', type: 'uint256' },
      { name: 'averageStableBorrowRate', type: 'uint256' },
      { name: 'liquidityIndex', type: 'uint256' },
      { name: 'variableBorrowIndex', type: 'uint256' },
      { name: 'lastUpdateTimestamp', type: 'uint40' }
    ]
  }
] as const;

export const ROUTER_ABI = [
  {
    name: 'swapExactAVAXForTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  },
  {
    name: 'swapExactTokensForAVAX',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  },
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  }
] as const;
