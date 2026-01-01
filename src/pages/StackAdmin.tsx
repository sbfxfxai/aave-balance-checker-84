import { AdminDashboard } from '@/components/stack/AdminDashboard';
import { Web3Providers } from '@/components/Web3Providers';

export default function StackAdmin() {
  return (
    <Web3Providers>
      <div className="min-h-screen bg-gradient-subtle">
        <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-primary">
                  <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                    Stack Admin
                  </h1>
                  <p className="text-sm text-muted-foreground">Deposit Management</p>
                </div>
              </div>
              <nav className="flex items-center gap-4">
                <a href="/stack" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Stack App
                </a>
                <a href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Dashboard
                </a>
              </nav>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          <div className="max-w-6xl mx-auto">
            <AdminDashboard />
          </div>
        </main>

        <footer className="border-t border-border/50 mt-16">
          <div className="container mx-auto px-4 py-6">
            <p className="text-center text-sm text-muted-foreground">
              Stack Admin • USDC on Avalanche
            </p>
            <p className="text-center text-xs sm:text-sm text-muted-foreground mt-2">
              Support: <a href="mailto:support@tiltvault.com" className="text-emerald-500 hover:underline">support@tiltvault.com</a>
            </p>
          </div>
        </footer>
      </div>
    </Web3Providers>
  );
}
