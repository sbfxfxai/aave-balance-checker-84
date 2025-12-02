import { WalletConnect } from '@/components/WalletConnect';
import { PositionCard } from '@/components/PositionCard';
import { DepositModal } from '@/components/DepositModal';
import { WithdrawModal } from '@/components/WithdrawModal';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useAccount } from 'wagmi';
import { TrendingUp } from 'lucide-react';

function DashboardContent() {
  const { isConnected } = useAccount();
  const positions = useAavePositions();

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
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Wallet Connection */}
          <WalletConnect />

          {/* Dashboard */}
          {isConnected && (
            <>
              {/* Positions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <PositionCard
                  title="USDC Supplied"
                  value={`$${parseFloat(positions.usdcSupplied).toFixed(2)}`}
                  subtitle="In Aave V3"
                  icon="supplied"
                  isLoading={positions.isLoading}
                />
                <PositionCard
                  title="Total Borrowed"
                  value={`$${parseFloat(positions.usdcBorrowed).toFixed(2)}`}
                  subtitle="USDC Debt"
                  icon="borrowed"
                  isLoading={positions.isLoading}
                />
                <PositionCard
                  title="Health Factor"
                  value={positions.healthFactor}
                  subtitle="Safety level"
                  icon="health"
                  isLoading={positions.isLoading}
                />
                <PositionCard
                  title="Available to Borrow"
                  value={`$${parseFloat(positions.availableBorrow).toFixed(2)}`}
                  subtitle="Maximum borrow"
                  icon="available"
                  isLoading={positions.isLoading}
                />
              </div>

              {/* Action Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Deposit Card */}
                <div className="p-8 rounded-2xl bg-card shadow-card hover:shadow-card-hover transition-all duration-300 border border-border/50">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-2xl font-bold mb-2">Deposit & Earn</h3>
                      <p className="text-muted-foreground">
                        Deposit AVAX, automatically swap to USDC, and supply to Aave V3 to earn interest
                      </p>
                    </div>
                    <div className="pt-4">
                      <DepositModal />
                    </div>
                  </div>
                </div>

                {/* Withdraw Card */}
                <div className="p-8 rounded-2xl bg-card shadow-card hover:shadow-card-hover transition-all duration-300 border border-border/50">
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-2xl font-bold mb-2">Withdraw</h3>
                      <p className="text-muted-foreground">
                        Withdraw your USDC from Aave and automatically swap back to AVAX
                      </p>
                    </div>
                    <div className="pt-4">
                      <WithdrawModal />
                    </div>
                  </div>
                </div>
              </div>

              {/* Info Banner */}
              <div className="p-6 rounded-xl bg-primary/5 border border-primary/20">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold mb-1">How it works</h4>
                    <p className="text-sm text-muted-foreground">
                      This dashboard connects directly to Aave V3 on Avalanche. Your AVAX is swapped to USDC via Trader Joe DEX, 
                      then supplied to Aave where you earn interest. Withdrawals reverse the process automatically.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
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

const Index = () => {
  return <DashboardContent />;
};

export default Index;
