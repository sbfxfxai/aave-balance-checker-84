import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useAccount, useDisconnect } from 'wagmi';

interface DirectWalletConnectProps {
  children: React.ReactNode;
}

export function DirectWalletConnect({ children }: DirectWalletConnectProps) {
  const { isConnected, address } = useAccount();
  const { disconnect } = useDisconnect();
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const connectFromSession = async () => {
      if (!isConnected) {
        const walletData = sessionStorage.getItem('tiltvault_wallet');
        if (walletData) {
          try {
            const { privateKey, address: walletAddress } = JSON.parse(walletData);
            
            console.log('[DirectWalletConnect] Found wallet, connecting...');
            setIsConnecting(true);
            
            // Create provider and wallet
            const provider = new ethers.JsonRpcProvider('https://api.avax.network/ext/bc/C/rpc');
            const wallet = new ethers.Wallet(privateKey, provider);
            
            // Verify the address matches
            if (wallet.address.toLowerCase() === walletAddress.toLowerCase()) {
              console.log('[DirectWalletConnect] Wallet verified, address:', wallet.address);
              
              // Store in a global context for the dashboard to use
              (window as any).tiltvaultWallet = {
                address: wallet.address,
                privateKey,
                provider,
                signer: wallet,
              };
              
              // Clear sessionStorage
              sessionStorage.removeItem('tiltvault_wallet');
              
              // Redirect to refresh wagmi state
              setTimeout(() => {
                window.location.reload();
              }, 100);
            } else {
              console.error('[DirectWalletConnect] Address mismatch');
              sessionStorage.removeItem('tiltvault_wallet');
            }
          } catch (error) {
            console.error('[DirectWalletConnect] Failed to connect:', error);
            sessionStorage.removeItem('tiltvault_wallet');
          } finally {
            setIsConnecting(false);
          }
        }
      }
    };

    connectFromSession();
  }, [isConnected]);

  if (isConnecting) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse bg-muted h-10 w-32 rounded-md mx-auto mb-4" />
          <p className="text-muted-foreground">Connecting wallet...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
