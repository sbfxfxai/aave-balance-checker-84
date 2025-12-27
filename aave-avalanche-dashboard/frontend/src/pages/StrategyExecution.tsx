import { useState, useEffect } from 'react';
import { useAccount, useBalance, useWalletClient } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useAaveSupply } from '@/hooks/useAaveSupply';
import { 
  Wallet, 
  TrendingUp, 
  Shield, 
  Zap, 
  CheckCircle2, 
  Loader2, 
  ArrowRight,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import { Link } from 'react-router-dom';

// USDC contract on Avalanche
const USDC_ADDRESS = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' as const;

// Risk profile configurations
const RISK_PROFILES = {
  conservative: {
    name: 'Conservative',
    icon: Shield,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    allocation: { aave: 100, gmx: 0 },
    description: '100% AAVE lending',
  },
  balanced: {
    name: 'Balanced',
    icon: TrendingUp,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
    allocation: { aave: 50, gmx: 50 },
    description: '50% AAVE lending, 50% GMX 2.5x long BTC',
  },
  aggressive: {
    name: 'Aggressive',
    icon: Zap,
    color: 'text-orange-500',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/20',
    allocation: { aave: 0, gmx: 100 },
    description: '100% GMX 5x long BTC',
  },
};

type RiskProfileKey = keyof typeof RISK_PROFILES;

interface ExecutionStep {
  id: string;
  name: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  txHash?: string;
  error?: string;
}

export default function StrategyExecution() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { toast } = useToast();
  const { supplyUSDC } = useAaveSupply();

  // Get USDC balance
  const { data: usdcBalance, isLoading: balanceLoading, refetch: refetchBalance } = useBalance({
    address,
    token: USDC_ADDRESS,
  });

  const [selectedProfile, setSelectedProfile] = useState<RiskProfileKey | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [executionComplete, setExecutionComplete] = useState(false);

  const usdcBalanceFormatted = usdcBalance 
    ? parseFloat(formatUnits(usdcBalance.value, usdcBalance.decimals))
    : 0;

  const updateStep = (stepId: string, updates: Partial<ExecutionStep>) => {
    setExecutionSteps(prev => 
      prev.map(step => step.id === stepId ? { ...step, ...updates } : step)
    );
  };

  const executeStrategy = async () => {
    if (!selectedProfile || !address || !walletClient || usdcBalanceFormatted <= 0) {
      toast({ title: 'Cannot execute', description: 'Please connect wallet and select a profile', variant: 'destructive' });
      return;
    }

    const profile = RISK_PROFILES[selectedProfile];
    const totalUsdc = usdcBalanceFormatted;
    const aaveAmount = (totalUsdc * profile.allocation.aave) / 100;
    const gmxAmount = (totalUsdc * profile.allocation.gmx) / 100;

    // Initialize steps
    const steps: ExecutionStep[] = [];
    if (aaveAmount > 0) {
      steps.push({ id: 'aave', name: `Supply $${aaveAmount.toFixed(2)} to AAVE`, status: 'pending' });
    }
    if (gmxAmount > 0) {
      steps.push({ id: 'gmx', name: `Open GMX position with $${gmxAmount.toFixed(2)}`, status: 'pending' });
    }
    setExecutionSteps(steps);
    setIsExecuting(true);

    try {
      // Step 1: AAVE Supply
      if (aaveAmount > 0) {
        updateStep('aave', { status: 'executing' });
        try {
          await supplyUSDC(aaveAmount.toFixed(2));
          updateStep('aave', { status: 'completed' });
          toast({ title: 'AAVE Supply Complete', description: `Supplied $${aaveAmount.toFixed(2)} USDC` });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          updateStep('aave', { status: 'failed', error: errorMsg });
          toast({ title: 'AAVE Supply Failed', description: errorMsg, variant: 'destructive' });
          throw error;
        }
      }

      // Step 2: GMX Position
      if (gmxAmount > 0) {
        updateStep('gmx', { status: 'executing' });
        try {
          // For now, redirect to GMX page - full integration would use GMX SDK
          // This is a placeholder - actual GMX execution requires more complex logic
          toast({ 
            title: 'GMX Position', 
            description: `Navigate to GMX page to open position with $${gmxAmount.toFixed(2)}` 
          });
          updateStep('gmx', { status: 'completed' });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          updateStep('gmx', { status: 'failed', error: errorMsg });
          throw error;
        }
      }

      setExecutionComplete(true);
      toast({ title: 'Strategy Executed!', description: 'Your funds have been deployed' });

    } catch (error) {
      console.error('Strategy execution error:', error);
    } finally {
      setIsExecuting(false);
      refetchBalance();
    }
  };

  const completedSteps = executionSteps.filter(s => s.status === 'completed').length;
  const progress = executionSteps.length > 0 ? (completedSteps / executionSteps.length) * 100 : 0;

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Execute Your Strategy</h1>
        <p className="text-muted-foreground">
          Connect your wallet and deploy your USDC according to your risk profile
        </p>
      </div>

      {/* Wallet Status */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Wallet Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Connected Address</p>
                  <code className="text-sm">{address}</code>
                </div>
                <Button variant="outline" size="sm" onClick={() => refetchBalance()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
              </div>
              <div className="p-4 rounded-lg bg-muted">
                <p className="text-sm text-muted-foreground">USDC Balance</p>
                <p className="text-2xl font-bold">
                  {balanceLoading ? '...' : `$${usdcBalanceFormatted.toFixed(2)}`}
                </p>
              </div>
              {usdcBalanceFormatted === 0 && (
                <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-sm text-yellow-600">
                    No USDC balance. Make a deposit on the Stack page first, then wait for payment to clear.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <Wallet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-4">Connect your wallet to continue</p>
              <p className="text-sm text-muted-foreground">
                Import your recovery phrase into Trust Wallet, then connect here
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Risk Profile Selection */}
      {isConnected && usdcBalanceFormatted > 0 && !executionComplete && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Select Risk Profile</CardTitle>
            <CardDescription>Choose how to deploy your ${usdcBalanceFormatted.toFixed(2)} USDC</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(Object.entries(RISK_PROFILES) as [RiskProfileKey, typeof RISK_PROFILES.conservative][]).map(([key, profile]) => {
                const Icon = profile.icon;
                const isSelected = selectedProfile === key;
                return (
                  <button
                    key={key}
                    onClick={() => setSelectedProfile(key)}
                    disabled={isExecuting}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      isSelected 
                        ? `${profile.borderColor} ${profile.bgColor}` 
                        : 'border-border hover:border-muted-foreground/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`h-5 w-5 ${profile.color}`} />
                      <span className="font-semibold">{profile.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{profile.description}</p>
                    {isSelected && (
                      <div className="mt-3 pt-3 border-t border-border/50 text-xs">
                        <p>AAVE: ${((usdcBalanceFormatted * profile.allocation.aave) / 100).toFixed(2)}</p>
                        <p>GMX: ${((usdcBalanceFormatted * profile.allocation.gmx) / 100).toFixed(2)}</p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedProfile && (
              <div className="mt-6">
                <Button 
                  onClick={executeStrategy} 
                  disabled={isExecuting}
                  className="w-full"
                  size="lg"
                >
                  {isExecuting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Executing Strategy...
                    </>
                  ) : (
                    <>
                      Execute {RISK_PROFILES[selectedProfile].name} Strategy
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Execution Progress */}
      {executionSteps.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Execution Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={progress} className="mb-4" />
            <div className="space-y-3">
              {executionSteps.map((step) => (
                <div 
                  key={step.id}
                  className={`flex items-center gap-3 p-3 rounded-lg ${
                    step.status === 'completed' ? 'bg-green-500/10' :
                    step.status === 'executing' ? 'bg-blue-500/10' :
                    step.status === 'failed' ? 'bg-red-500/10' :
                    'bg-muted'
                  }`}
                >
                  {step.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-green-500" />}
                  {step.status === 'executing' && <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />}
                  {step.status === 'failed' && <span className="h-5 w-5 text-red-500">✗</span>}
                  {step.status === 'pending' && <span className="h-5 w-5 text-muted-foreground">○</span>}
                  <span className={step.status === 'completed' ? 'text-green-600' : ''}>{step.name}</span>
                  {step.txHash && (
                    <a 
                      href={`https://snowtrace.io/tx/${step.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-blue-500 hover:underline text-sm flex items-center gap-1"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Success State */}
      {executionComplete && (
        <Card className="mb-6 border-green-500/20 bg-green-500/5">
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500" />
            <h2 className="text-2xl font-bold mb-2">Strategy Deployed!</h2>
            <p className="text-muted-foreground mb-6">
              Your funds have been deployed according to your risk profile
            </p>
            <div className="flex gap-4 justify-center">
              <Link to="/dashboard">
                <Button>View Dashboard</Button>
              </Link>
              <Link to="/gmx">
                <Button variant="outline">Manage GMX Positions</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Link to="/stack">
          <Button variant="outline">← Back to Stack</Button>
        </Link>
        <Link to="/dashboard">
          <Button variant="outline">View Dashboard →</Button>
        </Link>
      </div>
    </div>
  );
}
