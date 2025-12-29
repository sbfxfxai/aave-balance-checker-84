import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Bitcoin, Zap, Home } from 'lucide-react';

export function Navigation() {
  return (
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
                TiltVault
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground hidden sm:block">Secure Banking & Investments</p>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link to="/">
              <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4">
                <Home className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Banking</span>
              </Button>
            </Link>
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
  );
}
