import { PrivyClientConfig } from '@privy-io/react-auth';
import { avalanche, mainnet } from 'viem/chains';

// Privy App ID from dashboard
export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || 'cmjr7fmh401r3lb0cwy6fmhhb';

// ZeroDev Configuration - Standard sponsorship (gasless transactions)
// NOTE: ZeroDev is configured in Privy Dashboard with standard sponsorship active
// Privy will automatically use ZeroDev paymaster for all transactions
export const ZERODEV_PROJECT_ID = import.meta.env.VITE_ZERODEV_PROJECT_ID || '48d24526-522e-40de-b1bc-8c0082fc38a5';
export const ZERODEV_PAYMASTER_ADDRESS = '0x8170e28A725B5747c24B71bd39e1f194CA8EBE3c';
export const ZERODEV_BUNDLER_URL = import.meta.env.VITE_ZERODEV_BUNDLER_URL || 'https://rpc.zerodev.app/api/v3/48d24526-522e-40de-b1bc-8c0082fc38a5/chain/43114';

// Privy configuration for TiltVault
export const privyConfig: PrivyClientConfig = {
    // Login methods - email only
    loginMethods: ['email'],

    // Appearance customization
    appearance: {
        theme: 'dark',
        accentColor: '#10b981', // Emerald green to match TiltVault
        logo: '/tiltvault-logo.png',
        walletList: [], // Hide wallet options since we use smart wallets
        walletChainType: 'ethereum-only', // Disable Solana to avoid connector warnings
        // Disable injected wallet detection to prevent conflicts with Web3 connection
        showWalletLoginFirst: false, // Don't show wallet login first
    },
    
    // Disable injected wallet connectors to prevent auto-detection conflicts
    // We handle Web3 wallet connection separately via wagmi
    // This prevents Privy from trying to auto-connect to MetaMask
    // @ts-expect-error - Privy internal option to disable injected wallet detection
    disableInjectedWalletAutoConnect: true,

    // Set Avalanche as default chain
    // NOTE: Including mainnet in supportedChains as workaround for Privy's chain detection
    // We force switch to Avalanche before all transactions
    defaultChain: avalanche,
    supportedChains: [avalanche, mainnet], // Add mainnet to prevent "Chain ID 1 not supported" error

    // Embedded wallet configuration
    // NOTE: ZeroDev paymaster with standard sponsorship is configured in Privy Dashboard
    // Go to Privy Dashboard > Your App > Settings > Smart Wallets > ZeroDev
    // Standard sponsorship is active - all transactions will be gasless
    embeddedWallets: {
        ethereum: {
            createOnLogin: 'users-without-wallets', // Auto-create wallet on signup
            // ZeroDev with standard sponsorship is configured in Privy Dashboard
            // Privy will automatically use ZeroDev paymaster for gas sponsorship
        },
    },

    // Disable analytics to prevent CORS errors
    // Privy analytics endpoints are not meant to be called directly from browser
    // and will cause CORS errors. The SDK handles analytics internally when enabled.
    disableAnalytics: true,

    // Legal notices
    legal: {
        termsAndConditionsUrl: 'https://tiltvault.com/terms',
        privacyPolicyUrl: 'https://tiltvault.com/privacy',
    },
};

// ZeroDev configuration for smart wallets
export const zeroDevConfig = {
    projectId: ZERODEV_PROJECT_ID,
    bundlerUrl: ZERODEV_BUNDLER_URL,
    paymasterAddress: ZERODEV_PAYMASTER_ADDRESS,
    chainId: 43114, // Avalanche C-Chain
};

// Session key permissions for GMX trading
export const sessionKeyPermissions = {
    // Allow interactions with GMX contracts
    allowedContracts: [
        '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68', // GMX SyntheticsRouter
        '0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2', // GMX ExchangeRouter
        '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // USDC
        '0x794a61358D6845594F94dc1DB02A252b5b4814aD', // Aave Pool
    ],
    // Session key validity period (7 days)
    validUntil: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
};
