import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAccount, useBalance, useWalletClient, usePublicClient, useSwitchChain } from 'wagmi';
import { avalanche } from 'wagmi/chains';
import { formatUnits, parseUnits, erc20Abi, maxUint256 } from 'viem';
import { CONTRACTS as GMX_SDK_CONTRACTS } from '@gmx-io/sdk/configs/contracts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useAaveSupply } from '@/hooks/useAaveSupply';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useGmxPositions } from '@/hooks/useGmxPositions';
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
  AlertCircle
} from 'lucide-react';

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

  // Get USDC balance
  const { data: usdcBalance, isLoading: balanceLoading, refetch: refetchBalance } = useBalance({
    address: address,
    token: USDC_ADDRESS,
  });

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
    ? parseFloat(formatUnits(usdcBalance.value, usdcBalance.decimals))
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
                  TiltVault
                </h1>
                <p className="text-sm text-muted-foreground">Your Portfolio Dashboard</p>
              </div>
            </div>
            {isConnected && (
              <div className="flex items-center gap-2">
                <div className={`px-3 py-1 rounded-full text-sm ${profile.bgColor} ${profile.color}`}>
                  <ProfileIcon className="h-4 w-4 inline mr-1" />
                  {profile.name}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
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

        {/* Completed State - Show Positions */}
        {dashboardState === 'completed' && (
          <>
            {/* Summary Card */}
            <Card className="mb-6 border-green-500/20 bg-green-500/5">
              <CardContent className="pt-6">
                <div className="flex items-center gap-4">
                  <CheckCircle2 className="h-12 w-12 text-green-500" />
                  <div>
                    <h2 className="text-xl font-bold">Strategy Active</h2>
                    <p className="text-muted-foreground">{profile.name} - {profile.description}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* AAVE Positions */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-500" />
                  AAVE Positions
                </CardTitle>
              </CardHeader>
              <CardContent>
                {aaveData.isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : hasAavePosition ? (
                  <div className="space-y-3">
                    {parseFloat(aaveData.usdcSupply || '0') > 0 && (
                      <div className="p-4 rounded-lg bg-muted flex justify-between items-center">
                        <div>
                          <p className="font-medium">USDC Supply</p>
                          <p className="text-sm text-muted-foreground">Earning yield</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono">${parseFloat(aaveData.usdcSupply || '0').toFixed(2)}</p>
                          <p className="text-sm text-green-500">+{aaveData.usdcSupplyApy?.toFixed(2) || '3.2'}% APY</p>
                        </div>
                      </div>
                    )}
                    {parseFloat(aaveData.avaxSupply || '0') > 0 && (
                      <div className="p-4 rounded-lg bg-muted flex justify-between items-center">
                        <div>
                          <p className="font-medium">AVAX Supply</p>
                          <p className="text-sm text-muted-foreground">Earning yield</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono">{parseFloat(aaveData.avaxSupply || '0').toFixed(4)} AVAX</p>
                          <p className="text-sm text-green-500">+{aaveData.avaxSupplyApy?.toFixed(2) || '2.5'}% APY</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No AAVE positions</p>
                )}
              </CardContent>
            </Card>

            {/* GMX Positions */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-purple-500" />
                  GMX Positions
                </CardTitle>
              </CardHeader>
              <CardContent>
                {gmxLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : gmxPositions && gmxPositions.length > 0 ? (
                  <div className="space-y-3">
                    {gmxPositions.map((pos, i: number) => (
                      <div key={i} className="p-4 rounded-lg bg-muted">
                        <div className="flex justify-between items-center mb-2">
                          <span className="font-medium">
                            {pos.marketInfo?.name || 'Market'} {pos.isLong ? 'Long' : 'Short'}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            Entry ${parseFloat(pos.entryPrice || '0').toFixed(2)}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Size</p>
                            <p className="font-mono">${parseFloat(pos.sizeInUsd || '0').toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Collateral</p>
                            <p className="font-mono">${parseFloat(pos.collateralAmount || '0').toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Leverage</p>
                            <p className="font-mono">{pos.leverage?.toFixed(1) || '2.5'}x</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">No GMX positions</p>
                )}
              </CardContent>
            </Card>

            {/* Wallet Balance */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5" />
                  Wallet Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-muted">
                    <p className="text-sm text-muted-foreground">USDC</p>
                    <p className="text-xl font-mono">${usdcBalanceFormatted.toFixed(2)}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-muted">
                    <p className="text-sm text-muted-foreground">AVAX (for gas)</p>
                    <p className="text-xl font-mono">
                      {avaxBalance ? parseFloat(formatUnits(avaxBalance.value, 18)).toFixed(4) : '0.0000'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
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
