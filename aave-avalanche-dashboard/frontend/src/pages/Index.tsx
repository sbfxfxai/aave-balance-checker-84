import { SimpleDashboard } from '@/components/SimpleDashboard';
import { NetworkGuard } from '@/components/NetworkGuard';
import { Footer } from '@/components/Footer';
import { useAccount } from 'wagmi';
import { TrendingUp, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';

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
            <div className="flex items-center gap-2">
              <ConnectWalletButton />
              <nav className="flex items-center gap-2" aria-label="Main navigation">
                <Link to="/gmx" aria-label="Go to Bitcoin trading page">
                  <Button variant="outline" className="flex items-center gap-2" aria-label="Bitcoin Trading">
                    <TrendingUp className="h-4 w-4" aria-hidden="true" />
                    GMX
                  </Button>
                </Link>
                <Link to="/stack" aria-label="Go to Auto Invest page">
                  <Button variant="outline" className="flex items-center gap-2" aria-label="Auto Invest">
                    <Zap className="h-4 w-4" aria-hidden="true" />
                    Stack App
                  </Button>
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Network Guard - Shows warning if on wrong chain */}
          <NetworkGuard />
          
          {/* Simple Dashboard */}
          <SimpleDashboard />
        </div>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

const Index = () => {
  return <DashboardContent />;
};

export default Index;
