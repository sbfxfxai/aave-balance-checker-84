import { useEffect } from 'react';
import { useAccount, useConnect } from 'wagmi';

interface AutoConnectWalletProps {
  children: React.ReactNode;
}

export function AutoConnectWallet({ children }: AutoConnectWalletProps) {
  const { isConnected } = useAccount();
  const { connect } = useConnect();

  useEffect(() => {
    // Check if we have a wallet in sessionStorage and we're not already connected
    if (!isConnected) {
      const walletData = sessionStorage.getItem('tiltvault_wallet');
      if (walletData) {
        try {
          const { privateKey } = JSON.parse(walletData);
          
          // For wagmi, we need to use a custom connector or import the private key
          // Since wagmi doesn't directly support private key import, we'll use a different approach
          console.log('[AutoConnect] Found wallet in sessionStorage, attempting to connect...');
          
          // Store the private key for the wallet connect component to use
          localStorage.setItem('tiltvault_temp_private_key', privateKey);
          
          // Clear sessionStorage after use
          sessionStorage.removeItem('tiltvault_wallet');
          
        } catch (error) {
          console.error('[AutoConnect] Failed to parse wallet data:', error);
          sessionStorage.removeItem('tiltvault_wallet');
        }
      }
    }
  }, [isConnected, connect]);

  return <>{children}</>;
}
