import { lazy, useState, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Wallet, TrendingUp, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

// Lazy load the actual dashboard with Web3 (only loads when user clicks "Connect Wallet")
const DashboardWithWeb3 = lazy(() => import('./DashboardWithWeb3'));

// Loading fallback for Web3 dashboard
const Web3LoadingFallback = () => (
  <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
    <div className="text-center space-y-4">
      <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      <p className="text-sm text-muted-foreground">Loading dashboard...</p>
    </div>
  </div>
);

export default function IndexStatic() {
  const [showWeb3, setShowWeb3] = useState(false);

  if (showWeb3) {
    return (
      <Suspense fallback={<Web3LoadingFallback />}>
        <DashboardWithWeb3 />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Static header (no web3 yet) */}
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
                <TrendingUp className="h-4 w-4" />
                Stack App
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Static landing section */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto text-center space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-bold">Track your Aave positions</h2>
            <p className="text-xl text-muted-foreground">
              Supply, borrow, and manage your DeFi portfolio on Avalanche C-Chain
            </p>
          </div>
          <div className="flex justify-center gap-4">
            <Button size="lg" className="flex items-center gap-2" onClick={() => setShowWeb3(true)}>
              <Wallet className="h-5 w-5" />
              Connect Wallet to Start
            </Button>
          </div>
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
