import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Wallet, Loader2, CheckCircle2 } from 'lucide-react';

// EIP-6963 types
interface EIP6963ProviderInfo {
  rdns: string;
  uuid: string;
  name: string;
  icon: string;
}

interface EIP1193Provider {
  request: (request: { method: string; params?: Array<unknown> }) => Promise<unknown>;
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

interface DetectedProvider {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

interface MetaMaskConnectProps {
  onConnect?: (address: string, provider: EIP1193Provider) => void;
  onDisconnect?: () => void;
}

export function MetaMaskConnect({ onConnect, onDisconnect }: MetaMaskConnectProps) {
  const [providers, setProviders] = useState<DetectedProvider[]>([]);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listen for EIP-6963 provider announcements
  useEffect(() => {
    const handleAnnounceProvider = (event: Event) => {
      const customEvent = event as CustomEvent<EIP6963ProviderDetail>;
      setProviders((prev) => {
        // Avoid duplicates
        if (prev.some((p) => p.info.uuid === customEvent.detail.info.uuid)) {
          return prev;
        }
        return [...prev, { info: customEvent.detail.info, provider: customEvent.detail.provider }];
      });
    };

    window.addEventListener('eip6963:announceProvider', handleAnnounceProvider);
    
    // Request providers
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    return () => {
      window.removeEventListener('eip6963:announceProvider', handleAnnounceProvider);
    };
  }, []);

  // Connect to a specific provider
  const connectWithProvider = useCallback(async (provider: EIP1193Provider) => {
    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
      if (accounts && accounts.length > 0) {
        setConnectedAddress(accounts[0]);
        onConnect?.(accounts[0], provider);
      }
    } catch (err) {
      console.error('Failed to connect:', err);
      setError('Failed to connect to wallet');
    } finally {
      setIsConnecting(false);
    }
  }, [onConnect]);

  // Disconnect
  const disconnect = useCallback(() => {
    setConnectedAddress(null);
    onDisconnect?.();
  }, [onDisconnect]);

  // Find MetaMask provider specifically
  const metaMaskProvider = providers.find(
    (p) => p.info.rdns === 'io.metamask' || p.info.name.toLowerCase().includes('metamask')
  );

  // If connected, show connected state
  if (connectedAddress) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-green-500">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">Connected</span>
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
        </div>
        <Button variant="outline" size="sm" onClick={disconnect}>
          Disconnect
        </Button>
      </div>
    );
  }

  // If MetaMask is detected, show direct connect button
  if (metaMaskProvider) {
    return (
      <div className="flex flex-col items-center gap-3">
        <Button
          size="lg"
          className="flex items-center gap-3 px-6 py-6"
          onClick={() => connectWithProvider(metaMaskProvider.provider)}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <img 
              src={metaMaskProvider.info.icon} 
              alt="MetaMask" 
              className="h-6 w-6"
            />
          )}
          <span className="text-lg">
            {isConnecting ? 'Connecting...' : 'Connect MetaMask'}
          </span>
        </Button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  // If no MetaMask detected, show all available providers or fallback
  if (providers.length > 0) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground mb-2">Select a wallet:</p>
        <div className="flex flex-wrap gap-2 justify-center">
          {providers.map((p) => (
            <Button
              key={p.info.uuid}
              variant="outline"
              className="flex items-center gap-2"
              onClick={() => connectWithProvider(p.provider)}
              disabled={isConnecting}
            >
              <img src={p.info.icon} alt={p.info.name} className="h-5 w-5" />
              {p.info.name}
            </Button>
          ))}
        </div>
        {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      </div>
    );
  }

  // No providers detected - show install MetaMask prompt
  return (
    <div className="flex flex-col items-center gap-3">
      <Button
        size="lg"
        variant="outline"
        className="flex items-center gap-3 px-6 py-6"
        onClick={() => window.open('https://metamask.io/download/', '_blank')}
      >
        <Wallet className="h-6 w-6" />
        <span className="text-lg">Install MetaMask</span>
      </Button>
      <p className="text-sm text-muted-foreground">
        MetaMask not detected. Click to install.
      </p>
    </div>
  );
}
