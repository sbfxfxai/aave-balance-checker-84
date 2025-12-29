import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { PRIVY_APP_ID, privyConfig } from '@/lib/privy-config';

interface PrivyAuthProviderProps {
    children: React.ReactNode;
}

/**
 * PrivyAuthProvider wraps the app with Privy authentication
 * This enables email-based login and smart wallet creation
 */
export function PrivyAuthProvider({ children }: PrivyAuthProviderProps) {
    return (
        <PrivyProvider
            appId={PRIVY_APP_ID}
            config={privyConfig}
        >
            {children}
        </PrivyProvider>
    );
}

export default PrivyAuthProvider;
