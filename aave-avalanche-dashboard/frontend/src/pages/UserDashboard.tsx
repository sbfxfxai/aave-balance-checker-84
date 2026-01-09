import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAccount, useBalance, useWalletClient, usePublicClient, useSwitchChain, useReadContract } from 'wagmi';
import { avalanche } from 'wagmi/chains';
import { formatUnits, parseUnits, erc20Abi, maxUint256 } from 'viem';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useToast } from '@/hooks/use-toast';
import { useAaveSupply } from '@/hooks/useAaveSupply';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useGmxPositions } from '@/hooks/useGmxPositions';
import { useMorphoPositions } from '@/hooks/useMorphoPositions';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { CONTRACTS } from '@/config/contracts';
import { 
  Loader2, 
  CheckCircle2, 
  TrendingUp, 
  Shield, 
  Zap,
  Wallet,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  DollarSign,
  Coins,
  PiggyBank,
  Landmark,
  Copy,
  LineChart,
  Building,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowDownUp,
  Send,
  Sparkles,
  ChevronDown,
  Home,
  Bitcoin,
  Mail,
  Check
} from 'lucide-react';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';
import { OptimizedLogo } from '@/components/OptimizedLogo';
import { PrivyLogin } from '@/components/PrivyLogin';
import { Input } from '@/components/ui/input';

// USDC contract on Avalanche
const USDC_ADDRESS = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' as const;
const GMX_AVALANCHE_API = 'https://avalanche-api.gmxinfra.io';
const GMX_AVALANCHE_CHAIN_ID = 43114 as const;

// Risk profile configurations
const RISK_PROFILES = {
  conservative: {
    name: 'Conservative',
    icon: Shield,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    allocation: { aave: 50, gmx: 50 },
    gmxLeverage: 2.5,
    description: '50% AAVE lending, 50% GMX 2.5x long BTC',
  },
  balanced: {
    name: 'Balanced',
    icon: TrendingUp,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    allocation: { aave: 25, gmx: 75 },
    gmxLeverage: 2.5,
    description: '25% AAVE lending, 75% GMX 2.5x long BTC',
  },
  aggressive: {
    name: 'Aggressive',
    icon: Zap,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    allocation: { aave: 0, gmx: 100 },
    gmxLeverage: 5,
    description: '100% GMX 5x long BTC',
  },
};

type RiskProfileKey = keyof typeof RISK_PROFILES;
type DashboardState = 'connecting' | 'waiting_for_funds' | 'executing' | 'completed' | 'error';

interface ExecutionStep {
  id: string;
  name: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  txHash?: string;
  error?: string;
}

interface GmxMarketData {
  btcToken: GmxToken;
  usdcToken: GmxToken;
  market: GmxMarket;
}

 type GmxToken = {
  symbol: string;
  address: string;
  decimals: number;
 };

 type GmxMarket = {
  marketToken: string;
  indexToken: string;
  shortToken: string;
  isListed: boolean;
 };

 type GmxTokensResponse = {
  tokens: GmxToken[];
 };

 type GmxMarketsResponse = {
  markets: GmxMarket[];
 };

