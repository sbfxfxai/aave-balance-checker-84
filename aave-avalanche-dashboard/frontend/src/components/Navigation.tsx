import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Bitcoin, Zap, Home, ExternalLink } from 'lucide-react';
import { OptimizedLogo } from '@/components/OptimizedLogo';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';
import { useErgcPurchaseModal } from '@/contexts';

export function Navigation() {
  const { openModal } = useErgcPurchaseModal();

  return (
    <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <OptimizedLogo loading="eager" />
            <div>
              <h1 className="text-lg sm:text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                TiltVault
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">Secure Banking & Investments</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={openModal}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 hover:border-purple-500/50 transition-colors text-xs font-medium text-purple-400 hover:text-purple-300"
              title="Get ERGC - Buy directly or trade on DEX"
            >
              <Zap className="h-3 w-3" />
              <span>Get ERGC</span>
              <ExternalLink className="h-3 w-3" />
            </button>
            <ConnectWalletButton />
            <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main navigation">
            <Link to="/" aria-label="Go to Banking page">
              <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4" aria-label="Banking">
                <Home className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Banking</span>
              </Button>
            </Link>
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
      </div>
    </header>
  );
}
