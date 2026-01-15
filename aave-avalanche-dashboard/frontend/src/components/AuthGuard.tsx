import { ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { Navigation } from './Navigation';
import { Loader2, Wallet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUsdcApy } from '@/hooks/useUsdcApy';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isConnected } = useAccount();
  const { authenticated, ready, login } = usePrivy();
  const { displayApy } = useUsdcApy();

  // Show loading state while Privy is initializing
  if (!ready) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // Check if user is authenticated (has linked email/Privy session OR wallet connected via wagmi)
  const isAuthenticated = authenticated || isConnected;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-subtle">
        <Navigation />
        <main className="max-w-2xl mx-auto p-8">
          <div className="space-y-6">
            {/* Hero Section */}
            <div className="text-center space-y-4">
              <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                Banking that works as hard as you do
              </h1>
              <p className="text-muted-foreground text-lg">
                Earn <span className="font-semibold text-emerald-500">{displayApy}% APY</span> on savings.
              </p>
            </div>

            {/* Login Options */}
            <div className="flex justify-center">
              {/* Privy Email Login */}
              <Card className="p-6 w-full max-w-md">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-3 rounded-full bg-gradient-primary">
                    <Wallet className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Email Wallet</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      Sign up with email to get a secure smart wallet
                    </p>
                    <Button
                      onClick={() => login()}
                      className="w-full"
                      size="lg"
                    >
                      Sign Up with Email
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </main>
        
        {/* Footer */}
        <footer className="border-t border-border/50 mt-16">
          <div className="container mx-auto px-4 py-6">
            <p className="text-center text-sm text-muted-foreground">
              TiltVault bridges traditional banking convenience with DeFi opportunities
            </p>
            <p className="text-center text-xs text-muted-foreground mt-2">
              High-yield savings via Aave • 2.5x leveraged Bitcoin positions • Simple, secure, designed for US users
            </p>
            <p className="text-center text-xs text-muted-foreground mt-2">
              Powered by Aave V3 • GMX • Avalanche C-Chain
            </p>
            <p className="text-center text-xs sm:text-sm text-muted-foreground mt-3">
              Support: <a href="mailto:support@tiltvault.com" className="text-emerald-500 hover:underline">support@tiltvault.com</a>
            </p>
          </div>
        </footer>
      </div>
    );
  }

  return <>{children}</>;
}
