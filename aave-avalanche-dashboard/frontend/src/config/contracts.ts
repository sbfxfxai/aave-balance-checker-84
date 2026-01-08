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
  
  // Morpho Vaults on Arbitrum (ERC-4626)
  // Reference: Morpho V2 Contracts on Arbitrum
  // - VaultV2Factory: 0x6b46fa3cc9EBF8aB230aBAc664E37F2966Bf7971
  // - MorphoRegistry: 0xc00eb3c7aD1aE986A7f05F5A9d71aCa39c763C65
  // - MORPHO Token: 0x40BD670A58238e6E230c430BBb5cE6ec0d40df48 (18 decimals)
  MORPHO_EURC_VAULT: '0x7e97fa6893871A2751B5fE961978DCCb2c201E65', // Morpho EURC Vault on Arbitrum - VERIFIED
  MORPHO_DAI_VAULT: '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027', // Morpho DAI Vault on Arbitrum - VERIFIED
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

// ERC-4626 Vault ABI (Morpho V2 compatible)
// Morpho V2 vaults implement ERC-4626 with additional allocation functions
// Standard deposit/withdraw functions route through liquidityAdapter automatically
export const ERC4626_VAULT_ABI = [
  // Standard ERC-4626 functions
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'onBehalf', type: 'address' } // Morpho V2 uses 'onBehalf' instead of 'receiver'
    ],
    outputs: [{ name: 'shares', type: 'uint256' }]
  },
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'onBehalf', type: 'address' }
    ],
    outputs: [{ name: 'assets', type: 'uint256' }]
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'onBehalf', type: 'address' } // Morpho V2 uses 'onBehalf' instead of 'owner'
    ],
    outputs: [{ name: 'shares', type: 'uint256' }]
  },
  {
    name: 'redeem',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'onBehalf', type: 'address' } // Morpho V2 uses 'onBehalf' instead of 'owner'
    ],
    outputs: [{ name: 'assets', type: 'uint256' }]
  },
  {
    name: 'asset',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    name: 'totalAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'convertToShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'convertToAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'previewDeposit',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'previewMint',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'previewWithdraw',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'assets', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'previewRedeem',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  // Morpho V2 specific functions (for debugging/verification)
  {
    name: 'liquidityAdapter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    name: 'liquidityData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes' }]
  },
  {
    name: 'accrueInterestView',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'newTotalAssets', type: 'uint256' },
      { name: 'performanceFeeShares', type: 'uint256' },
      { name: 'managementFeeShares', type: 'uint256' }
    ]
  }
] as const;

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
