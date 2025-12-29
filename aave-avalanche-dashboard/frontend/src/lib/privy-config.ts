import { PrivyClientConfig } from '@privy-io/react-auth';

// Privy App ID from dashboard
export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || 'cmjr7fmh401r3lb0cwy6fmhhb';

// Privy configuration for TiltVault
export const privyConfig: PrivyClientConfig = {
    // Login methods - email is primary for "Robinhood-like" experience
    loginMethods: ['email', 'google', 'apple'],

    // Appearance customization
    appearance: {
        theme: 'dark',
        accentColor: '#10b981', // Emerald green to match TiltVault
        logo: '/logo.png',
        walletList: [], // Hide wallet options since we use smart wallets
    },

    // Embedded wallet configuration
    embeddedWallets: {
        createOnLogin: 'users-without-wallets', // Auto-create wallet on signup
        noPromptOnSignature: true, // Don't show confirmation modals (we use custom UI)
    },

    // Legal notices
    legal: {
        termsAndConditionsUrl: 'https://tiltvault.com/terms',
        privacyPolicyUrl: 'https://tiltvault.com/privacy',
    },
};

// ZeroDev configuration for smart wallets
export const zeroDevConfig = {
    projectId: import.meta.env.VITE_ZERODEV_PROJECT_ID || '',
    bundlerUrl: import.meta.env.VITE_ZERODEV_BUNDLER_URL || '',
    paymasterUrl: import.meta.env.VITE_ZERODEV_PAYMASTER_URL || '',
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
