import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Wallet, Loader2, Check, X } from 'lucide-react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function WalletButton() {
  const [isOpen, setIsOpen] = useState(false);
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingMethod, setConnectingMethod] = useState<string | null>(null);

  const injectedConnector = connectors.find(c => c.id === 'injected');

  const handleConnect = async (connectorId: string) => {
    if (isConnecting || isConnected) return;

    setIsConnecting(true);
    setConnectingMethod(connectorId);

    try {
      const connector = connectors.find(c => c.id === connectorId);
      if (connector) {
        await connect({ connector });
        setIsOpen(false);
      }
    } catch (error) {
      console.error('Connection error:', error);
    } finally {
      setIsConnecting(false);
      setConnectingMethod(null);
    }
  };

  const handleDisconnect = () => {
    disconnect();
    setIsOpen(false);
  };

  const truncatedAddress = address 
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : '';

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant={isConnected ? "default" : "outline"}
        size="sm"
        className="rounded-full h-9 px-3 sm:px-4 gap-2"
        aria-label={isConnected ? "Wallet connected" : "Connect wallet"}
      >
        {isConnected ? (
          <>
            <Check className="h-4 w-4" />
            <span className="hidden sm:inline font-mono text-xs">{truncatedAddress}</span>
          </>
        ) : (
          <>
            <Wallet className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">Connect Wallet</span>
          </>
        )}
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Web3 Wallet</DialogTitle>
            <DialogDescription>
              Connect your browser wallet (MetaMask, etc.) to use advanced DeFi features.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-2 py-4">
            {injectedConnector ? (
              <Button
                onClick={() => handleConnect('injected')}
                disabled={isConnecting || isConnected}
                variant="outline"
                className="w-full justify-start"
                size="lg"
              >
                {isConnecting && connectingMethod === 'injected' ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Wallet className="mr-2 h-4 w-4" />
                    Browser Wallet (MetaMask)
                  </>
                )}
              </Button>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-4">
                No browser wallet detected. Please install MetaMask or another Web3 wallet extension.
              </div>
            )}

            {isConnected && (
              <div className="pt-4 border-t space-y-2">
                <div className="text-sm text-muted-foreground">
                  Connected: <span className="font-mono">{truncatedAddress}</span>
                </div>
                <Button
                  onClick={handleDisconnect}
                  variant="destructive"
                  className="w-full"
                  size="sm"
                >
                  <X className="mr-2 h-4 w-4" />
                  Disconnect
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

