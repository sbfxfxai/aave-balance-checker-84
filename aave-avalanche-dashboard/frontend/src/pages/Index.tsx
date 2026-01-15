import { SimpleDashboard } from '@/components/SimpleDashboard';
import { NetworkGuard } from '@/components/NetworkGuard';
import { Footer } from '@/components/Footer';
import { useAccount } from 'wagmi';
import { TrendingUp, Zap, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';
import { usePrivy } from '@privy-io/react-auth';

function DashboardContent() {
  const { isConnected, address } = useAccount();
  const { authenticated, user } = usePrivy();

  return (
    <div className="min-h-screen bg-background">
      {/* Header - matching reference */}
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <a href="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <span className="text-lg font-bold text-primary-foreground">T</span>
              </div>
              <span className="text-xl font-bold text-foreground">TiltVault</span>
            </a>
            <nav className="hidden md:flex items-center gap-1">
              <Link to="/stack">
                <Button variant="nav" size="sm">Start Investing</Button>
              </Link>
              <Link to="/gmx">
                <Button variant="nav" size="sm">Bitcoin Trading</Button>
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {isConnected && address && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-muted">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-mono">{address.slice(0, 6)}...{address.slice(-4)}</span>
              </div>
            )}
            {authenticated && user?.email && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-muted">
                <span className="text-sm">{user.email.address}</span>
              </div>
            )}
            <ConnectWalletButton />
          </div>
        </div>
      </header>

      {/* Main Content - Get right to business */}
      <main>
        <div className="container">
          {/* Network Guard - Shows warning if on wrong chain */}
          <NetworkGuard />
          
          {/* Simple Dashboard - Shows immediately when connected */}
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
