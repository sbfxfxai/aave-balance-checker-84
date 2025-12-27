import { SimpleDashboard } from '@/components/SimpleDashboard';
import { NetworkGuard } from '@/components/NetworkGuard';
import { useAccount } from 'wagmi';
import { TrendingUp, Zap, Bitcoin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Web3Providers } from '@/components/Web3Providers';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DirectWalletConnect } from '@/components/DirectWalletConnect';

function DashboardContent() {
  const { isConnected } = useAccount();

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <img 
                src="/tiltvault-logo.png" 
                alt="TiltVault" 
                className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg"
              />
              <div>
                <h1 className="text-lg sm:text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                  Banking
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">Savings & Lending</p>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <Link to="/gmx">
                <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4">
                  <Bitcoin className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Bitcoin</span>
                </Button>
              </Link>
              <Link to="/stack">
                <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4">
                  <Zap className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Auto</span>
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Network Guard - Shows warning if on wrong chain */}
          <NetworkGuard />
          
          {/* Simple Dashboard with Error Boundary */}
          <ErrorBoundary>
            <SimpleDashboard />
          </ErrorBoundary>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-16">
        <div className="container mx-auto px-4 py-4 sm:py-6">
          <p className="text-center text-xs sm:text-sm text-muted-foreground">
            TiltVault • Secure Banking & Investments
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function DashboardWithWeb3() {
  return (
    <Web3Providers>
      <DirectWalletConnect>
        <DashboardContent />
      </DirectWalletConnect>
    </Web3Providers>
  );
}
