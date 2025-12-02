import { useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Wallet, LogOut, Loader2, Coins, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { useWalletBalances } from '@/hooks/useWalletBalances';

export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [isConnecting, setIsConnecting] = useState(false);
  const { avaxBalance, usdcBalance, isLoading, avaxSymbol, usdcSymbol } = useWalletBalances();

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      // Use the first (and only) WalletConnect connector
      const walletConnectConnector = connectors.find(c => c.id === 'walletConnect');
      if (walletConnectConnector) {
        await connect({ connector: walletConnectConnector });
        toast.success('Wallet connected successfully!');
      } else {
        toast.error('WalletConnect not available');
      }
    } catch (error) {
      console.error('Connection error:', error);
      toast.error('Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    toast.info('Wallet disconnected');
  };

  if (isConnected && address) {
    return (
      <Card className="p-6 bg-card shadow-card hover:shadow-card-hover transition-all duration-300">
        <div className="space-y-4">
          {/* Wallet Address */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Connected Wallet</p>
                <p className="text-sm font-mono font-semibold text-foreground">
                  {address.slice(0, 6)}...{address.slice(-4)}
                </p>
              </div>
            </div>
            <Button
              onClick={handleDisconnect}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <LogOut className="h-4 w-4" />
              Disconnect
            </Button>
          </div>

          {/* Wallet Balances */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/50">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className="p-2 rounded-lg bg-orange-500/10">
                <Coins className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">AVAX Balance</p>
                <p className="text-sm font-semibold">
                  {isLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    `${parseFloat(avaxBalance).toFixed(4)} ${avaxSymbol}`
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <DollarSign className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">USDC Balance</p>
                <p className="text-sm font-semibold">
                  {isLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    `$${parseFloat(usdcBalance).toFixed(2)} ${usdcSymbol}`
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-card shadow-card hover:shadow-card-hover transition-all duration-300 animate-slide-up">
      <div className="flex flex-col items-center text-center space-y-4">
        <div className="p-4 rounded-full bg-gradient-primary">
          <Wallet className="h-8 w-8 text-white" />
        </div>
        <div>
          <h3 className="text-xl font-semibold mb-2">Connect Your Wallet</h3>
          <p className="text-sm text-muted-foreground">
            Connect your wallet to start using Aave on Avalanche
          </p>
        </div>
        <Button
          onClick={handleConnect}
          disabled={isConnecting}
          className="w-full bg-gradient-primary hover:opacity-90 transition-opacity"
          size="lg"
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Wallet className="mr-2 h-4 w-4" />
              Connect Wallet
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