export default function UserDashboard() {
  const [searchParams] = useSearchParams();
  const walletAddress = searchParams.get('wallet');
  const riskProfileParam = searchParams.get('risk') as RiskProfileKey | null;
  const amountParam = searchParams.get('amount');

  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { switchChain } = useSwitchChain();
  const { toast } = useToast();
  const { supplyUSDC } = useAaveSupply();

  // Get positions
  const aaveData = useAavePositions();
  const { positions: gmxPositions, isLoading: gmxLoading, refetch: refetchGmx } = useGmxPositions();
  const morphoData = useMorphoPositions();
  const walletBalances = useWalletBalances();

  // Get USDC balance using readContract for ERC20 token
  const { data: usdcBalanceRaw, isLoading: balanceLoading, refetch: refetchBalance } = useReadContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    },
  });
  
  // Convert USDC balance to formatted value (6 decimals for USDC)
  const usdcBalance = usdcBalanceRaw ? {
    value: usdcBalanceRaw,
    decimals: 6,
    formatted: formatUnits(usdcBalanceRaw, 6),
    symbol: 'USDC',
  } : undefined;

  // Get AVAX balance for gas
  const { data: avaxBalance } = useBalance({ address });

  const [dashboardState, setDashboardState] = useState<DashboardState>('connecting');
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [pollingCount, setPollingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const executionStarted = useRef(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const riskProfile = riskProfileParam && RISK_PROFILES[riskProfileParam] ? riskProfileParam : 'balanced';
  const profile = RISK_PROFILES[riskProfile];
  const expectedAmount = amountParam ? parseFloat(amountParam) : 0;

  const usdcBalanceFormatted = usdcBalance 
    ? parseFloat(usdcBalance.formatted)
    : 0;

  const hasAavePosition = parseFloat(aaveData.usdcSupply || '0') > 0 || parseFloat(aaveData.totalCollateral?.replace('$', '') || '0') > 0;
  const hasPositions = hasAavePosition || (gmxPositions && gmxPositions.length > 0);

  // Update step helper
  const updateStep = (stepId: string, updates: Partial<ExecutionStep>) => {
    setExecutionSteps(prev => 
      prev.map(step => step.id === stepId ? { ...step, ...updates } : step)
    );
  };

  // Resolve GMX market data
  const resolveGmxMarket = useCallback(async (): Promise<GmxMarketData> => {
    const [tokensRes, marketsRes] = await Promise.all([
      fetch(`${GMX_AVALANCHE_API}/tokens`),
      fetch(`${GMX_AVALANCHE_API}/markets`),
    ]);

    const tokensJson = (await tokensRes.json()) as GmxTokensResponse;
    const marketsJson = (await marketsRes.json()) as GmxMarketsResponse;

    const btc = tokensJson.tokens?.find((t: GmxToken) => t.symbol === 'BTC');
    const usdc = tokensJson.tokens?.find((t: GmxToken) => t.symbol === 'USDC');
    if (!btc || !usdc) {
      throw new Error('Unable to resolve BTC/USDC tokens from GMX API');
    }

    const btcUsdcMarket = marketsJson.markets?.find(
      (m: GmxMarket) => m.isListed &&
        m.indexToken.toLowerCase() === btc.address.toLowerCase() &&
        m.shortToken.toLowerCase() === usdc.address.toLowerCase()
    );
    if (!btcUsdcMarket) {
      throw new Error('Unable to resolve BTC/USDC market from GMX API');
    }

    return { btcToken: btc, usdcToken: usdc, market: btcUsdcMarket };
  }, []);

  // Execute GMX position
  const executeGmxPosition = useCallback(async (amount: number, leverage: number): Promise<string> => {
    if (!walletClient || !publicClient || !address) {
      throw new Error('Wallet not connected');
    }

    console.log('[GMX] Starting position execution', { amount, leverage });

    // Resolve market
    const marketData = await resolveGmxMarket();
    const payTokenAddress = marketData.usdcToken.address as `0x${string}`;
    const payAmount = parseUnits(amount.toFixed(2), 6);

    // GMX Router address
    const router = '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68' as `0x${string}`;

    // Check and approve USDC
    const allowance = await publicClient.readContract({
      address: payTokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, router],
    }) as bigint;

    if (allowance < payAmount) {
      console.log('[GMX] Approving USDC...');
      const approveTx = await walletClient.writeContract({
        address: payTokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [router, maxUint256],
        chain: avalanche,
        account: address,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
    }

    // Load GMX SDK and execute
    const { GmxSdk } = await import('@gmx-io/sdk');
    const rpcUrl = import.meta.env.VITE_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
    
    const sdk = new GmxSdk({
      chainId: GMX_AVALANCHE_CHAIN_ID,
      rpcUrl,
      oracleUrl: GMX_AVALANCHE_API,
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche:prod/api/graphql',
      walletClient,
    });

    sdk.setAccount(address);

    // Capture tx hash
    let txHash = '';
    const originalCallContract = sdk.callContract.bind(sdk);
    sdk.callContract = async (...args: Parameters<typeof originalCallContract>) => {
      const result = await originalCallContract(...args);
      if (typeof result === 'string' && result.startsWith('0x')) {
        txHash = result;
      }
      return result;
    };

    // Execute long position
    await sdk.orders.long({
      payAmount,
      marketAddress: marketData.market.marketToken as `0x${string}`,
      payTokenAddress,
      collateralTokenAddress: payTokenAddress,
      allowedSlippageBps: 100,
      leverage: BigInt(Math.floor(leverage * 10000)),
      skipSimulation: true,
    });

    return txHash || 'pending';
  }, [address, publicClient, resolveGmxMarket, walletClient]);

  // Execute full strategy
  const executeStrategy = useCallback(async () => {
    if (executionStarted.current) return;
    executionStarted.current = true;

    const totalUsdc = usdcBalanceFormatted;
    const aaveAmount = (totalUsdc * profile.allocation.aave) / 100;
    const gmxAmount = (totalUsdc * profile.allocation.gmx) / 100;

    console.log('[Strategy] Executing', { totalUsdc, aaveAmount, gmxAmount, profile: riskProfile });

    // Initialize steps
    const steps: ExecutionStep[] = [];
    if (aaveAmount > 1) { // TEMPORARY: Set to $1 for testing, will revert to 0.5 after verification
      steps.push({ id: 'aave', name: `Supply $${aaveAmount.toFixed(2)} to AAVE`, status: 'pending' });
    }
    if (gmxAmount > 2) { // GMX minimum
      steps.push({ id: 'gmx', name: `Open GMX ${profile.gmxLeverage}x BTC long with $${gmxAmount.toFixed(2)}`, status: 'pending' });
    }

    if (steps.length === 0) {
      setError('Amount too small to execute strategy');
      setDashboardState('error');
      return;
    }

    setExecutionSteps(steps);
    setDashboardState('executing');

    try {
      // Execute AAVE supply
      if (aaveAmount > 1) { // TEMPORARY: Set to $1 for testing, will revert to 0.5 after verification
        updateStep('aave', { status: 'executing' });
        try {
          await supplyUSDC(aaveAmount.toFixed(2));
          updateStep('aave', { status: 'completed' });
          toast({ title: 'AAVE Supply Complete', description: `Supplied $${aaveAmount.toFixed(2)} USDC` });
          if ('refetch' in aaveData && typeof aaveData.refetch === 'function') await aaveData.refetch();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          updateStep('aave', { status: 'failed', error: msg });
          console.error('[AAVE] Supply failed:', err);
          // Continue to GMX even if AAVE fails
        }
      }

      // Execute GMX position
      if (gmxAmount > 2) {
        updateStep('gmx', { status: 'executing' });
        try {
          const txHash = await executeGmxPosition(gmxAmount, profile.gmxLeverage);
          updateStep('gmx', { status: 'completed', txHash });
          toast({ title: 'GMX Position Opened', description: `${profile.gmxLeverage}x BTC long position created` });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          updateStep('gmx', { status: 'failed', error: msg });
          console.error('[GMX] Position failed:', err);
        }
      }

      // Refresh positions
      await refetchGmx();
      await refetchBalance();
      setDashboardState('completed');
      toast({ title: 'Strategy Executed!', description: 'Your funds have been deployed' });

    } catch (err) {
      console.error('[Strategy] Execution error:', err);
      setError(err instanceof Error ? err.message : 'Strategy execution failed');
      setDashboardState('error');
    }
  }, [usdcBalanceFormatted, profile, riskProfile, supplyUSDC, aaveData, executeGmxPosition, refetchGmx, refetchBalance, toast]);

  // Poll for USDC balance
  useEffect(() => {
    if (!isConnected || !address) {
      setDashboardState('connecting');
      return;
    }

    // Check if already has positions - show completed state
    if (hasPositions && dashboardState !== 'executing') {
      setDashboardState('completed');
      return;
    }

    // If has USDC and not yet executed, start execution
    if (usdcBalanceFormatted > 0.5 && dashboardState === 'waiting_for_funds' && !executionStarted.current) {
      console.log('[Dashboard] USDC detected, starting execution');
      executeStrategy();
      return;
    }

    // If no USDC yet, poll
    if (usdcBalanceFormatted < 0.5 && dashboardState !== 'executing' && !hasPositions) {
      setDashboardState('waiting_for_funds');
      
      // Start polling
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(() => {
          console.log('[Dashboard] Polling for USDC...');
          refetchBalance();
          setPollingCount(c => c + 1);
        }, 10000); // Poll every 10 seconds
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isConnected, address, usdcBalanceFormatted, dashboardState, hasPositions, executeStrategy, refetchBalance]);

  // Switch to Avalanche if needed
  useEffect(() => {
    if (isConnected && chainId !== avalanche.id) {
      switchChain({ chainId: avalanche.id });
    }
  }, [isConnected, chainId, switchChain]);

  const completedSteps = executionSteps.filter(s => s.status === 'completed').length;
  const progress = executionSteps.length > 0 ? (completedSteps / executionSteps.length) * 100 : 0;

  const ProfileIcon = profile.icon;

  // Calculate total savings (AAVE + Morpho)
  const totalSavings = parseFloat(aaveData.usdcSupply || '0') + parseFloat(morphoData.totalUsdValue || '0');
  const totalLoanBalance = parseFloat(aaveData.avaxBorrowed || '0');
  const ergcBalance = parseFloat(walletBalances.ergcBalance || '0');
  const truncatedAddress = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : '';

  return (
    <div className="min-h-screen bg-background">
      {/* Header - matching left image (goal) */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3">
              <OptimizedLogo loading="eager" />
            </div>
            <nav className="flex items-center gap-4 sm:gap-6" aria-label="Main navigation">
              <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
                Banking
              </Link>
              <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
                Savings & Lending
              </Link>
              <Link to="/stack" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
                Start Investing
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <main>
        {/* Connecting State */}
        {dashboardState === 'connecting' && (
          <Card className="text-center py-12">
            <CardContent>
              <Wallet className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-2xl font-bold mb-2">Connect Your Wallet</h2>
              <p className="text-muted-foreground mb-6">
                Import your recovery phrase into Trust Wallet, then connect here
              </p>
              <p className="text-sm text-muted-foreground">
                Use the wallet connect button in the top right
              </p>
            </CardContent>
          </Card>
        )}

        {/* Waiting for Funds State */}
        {dashboardState === 'waiting_for_funds' && (
          <Card className="text-center py-12">
            <CardContent>
              <div className="relative inline-block mb-6">
                <div className="w-24 h-24 rounded-full border-4 border-primary/20 flex items-center justify-center">
                  <Loader2 className="h-12 w-12 text-primary animate-spin" />
                </div>
              </div>
              <h2 className="text-2xl font-bold mb-2">Processing Your Deposit</h2>
              <p className="text-muted-foreground mb-4">
                Waiting for your USDC to arrive...
              </p>
              <div className="max-w-md mx-auto space-y-4">
                <div className="p-4 rounded-lg bg-muted">
                  <div className="flex justify-between text-sm mb-2">
                    <span>Expected Amount:</span>
                    <span className="font-mono">${expectedAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span>Current Balance:</span>
                    <span className="font-mono">${usdcBalanceFormatted.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Strategy:</span>
                    <span className={profile.color}>{profile.name}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Checking every 10 seconds... (Check #{pollingCount})
                </p>
                <Button variant="outline" onClick={() => refetchBalance()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Check Now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Executing State */}
        {dashboardState === 'executing' && (
          <Card className="py-8">
            <CardHeader className="text-center">
              <CardTitle className="flex items-center justify-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin" />
                Executing {profile.name} Strategy
              </CardTitle>
              <CardDescription>{profile.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Progress value={progress} className="mb-6" />
              <div className="space-y-3">
                {executionSteps.map((step) => (
                  <div 
                    key={step.id}
                    className={`flex items-center gap-3 p-4 rounded-lg ${
                      step.status === 'completed' ? 'bg-green-500/10' :
                      step.status === 'executing' ? 'bg-blue-500/10' :
                      step.status === 'failed' ? 'bg-red-500/10' :
                      'bg-muted'
                    }`}
                  >
                    {step.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                    {step.status === 'executing' && <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />}
                    {step.status === 'failed' && <AlertCircle className="h-5 w-5 text-red-500" />}
                    {step.status === 'pending' && <div className="h-5 w-5 rounded-full border-2 border-muted-foreground" />}
                    <span className="flex-1">{step.name}</span>
                    {step.txHash && (
                      <a 
                        href={`https://snowtrace.io/tx/${step.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline text-sm flex items-center gap-1"
                      >
                        View <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {step.error && (
                      <span className="text-xs text-red-500">{step.error.slice(0, 50)}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Completed State - Show Positions - Matching left image (goal) layout */}
        {dashboardState === 'completed' && (
          <>
            {/* Email Signup Section - matching left image */}
            <section className="container mx-auto px-4 py-12">
              <Card className="max-w-2xl mx-auto card-gradient border-border">
                <CardHeader className="text-center">
                  <CardTitle className="text-2xl font-bold text-foreground mb-2">
                    Sign up with email for fully automated crypto investing
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex gap-2">
                    <Input 
                      type="email" 
                      placeholder="Enter your email" 
                      className="flex-1"
                    />
                    <Button className="bg-primary hover:bg-primary/90">
                      Get Started
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 text-sm text-foreground">
                      <Check className="h-4 w-4 text-success" />
                      <span>Automated DeFi strategies</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-foreground">
                      <Check className="h-4 w-4 text-success" />
                      <span>Non-custodial - you own your funds</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-foreground">
                      <Check className="h-4 w-4 text-success" />
                      <span>No wallet setup required</span>
                    </div>
                  </div>
                  <p className="text-xs text-center text-muted-foreground">
                    By signing up, you agree to our{' '}
                    <a href="#" className="text-primary hover:underline">Terms of Service</a>
                    {' '}and{' '}
                    <a href="#" className="text-primary hover:underline">Privacy Policy</a>
                  </p>
                </CardContent>
              </Card>
            </section>

            {/* Your Account Section - matching left image */}
            <div className="border-t border-border">
              <h2 className="container pt-12 text-2xl font-bold text-foreground">Your Account</h2>
              <section className="py-12">
                <div className="container">
                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                    {/* External Wallet */}
                    <Card className="card-gradient border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          External Wallet
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-foreground">{truncatedAddress}</span>
                          <button
                            onClick={() => {
                              if (address) {
                                navigator.clipboard.writeText(address);
                                toast({ title: 'Copied!', description: 'Address copied to clipboard' });
                              }
                            }}
                            className="cursor-pointer hover:text-primary transition-colors p-1"
                            aria-label="Copy address"
                          >
                            <Copy className="h-3 w-3 text-muted-foreground" />
                          </button>
                          <a 
                            href={`https://snowtrace.io/address/${address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cursor-pointer hover:text-primary transition-colors p-1"
                            aria-label="View on explorer"
                          >
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </a>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Available Cash */}
                    <Card className="card-gradient border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          Available Cash
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs text-muted-foreground">AVAX</span>
                            <span className="text-2xl font-bold text-foreground">
                              {avaxBalance ? parseFloat(formatUnits(avaxBalance.value, 18)).toFixed(4) : '0.0100'}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">For network fees</p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* USD Balance */}
                    <Card className="card-gradient border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          $ USD Balance
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1">
                          <span className="text-2xl font-bold text-foreground">${usdcBalanceFormatted.toFixed(2)}</span>
                          <p className="text-xs text-muted-foreground">Ready to invest</p>
                        </div>
                      </CardContent>
                    </Card>

                    {/* ERGC */}
                    <Card className="card-gradient border-border">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">
                          ERGC
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1">
                          <span className="text-2xl font-bold text-foreground">{ergcBalance.toFixed(2)}</span>
                          <p className="text-xs text-muted-foreground">EnergyCoin tokens</p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </section>
            </div>

            {/* Your Earnings Section - matching reference */}
            <section className="py-12">
              <div className="container">
                <h2 className="text-2xl font-bold text-foreground mb-6">Your Earnings</h2>
                
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {/* Savings Balance */}
                  <Card className="card-gradient border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <LineChart className="h-4 w-4" />
                        Savings Balance
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <span className="text-3xl font-bold text-foreground">${totalSavings.toFixed(2)}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-success">
                            Earning {aaveData.usdcSupplyApy?.toFixed(2) || '3.40'}% APY
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Loan Balance */}
                  <Card className="card-gradient border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Building className="h-4 w-4" />
                        Loan Balance
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <span className="text-3xl font-bold text-foreground">{totalLoanBalance.toFixed(4)}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-warning">
                            Pay {aaveData.avaxBorrowApy?.toFixed(2) || '3.63'}% APY
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* GMX Positions */}
                  <Card className="card-gradient border-border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">
                        GMX Positions
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {gmxLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : gmxPositions && gmxPositions.length > 0 ? (
                          <div className="space-y-2">
                            {gmxPositions.map((pos, i: number) => (
                              <div key={i} className="text-sm">
                                <p className="font-medium text-foreground">
                                  {pos.marketInfo?.name || 'Market'} {pos.isLong ? 'Long' : 'Short'}
                                </p>
                                <p className="text-muted-foreground">
                                  ${parseFloat(pos.sizeInUsd || '0').toFixed(2)} @ {pos.leverage?.toFixed(1) || '2.5'}x
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">No open GMX positions</p>
                        )}
                        <Link to="/gmx">
                          <Button variant="action" size="sm" className="w-full bg-primary hover:bg-primary/90">
                            Open a Position
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </section>

            {/* Quick Actions Section - matching reference */}
            <section className="py-12 border-t border-border">
              <div className="container">
                <h2 className="text-2xl font-bold text-foreground mb-6">Quick Actions</h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <Button
                    variant="outline"
                    className="h-auto py-4 px-6 flex flex-col items-center gap-2 bg-card border-border hover:bg-muted"
                  >
                    <ArrowDownLeft className="h-5 w-5 text-foreground" />
                    <span className="text-sm font-medium text-foreground">Deposit</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-4 px-6 flex flex-col items-center gap-2 bg-card border-border hover:bg-muted"
                  >
                    <ArrowUpRight className="h-5 w-5 text-foreground" />
                    <span className="text-sm font-medium text-foreground">Withdraw</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-4 px-6 flex flex-col items-center gap-2 bg-card border-border hover:bg-muted"
                  >
                    <ArrowDownUp className="h-5 w-5 text-foreground" />
                    <span className="text-sm font-medium text-foreground">Swap</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="h-auto py-4 px-6 flex flex-col items-center gap-2 bg-card border-border hover:bg-muted"
                  >
                    <Send className="h-5 w-5 text-foreground" />
                    <span className="text-sm font-medium text-foreground">Send</span>
                  </Button>
                </div>
              </div>
            </section>

            {/* FAQ Section - matching reference */}
            <section className="py-12 border-t border-border">
              <div className="container">
                <h2 className="text-2xl font-bold text-foreground mb-6">Frequently Asked Questions</h2>
                <Accordion type="single" defaultValue="ergc" collapsible className="w-full max-w-4xl mx-auto">
                  <AccordionItem value="ergc" className="border-border">
                    <AccordionTrigger className="text-left hover:no-underline">
                      <div className="flex items-center gap-3">
                        <Sparkles className="h-5 w-5 text-primary flex-shrink-0" />
                        <span className="text-foreground">Get ERGC on Uniswap (AVAX → ERGC)</span>
                        <a
                          href="https://app.uniswap.org/explore/pools/avalanche/0x3c83d0058e9d1652534be264dba75cfcc2e1d48a3ff1d2c3611a194a361a16ee"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="ml-auto mr-2 hover:text-primary transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-4">
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium">Fee Discount:</span> Holding 100+ ERGC = <span className="font-bold text-primary">56% discount</span> on TiltVault platform fees
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="how-it-works" className="border-border">
                    <AccordionTrigger className="text-left hover:no-underline">
                      How does TiltVault work?
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-4 text-sm text-muted-foreground">
                      <p>
                        TiltVault is a non-custodial DeFi protocol aggregator that provides a user interface for interacting with established, audited blockchain protocols on the Avalanche network. Users maintain control of their private keys and funds at all times.
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="safety" className="border-border">
                    <AccordionTrigger className="text-left hover:no-underline">
                      Is my money safe?
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pb-4 text-sm text-muted-foreground">
                      <p>
                        TiltVault is completely non-custodial. Users maintain control of private keys and funds at all times. We integrate with audited protocols like Aave and GMX, which have billions in total value locked. However, DeFi involves risks including smart contract risks, and funds are not FDIC insured.
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </section>
          </>
        )}

        {/* Error State */}
        {dashboardState === 'error' && (
          <Card className="text-center py-12 border-red-500/20">
            <CardContent>
              <AlertCircle className="h-16 w-16 mx-auto mb-4 text-red-500" />
              <h2 className="text-2xl font-bold mb-2">Something Went Wrong</h2>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => window.location.reload()}>
                Try Again
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="mt-8 flex justify-center gap-4">
          <Link to="/stack">
            <Button variant="outline">Make Another Deposit</Button>
          </Link>
          <Link to="/gmx">
            <Button variant="outline">Manage GMX</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
