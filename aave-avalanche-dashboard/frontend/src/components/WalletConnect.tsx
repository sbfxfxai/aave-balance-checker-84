import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { Wallet, Loader2, LogOut, Coins, DollarSign } from 'lucide-react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useUsdcApy } from '@/hooks/useUsdcApy';

export function WalletConnect() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingMethod, setConnectingMethod] = useState<'metamask' | 'walletConnect' | null>(null);
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { avaxBalance, usdcBalance, isLoading, avaxSymbol, usdcSymbol } = useWalletBalances();
  const { displayApy } = useUsdcApy();

  // Check for existing email authentication
  const linkedEmail = localStorage.getItem('tiltvault_email');
  
  // Redirect email-authenticated users to stack
  useEffect(() => {
    if (linkedEmail) {
      navigate('/stack', { replace: true });
    }
  }, [linkedEmail, navigate]);

  // If user is authenticated via email, don't show wallet connect UI
  if (linkedEmail) {
    return null; // Redirecting to /stack...
  }

  const handleConnect = async (connectorId: 'metamask' | 'walletConnect' = 'metamask') => {
    // Prevent duplicate connection requests
    if (isConnecting || isConnected) return;

    setIsConnecting(true);
    setConnectingMethod(connectorId);

    try {
      const connector = connectors.find(c => c.id === connectorId);
      if (connector) {
        await connect({ connector });
        toast.success('Wallet connected successfully!');
      } else {
        toast.error('WalletConnect not available');
      }
    } catch (error) {
      console.error('Connection error:', error);
      toast.error('Failed to connect wallet');
    } finally {
      setIsConnecting(false);
      setConnectingMethod(null);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    toast.info('Wallet disconnected');
  };

  // Not authenticated - show login options
  return (
    <Card className="p-6 bg-card shadow-card hover:shadow-card-hover transition-all duration-300 animate-slide-up">
      <div className="flex flex-col items-center text-center space-y-5">
        <div className="p-4 rounded-full bg-gradient-primary">
          <Wallet className="h-8 w-8 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold mb-1">Banking that works as hard as you do</h1>
          <p className="text-sm text-muted-foreground">
            Earn <span className="font-semibold text-emerald-500">{displayApy}% APY</span> on savings. Optional managed Bitcoin exposure. Built on Aave—$70B+ secured.
          </p>
        </div>

        <div className="w-full space-y-3">
          {/* Wallet Connect */}
          <Button
            onClick={() => handleConnect('walletConnect')}
            disabled={isConnecting}
            variant="outline"
            className="w-full"
            size="lg"
          >
            {isConnecting && connectingMethod === 'walletConnect' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Wallet className="mr-2 h-4 w-4" />
                Wallet Connect
              </>
            )}
          </Button>
        </div>

        <div className="text-xs text-muted-foreground pt-3 space-y-1.5 text-left">
          <p>✓ <strong>Safety First</strong> — Secured by Aave's $70B+ audited protocol</p>
          <p>✓ <strong>Transparency</strong> — See exactly where your money goes</p>
          <p>✓ <strong>Real Banking</strong> — Bank transfers, debit card—no crypto wallet needed to start</p>
        </div>

        <div className="text-xs text-muted-foreground pt-4 border-t border-border/30 mt-4 leading-relaxed">
          <p>TiltVault is not a bank. Funds are not FDIC insured. Returns are variable and based on DeFi protocol performance. Your investment may lose value. Cryptocurrency and DeFi carry inherent risks including smart contract risk, market volatility, and potential loss of capital. <a href="/risk-disclosure" className="underline hover:text-muted-foreground">See full risk disclosure.</a></p>
        </div>
      </div>
    </Card>
  );
}
