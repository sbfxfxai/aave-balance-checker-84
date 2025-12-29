import { ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { WalletConnect } from './WalletConnect';
import { Navigation } from './Navigation';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isConnected } = useAccount();
  
  // Check if user is authenticated (has linked email OR wallet connected)
  const linkedEmail = localStorage.getItem('tiltvault_email');
  const isAuthenticated = linkedEmail || isConnected;
  
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-subtle">
        <Navigation />
        <div className="flex items-center justify-center p-4 min-h-[calc(100vh-80px)]">
          <div className="w-full max-w-md">
            <WalletConnect />
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
