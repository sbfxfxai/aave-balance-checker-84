import { useState, useEffect, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Wallet, LogOut, Loader2, Coins, DollarSign, Mail, ChevronRight, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useUsdcApy } from '@/hooks/useUsdcApy';

// API base URL
const API_BASE = import.meta.env.VITE_API_URL || '';

// Link email to wallet in backend
async function linkEmailToWallet(email: string, walletAddress: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/accounts/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, walletAddress }),
    });
    return res.ok;
  } catch (error) {
    console.error('[Account Link] Failed to link:', error);
    return false;
  }
}

// Lookup wallet by email
async function getWalletByEmail(email: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/accounts/link?email=${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.walletAddress || null;
  } catch (error) {
    console.error('[Account Link] Lookup failed:', error);
    return null;
  }
}

// Lookup email by wallet
async function getEmailByWallet(wallet: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/accounts/link?wallet=${encodeURIComponent(wallet)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.email || null;
  } catch (error) {
    console.error('[Account Link] Lookup failed:', error);
    return null;
  }
}

export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingMethod, setConnectingMethod] = useState<string | null>(null);
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const { avaxBalance, usdcBalance, isLoading, avaxSymbol, usdcSymbol } = useWalletBalances();
  const { displayApy } = useUsdcApy();

  // Fetch linked email when wallet connects, or link if new
  const syncEmailWalletLink = useCallback(async (walletAddress: string) => {
    const existingEmail = await getEmailByWallet(walletAddress);
    if (existingEmail) {
      setLinkedEmail(existingEmail);
      localStorage.setItem('tiltvault_email', existingEmail);
    }
  }, []);

  // Auto-sync email when wallet connects
  useEffect(() => {
    if (isConnected && address) {
      syncEmailWalletLink(address);
    } else {
      setLinkedEmail(null);
    }
  }, [isConnected, address, syncEmailWalletLink]);

  // Check for saved email on mount
  useEffect(() => {
    const savedEmail = localStorage.getItem('tiltvault_email');
    if (savedEmail) {
      setLinkedEmail(savedEmail);
    }
  }, []);

  const handleEmailLogin = async () => {
    // Prevent duplicate connection requests
    if (isConnecting || isConnected) return;
    
    // Use MetaMask Email for seamless login
    setIsConnecting(true);
    setConnectingMethod('email');
    try {
      const connector = connectors.find(c => c.id === 'injected');
      if (connector) {
        await connect({ connector });
        toast.success('Logged in successfully!', {
          description: 'Welcome to TiltVault'
        });
      } else {
        toast.error('MetaMask not available', {
          description: 'Please install MetaMask extension'
        });
      }
    } catch (error) {
      console.error('Login error:', error);
      toast.error('Failed to connect');
    } finally {
      setIsConnecting(false);
      setConnectingMethod(null);
    }
  };

  const handleConnect = async (connectorId: 'injected' | 'walletConnect' = 'injected') => {
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
        toast.error(`${connectorId === 'injected' ? 'MetaMask' : 'WalletConnect'} not available`);
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
    localStorage.removeItem('tiltvault_email');
    toast.info('Wallet disconnected');
  };

  // Handle email-only login for returning users (seamless, no MetaMask prompt)
  const handleEmailLookup = async () => {
    if (!emailInput.trim()) {
      toast.error('Please enter your email address');
      return;
    }

    setIsLookingUp(true);
    try {
      const linkedWallet = await getWalletByEmail(emailInput.trim());
      
      if (linkedWallet) {
        // Store email - seamless login without MetaMask prompt
        localStorage.setItem('tiltvault_email', emailInput.trim().toLowerCase());
        localStorage.setItem('tiltvault_wallet', linkedWallet);
        setLinkedEmail(emailInput.trim().toLowerCase());
        setShowEmailInput(false);
        toast.success('Welcome back!', {
          description: 'You are now logged in'
        });
        // Reload to show dashboard with email-based access
        window.location.reload();
      } else {
        // New user - create account with email (no MetaMask needed)
        toast.info('Creating your account...', {
          description: 'Setting up your TiltVault account'
        });
        // For new users, we'll create a custodial wallet on the backend
        const response = await fetch(`${API_BASE}/api/accounts/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailInput.trim().toLowerCase() }),
        });
        
        if (response.ok) {
          const data = await response.json();
          localStorage.setItem('tiltvault_email', emailInput.trim().toLowerCase());
          if (data.walletAddress) {
            localStorage.setItem('tiltvault_wallet', data.walletAddress);
          }
          setLinkedEmail(emailInput.trim().toLowerCase());
          setShowEmailInput(false);
          toast.success('Account created!', {
            description: 'Welcome to TiltVault'
          });
          window.location.reload();
        } else {
          toast.error('Failed to create account', {
            description: 'Please try again or contact support'
          });
        }
      }
    } catch (error) {
      console.error('Email lookup error:', error);
      toast.error('Failed to process request');
    } finally {
      setIsLookingUp(false);
    }
  };

  if (isConnected && address) {
    return (
      <Card className="p-6 bg-card shadow-card hover:shadow-card-hover transition-all duration-300">
        <div className="space-y-4">
          {/* Linked Email */}
          {linkedEmail && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Mail className="h-5 w-5 text-emerald-500" />
              <div className="flex-1">
                <p className="text-xs font-medium text-muted-foreground">TiltVault Account</p>
                <p className="text-sm font-semibold text-emerald-600">{linkedEmail}</p>
              </div>
              <span className="text-xs bg-emerald-500/20 text-emerald-600 px-2 py-1 rounded-full">Linked</span>
            </div>
          )}

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
                    `${avaxBalance ? parseFloat(avaxBalance).toFixed(4) : '0.0000'} ${avaxSymbol}`
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

  // Show email input for returning users
  if (showEmailInput) {
    return (
      <Card className="p-6 bg-card shadow-card hover:shadow-card-hover transition-all duration-300 animate-slide-up">
        <div className="flex flex-col items-center text-center space-y-5">
          <div className="p-4 rounded-full bg-gradient-primary">
            <Mail className="h-8 w-8 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-semibold mb-2">Welcome Back</h3>
            <p className="text-sm text-muted-foreground">
              Enter your email to access your dashboard
            </p>
          </div>

          <div className="w-full space-y-3">
            <Input
              type="email"
              placeholder="your@email.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEmailLookup()}
              className="w-full text-center"
            />
            <Button
              onClick={handleEmailLookup}
              disabled={isLookingUp}
              className="w-full bg-gradient-to-r from-blue-700 to-emerald-500 hover:from-blue-800 hover:to-emerald-600 text-white shadow-lg"
              size="lg"
            >
              {isLookingUp ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Looking up...
                </>
              ) : (
                <>
                  Access Dashboard
                  <ArrowRight className="ml-2 h-5 w-5" />
                </>
              )}
            </Button>
            <Button
              onClick={() => setShowEmailInput(false)}
              variant="ghost"
              className="w-full text-muted-foreground"
              size="sm"
            >
              Back to login options
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 bg-card shadow-card hover:shadow-card-hover transition-all duration-300 animate-slide-up">
      <div className="flex flex-col items-center text-center space-y-5">
        <div className="p-4 rounded-full bg-gradient-primary">
          <Mail className="h-8 w-8 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold mb-1">Banking that works as hard as you do</h1>
          <p className="text-sm text-muted-foreground">
            Earn <span className="font-semibold text-emerald-500">{displayApy}% APY</span> on savings. Optional managed Bitcoin exposure. Built on Aave—$70B+ secured.
          </p>
        </div>

        <div className="w-full space-y-3">
          {/* Primary: MetaMask Email Login */}
          <Button
            onClick={handleEmailLogin}
            disabled={isConnecting}
            className="w-full bg-gradient-to-r from-blue-700 to-emerald-500 hover:from-blue-800 hover:to-emerald-600 text-white shadow-lg"
            size="lg"
          >
            {isConnecting && connectingMethod === 'email' ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Signing in...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-5 w-5" />
                Get Started
                <ChevronRight className="ml-auto h-5 w-5" />
              </>
            )}
          </Button>

          {/* Returning user: Email login */}
          <Button
            onClick={() => setShowEmailInput(true)}
            variant="outline"
            className="w-full border-dashed"
            size="lg"
          >
            <Mail className="mr-2 h-4 w-4" />
            Sign in with email
          </Button>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border/50" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or connect wallet</span>
            </div>
          </div>

          {/* Secondary: Direct MetaMask */}
          <Button
            onClick={() => handleConnect('injected')}
            disabled={isConnecting}
            variant="outline"
            className="w-full"
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
                MetaMask
              </>
            )}
          </Button>

          {/* Tertiary: WalletConnect */}
          <Button
            onClick={() => handleConnect('walletConnect')}
            disabled={isConnecting}
            variant="ghost"
            className="w-full text-muted-foreground hover:text-foreground"
            size="sm"
          >
            {isConnecting && connectingMethod === 'walletConnect' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Wallet className="mr-2 h-4 w-4" />
                WalletConnect
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
