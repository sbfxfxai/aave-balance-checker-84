import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  TrendingUp, 
  Shield, 
  Zap, 
  Loader2, 
  CheckCircle2, 
  Clock,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Mail,
  Wallet,
  Link2,
  LogOut
} from 'lucide-react';

// MetaMask ethereum provider type
type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
};

const getEthereum = (): EthereumProvider | undefined => {
  return (window as { ethereum?: EthereumProvider }).ethereum;
};

interface Position {
  id: string;
  paymentId: string;
  userEmail: string;
  strategyType: 'conservative' | 'balanced' | 'aggressive';
  usdcAmount: number;
  status: 'pending' | 'executing' | 'active' | 'closed' | 'failed';
  aaveSupplyAmount?: number;
  aaveSupplyTxHash?: string;
  gmxCollateralAmount?: number;
  gmxPositionSize?: number;
  gmxLeverage?: number;
  gmxEntryPrice?: number;
  gmxOrderTxHash?: string;
  createdAt: string;
  executedAt?: string;
  error?: string;
}

const STRATEGY_CONFIG = {
  conservative: { name: 'Conservative', icon: Shield, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  balanced: { name: 'Balanced', icon: TrendingUp, color: 'text-purple-500', bgColor: 'bg-purple-500/10' },
  aggressive: { name: 'Aggressive', icon: Zap, color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
};

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string; animate?: boolean }> = {
  pending: { icon: Clock, color: 'text-yellow-500', label: 'Pending' },
  executing: { icon: Loader2, color: 'text-blue-500', label: 'Executing', animate: true },
  active: { icon: CheckCircle2, color: 'text-green-500', label: 'Active' },
  closed: { icon: CheckCircle2, color: 'text-gray-500', label: 'Closed' },
  failed: { icon: AlertCircle, color: 'text-red-500', label: 'Failed' },
};

export default function PositionsDashboard() {
  const [searchParams] = useSearchParams();
  const emailParam = searchParams.get('email');
  const walletParam = searchParams.get('wallet');
  
  const [searchValue, setSearchValue] = useState(emailParam || walletParam || '');
  const [positions, setPositions] = useState<Position[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  
  // MetaMask integration state
  const [connectedWallet, setConnectedWallet] = useState<string | null>(null);
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [emailToLink, setEmailToLink] = useState('');

  // Check for saved session on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('tiltvault_email');
    const savedWallet = localStorage.getItem('tiltvault_wallet');
    
    if (savedEmail) {
      setLinkedEmail(savedEmail);
      setSearchValue(savedEmail);
      fetchPositions(savedEmail);
    }
    if (savedWallet) {
      setConnectedWallet(savedWallet);
    }
  }, []);

  // Connect MetaMask wallet
  const connectMetaMask = async () => {
    const ethereum = getEthereum();
    if (!ethereum) {
      setError('MetaMask not installed. Please install MetaMask to continue.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      if (accounts && accounts.length > 0) {
        const wallet = accounts[0];
        setConnectedWallet(wallet);
        localStorage.setItem('tiltvault_wallet', wallet);

        // Check if wallet is already linked to an email
        const linkResponse = await fetch(`/api/accounts/link?wallet=${wallet}`);
        const linkData = await linkResponse.json();
        
        if (linkData.email) {
          // Wallet already linked - auto-login
          setLinkedEmail(linkData.email);
          setSearchValue(linkData.email);
          localStorage.setItem('tiltvault_email', linkData.email);
          await fetchPositions(linkData.email);
        } else {
          // Wallet not linked - show link form
          setShowLinkForm(true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect MetaMask');
    } finally {
      setIsConnecting(false);
    }
  };

  // Link wallet to email
  const linkWalletToEmail = async () => {
    if (!connectedWallet || !emailToLink) return;

    setIsLoading(true);
    try {
      const response = await fetch('/api/accounts/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToLink, walletAddress: connectedWallet }),
      });
      const data = await response.json();

      if (data.success) {
        setLinkedEmail(emailToLink);
        setSearchValue(emailToLink);
        localStorage.setItem('tiltvault_email', emailToLink);
        setShowLinkForm(false);
        await fetchPositions(emailToLink);
      } else {
        setError(data.error || 'Failed to link wallet');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link wallet');
    } finally {
      setIsLoading(false);
    }
  };

  // Disconnect/logout
  const disconnect = () => {
    setConnectedWallet(null);
    setLinkedEmail(null);
    setPositions([]);
    setHasSearched(false);
    setSearchValue('');
    setShowLinkForm(false);
    localStorage.removeItem('tiltvault_email');
    localStorage.removeItem('tiltvault_wallet');
  };

  const fetchPositions = async (value: string) => {
    if (!value) return;
    
    setIsLoading(true);
    setError(null);
    setHasSearched(true);
    
    try {
      // Determine if value is email or wallet address
      const isWallet = value.startsWith('0x');
      const param = isWallet ? `wallet=${value}` : `email=${encodeURIComponent(value)}`;
      
      const response = await fetch(`/api/positions?${param}`);
      const data = await response.json();
      
      if (data.success) {
        setPositions(data.positions || []);
      } else {
        setError(data.error || 'Failed to fetch positions');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch positions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (emailParam) {
      fetchPositions(emailParam);
    } else if (walletParam) {
      fetchPositions(walletParam);
    }
  }, [emailParam, walletParam]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchPositions(searchValue);
  };

  const totalValue = positions.reduce((sum, p) => sum + p.usdcAmount, 0);
  const activePositions = positions.filter(p => p.status === 'active');

  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-primary">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                TiltVault
              </h1>
              <p className="text-sm text-muted-foreground">Your Positions</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Connected Wallet Status */}
        {connectedWallet && linkedEmail && (
          <Card className="mb-6 border-green-500/30 bg-green-500/5">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-green-500/20">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400">Connected</p>
                    <p className="text-sm text-muted-foreground">{linkedEmail}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {connectedWallet.slice(0, 6)}...{connectedWallet.slice(-4)}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={disconnect}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Login Options - Show when not logged in */}
        {!linkedEmail && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                Access Your Positions
              </CardTitle>
              <CardDescription>
                Connect your wallet or enter your email to view positions
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* MetaMask Connect Button */}
              {!connectedWallet && (
                <Button 
                  onClick={connectMetaMask} 
                  disabled={isConnecting}
                  className="w-full bg-orange-500 hover:bg-orange-600"
                  size="lg"
                >
                  {isConnecting ? (
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  ) : (
                    <Wallet className="h-5 w-5 mr-2" />
                  )}
                  Continue with MetaMask
                </Button>
              )}

              {/* Link Wallet Form - Show after connecting */}
              {showLinkForm && connectedWallet && (
                <div className="p-4 rounded-lg border bg-muted/50 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Link2 className="h-4 w-4 text-green-500" />
                    <span>Wallet connected: </span>
                    <code className="text-xs bg-background px-2 py-1 rounded">
                      {connectedWallet.slice(0, 6)}...{connectedWallet.slice(-4)}
                    </code>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Enter your email to link this wallet and easily access your positions:
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      value={emailToLink}
                      onChange={(e) => setEmailToLink(e.target.value)}
                      className="flex-1"
                    />
                    <Button onClick={linkWalletToEmail} disabled={isLoading || !emailToLink}>
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Divider */}
              {!showLinkForm && (
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">Or</span>
                  </div>
                </div>
              )}

              {/* Email Search */}
              {!showLinkForm && (
                <form onSubmit={handleSubmit} className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Email or Wallet Address (0x...)"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    className="flex-1"
                  />
                  <Button type="submit" variant="outline" disabled={isLoading || !searchValue}>
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4 mr-2" />
                    )}
                    {isLoading ? '' : 'Search'}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <Card className="mb-6 border-red-500/20 bg-red-500/5">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 text-red-500">
                <AlertCircle className="h-5 w-5" />
                <span>{error}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary */}
        {hasSearched && !isLoading && positions.length > 0 && (
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-sm text-muted-foreground">Total Deposited</p>
                  <p className="text-2xl font-bold">${totalValue.toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Active Positions</p>
                  <p className="text-2xl font-bold">{activePositions.length}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Positions</p>
                  <p className="text-2xl font-bold">{positions.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Positions List */}
        {hasSearched && !isLoading && (
          <>
            {positions.length === 0 ? (
              <Card className="text-center py-12">
                <CardContent>
                  <p className="text-muted-foreground">No positions found for this email</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Make a deposit on the Stack page to create your first position
                  </p>
                  <a href="/stack" className="inline-block mt-4">
                    <Button>Go to Stack</Button>
                  </a>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {positions.map((position) => {
                  const strategy = STRATEGY_CONFIG[position.strategyType];
                  const statusConfig = STATUS_CONFIG[position.status];
                  const StrategyIcon = strategy.icon;
                  const StatusIcon = statusConfig.icon;

                  return (
                    <Card key={position.id}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`p-2 rounded-lg ${strategy.bgColor}`}>
                              <StrategyIcon className={`h-5 w-5 ${strategy.color}`} />
                            </div>
                            <div>
                              <CardTitle className="text-lg">{strategy.name} Strategy</CardTitle>
                              <CardDescription>${position.usdcAmount.toFixed(2)} USDC</CardDescription>
                            </div>
                          </div>
                          <div className={`flex items-center gap-1 ${statusConfig.color}`}>
                            <StatusIcon className={`h-4 w-4 ${statusConfig.animate ? 'animate-spin' : ''}`} />
                            <span className="text-sm font-medium">{statusConfig.label}</span>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          {/* AAVE Position */}
                          {position.aaveSupplyAmount && position.aaveSupplyAmount > 0 && (
                            <div className="p-3 rounded-lg bg-muted">
                              <p className="text-muted-foreground">AAVE Supply</p>
                              <p className="font-mono font-medium">${position.aaveSupplyAmount.toFixed(2)}</p>
                              {position.aaveSupplyTxHash && (
                                <a
                                  href={`https://snowtrace.io/tx/${position.aaveSupplyTxHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-1"
                                >
                                  View tx <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          )}

                          {/* GMX Position */}
                          {position.gmxCollateralAmount && position.gmxCollateralAmount > 0 && (
                            <div className="p-3 rounded-lg bg-muted">
                              <p className="text-muted-foreground">GMX Position</p>
                              <p className="font-mono font-medium">
                                ${position.gmxPositionSize?.toFixed(2)} ({position.gmxLeverage}x)
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Collateral: ${position.gmxCollateralAmount.toFixed(2)}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Error */}
                        {position.error && (
                          <div className="mt-3 p-2 rounded bg-red-500/10 text-red-500 text-sm">
                            {position.error}
                          </div>
                        )}

                        {/* Timestamps */}
                        <div className="mt-3 text-xs text-muted-foreground">
                          Created: {new Date(position.createdAt).toLocaleString()}
                          {position.executedAt && (
                            <span className="ml-4">
                              Executed: {new Date(position.executedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Loading */}
        {isLoading && (
          <Card className="text-center py-12">
            <CardContent>
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Loading positions...</p>
            </CardContent>
          </Card>
        )}

        {/* Refresh Button */}
        {hasSearched && positions.length > 0 && (
          <div className="mt-6 text-center">
            <Button variant="outline" onClick={() => fetchPositions(searchValue)}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex justify-center gap-4">
          <a href="/stack">
            <Button variant="outline">Make a Deposit</Button>
          </a>
        </div>
      </main>
    </div>
  );
}
