import { SimpleDashboard } from '@/components/SimpleDashboard';
import { NetworkGuard } from '@/components/NetworkGuard';
import { useAccount } from 'wagmi';
import { TrendingUp, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Web3Providers } from '@/components/Web3Providers';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function DashboardContent() {
  const { isConnected } = useAccount();

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-primary">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                  Aave Dashboard
                </h1>
                <p className="text-sm text-muted-foreground">Avalanche C-Chain</p>
              </div>
            </div>
            <Link to="/stack">
              <Button variant="outline" className="flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Stack App
              </Button>
            </Link>
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
        <div className="container mx-auto px-4 py-6">
          <p className="text-center text-sm text-muted-foreground">
            Powered by Aave V3 • Avalanche C-Chain • Trader Joe
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function DashboardWithWeb3() {
  return (
    <Web3Providers>
      <DashboardContent />
    </Web3Providers>
  );
}
