import { SimpleDashboard } from '@/components/SimpleDashboard';
import { NetworkGuard } from '@/components/NetworkGuard';
import { Footer } from '@/components/Footer';
import { useAccount } from 'wagmi';
import { TrendingUp, Zap, Bitcoin } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Web3Providers } from '@/components/Web3Providers';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DirectWalletConnect } from '@/components/DirectWalletConnect';
import { PrivyLogin } from '@/components/PrivyLogin';
import { OptimizedLogo } from '@/components/OptimizedLogo';

function DashboardContent() {
  const { isConnected } = useAccount();

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <OptimizedLogo loading="eager" />
              <div>
                <h1 className="text-lg sm:text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                  Banking
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">Savings & Lending</p>
              </div>
            </div>
            <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main navigation">
              <Link to="/gmx" aria-label="Go to Bitcoin trading page">
                <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4" aria-label="Bitcoin">
                  <Bitcoin className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Bitcoin</span>
                </Button>
              </Link>
              <Link to="/stack" aria-label="Go to Auto Invest page">
                <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4" aria-label="Auto Invest">
                  <Zap className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Auto</span>
                </Button>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Network Guard - Shows warning if on wrong chain */}
          <NetworkGuard />

          {/* Authentication Section */}
          <div className="grid gap-6 md:grid-cols-2 mb-8">
            <div className="md:col-span-2">
              <PrivyLogin />
            </div>
          </div>

          {/* Simple Dashboard with Error Boundary */}
          <ErrorBoundary>
            <SimpleDashboard />
          </ErrorBoundary>
        </div>
      </main>

      {/* Footer */}
      <Footer />
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
