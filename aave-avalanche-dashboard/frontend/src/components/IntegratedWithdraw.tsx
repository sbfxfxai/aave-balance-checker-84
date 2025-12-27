import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { 
  Loader2, 
  DollarSign, 
  QrCode, 
  Smartphone, 
  CheckCircle2, 
  AlertCircle,
  Wallet,
  TrendingUp,
  Shield,
  ArrowRight,
  ArrowLeft
} from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '';

type WithdrawalStep = 'select' | 'confirm' | 'linking' | 'processing' | 'success' | 'error';
type WithdrawalSource = 'aave' | 'gmx' | 'wallet';

interface AvailableBalances {
  aave: number;
  gmx: number;
  wallet: number;
}

interface IntegratedWithdrawProps {
  availableBalances: AvailableBalances;
  onWithdrawComplete?: () => void;
}

const SOURCE_CONFIG = {
  aave: {
    name: 'Savings Account',
    icon: Shield,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/20',
    description: 'USDC earning interest on Aave',
  },
  gmx: {
    name: 'Bitcoin Position',
    icon: TrendingUp,
    color: 'text-purple-500',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/20',
    description: 'Leveraged BTC position on GMX',
  },
  wallet: {
    name: 'Available Cash',
    icon: Wallet,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/20',
    description: 'USDC in your wallet',
  },
};

export function IntegratedWithdraw({ availableBalances, onWithdrawComplete }: IntegratedWithdrawProps) {
  const { address } = useAccount();
  const [step, setStep] = useState<WithdrawalStep>('select');
  const [source, setSource] = useState<WithdrawalSource>('aave');
  const [amount, setAmount] = useState('');
  const [withdrawalId, setWithdrawalId] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [mobileUrl, setMobileUrl] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedGrantId, setSavedGrantId] = useState<string | null>(null);

  // Load saved Cash App grant from localStorage
  useEffect(() => {
    if (address) {
      const saved = localStorage.getItem(`cashapp_grant_${address}`);
      if (saved) {
        setSavedGrantId(saved);
      }
    }
  }, [address]);

  // Poll for Cash App approval
  const pollForApproval = useCallback(async (customerRequestId: string) => {
    const maxAttempts = 120;
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setError('Linking timed out. Please try again.');
        setStep('error');
        return;
      }

      try {
        const res = await fetch(
          `${API_BASE}/api/cashapp/customer-request?requestId=${customerRequestId}`
        );
        const data = await res.json();

        if (data.isApproved && data.grants?.length > 0) {
          const grantId = data.grants[0].id;

          // Save grant for future withdrawals
          if (address) {
            localStorage.setItem(`cashapp_grant_${address}`, grantId);
            setSavedGrantId(grantId);
          }

          // Complete the withdrawal with the grant
          await completeWithdrawal(grantId);
          return;
        }

        // Update QR code if refreshed
        if (data.qrCodeUrl) {
          setQrCodeUrl(data.qrCodeUrl);
        }

        attempts++;
        setTimeout(poll, 1000);
      } catch (err) {
        console.error('Polling error:', err);
        attempts++;
        setTimeout(poll, 1000);
      }
    };

    poll();
  }, [address]);

  // Complete withdrawal after Cash App is linked
  const completeWithdrawal = async (grantId: string) => {
    setStep('processing');

    try {
      const res = await fetch(`${API_BASE}/api/withdraw/complete-flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          amount,
          source,
          cashappGrantId: grantId,
        }),
      });

      const data = await res.json();

      if (data.success && !data.needsLinking) {
        setPaymentId(data.paymentId);
        setStep('success');
        toast.success('Withdrawal complete!', {
          description: `$${parseFloat(amount).toFixed(2)} sent to your Cash App`,
        });
        onWithdrawComplete?.();
      } else {
        throw new Error(data.error || 'Withdrawal failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdrawal failed');
      setStep('error');
    }
  };

  // Initiate withdrawal
  const handleWithdraw = async () => {
    const amountUsd = parseFloat(amount);
    const maxBalance = availableBalances[source];

    if (!amountUsd || amountUsd < 1) {
      toast.error('Minimum withdrawal is $1');
      return;
    }

    if (amountUsd > maxBalance) {
      toast.error('Insufficient balance');
      return;
    }

    // If user has saved grant, complete directly
    if (savedGrantId) {
      await completeWithdrawal(savedGrantId);
      return;
    }

    // Otherwise, initiate linking flow
    setStep('processing');

    try {
      const res = await fetch(`${API_BASE}/api/withdraw/complete-flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          amount,
          source,
        }),
      });

      const data = await res.json();

      if (data.success && data.needsLinking) {
        setWithdrawalId(data.withdrawalId);
        setQrCodeUrl(data.qrCodeUrl);
        setMobileUrl(data.mobileUrl);
        setStep('linking');
        pollForApproval(data.customerRequestId);
      } else if (data.success) {
        setPaymentId(data.paymentId);
        setStep('success');
        toast.success('Withdrawal complete!');
        onWithdrawComplete?.();
      } else {
        throw new Error(data.error || 'Failed to initiate withdrawal');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate withdrawal');
      setStep('error');
    }
  };

  // Reset to start
  const handleReset = () => {
    setStep('select');
    setAmount('');
    setError(null);
    setQrCodeUrl(null);
    setMobileUrl(null);
    setPaymentId(null);
    setWithdrawalId(null);
  };

  // Set max amount
  const handleSetMax = () => {
    setAmount(availableBalances[source].toFixed(2));
  };

  // Render success state
  if (step === 'success') {
    return (
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="p-4 rounded-full bg-emerald-500/20">
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-xl font-semibold">Withdrawal Complete!</h3>
              <p className="text-sm text-muted-foreground mt-1">
                ${parseFloat(amount).toFixed(2)} has been sent to your Cash App
              </p>
              {paymentId && (
                <p className="text-xs text-muted-foreground mt-2">
                  Payment ID: {paymentId}
                </p>
              )}
            </div>
            <Button onClick={handleReset} variant="outline" className="mt-4">
              Make Another Withdrawal
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render error state
  if (step === 'error') {
    return (
      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="p-4 rounded-full bg-red-500/20">
              <AlertCircle className="h-12 w-12 text-red-500" />
            </div>
            <div>
              <h3 className="text-xl font-semibold">Withdrawal Failed</h3>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
            </div>
            <Button onClick={handleReset} variant="outline" className="mt-4">
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render linking state (QR code)
  if (step === 'linking') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-emerald-500" />
            Connect Your Cash App
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground text-center">
            Scan the QR code with your Cash App to approve the withdrawal of ${parseFloat(amount).toFixed(2)}
          </p>

          {qrCodeUrl && (
            <div className="flex justify-center">
              <div className="p-4 bg-white rounded-xl shadow-sm">
                <img src={qrCodeUrl} alt="Cash App QR Code" className="w-48 h-48" />
              </div>
            </div>
          )}

          {mobileUrl && (
            <Button
              asChild
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
            >
              <a href={mobileUrl} target="_blank" rel="noopener noreferrer">
                <Smartphone className="mr-2 h-4 w-4" />
                Open in Cash App
              </a>
            </Button>
          )}

          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Waiting for approval...
          </div>

          <Button onClick={handleReset} variant="ghost" className="w-full">
            Cancel
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Render processing state
  if (step === 'processing') {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4 py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <div>
              <h3 className="text-lg font-semibold">Processing Withdrawal</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Withdrawing ${parseFloat(amount).toFixed(2)} from {SOURCE_CONFIG[source].name}...
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render confirmation state
  if (step === 'confirm') {
    const config = SOURCE_CONFIG[source];
    const Icon = config.icon;

    return (
      <Card>
        <CardHeader>
          <CardTitle>Confirm Withdrawal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">From</span>
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${config.color}`} />
                <span className="font-medium">{config.name}</span>
              </div>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Amount</span>
              <span className="font-medium">${parseFloat(amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">To</span>
              <span className="font-medium">Cash App</span>
            </div>
            <div className="border-t pt-3 flex justify-between items-center">
              <span className="text-muted-foreground">You'll receive</span>
              <span className="text-xl font-bold text-emerald-500">
                ${parseFloat(amount).toFixed(2)}
              </span>
            </div>
          </div>

          {savedGrantId && (
            <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-500/10 p-3 rounded-lg">
              <CheckCircle2 className="h-4 w-4" />
              Cash App connected • Instant withdrawal
            </div>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => setStep('select')}
              variant="outline"
              className="flex-1"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={handleWithdraw}
              className="flex-1 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
            >
              Confirm
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render selection state (default)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-emerald-500" />
          Withdraw to Cash App
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Instant withdrawals to your $cashtag • ~1.5% fee
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Source Selection */}
        <div>
          <label className="text-sm font-medium mb-3 block">Withdraw From</label>
          <div className="grid grid-cols-1 gap-3">
            {(Object.keys(SOURCE_CONFIG) as WithdrawalSource[]).map((key) => {
              const config = SOURCE_CONFIG[key];
              const Icon = config.icon;
              const balance = availableBalances[key];
              const isSelected = source === key;

              return (
                <button
                  key={key}
                  onClick={() => setSource(key)}
                  disabled={balance <= 0}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    isSelected
                      ? `${config.borderColor} ${config.bgColor}`
                      : 'border-border hover:border-muted-foreground/30'
                  } ${balance <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${config.bgColor}`}>
                        <Icon className={`h-5 w-5 ${config.color}`} />
                      </div>
                      <div>
                        <p className="font-medium">{config.name}</p>
                        <p className="text-xs text-muted-foreground">{config.description}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-bold">${balance.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">Available</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Amount Input */}
        <div>
          <label className="text-sm font-medium mb-2 block">Amount (USD)</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="pl-9 pr-16"
              min="1"
              max={availableBalances[source]}
            />
            <button
              onClick={handleSetMax}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-primary hover:text-primary/80 font-medium"
            >
              MAX
            </button>
          </div>
        </div>

        {/* Continue Button */}
        <Button
          onClick={() => setStep('confirm')}
          disabled={!amount || parseFloat(amount) < 1 || parseFloat(amount) > availableBalances[source]}
          className="w-full bg-gradient-to-r from-blue-700 to-emerald-500 hover:from-blue-800 hover:to-emerald-600"
        >
          {savedGrantId ? (
            <>
              <DollarSign className="mr-2 h-4 w-4" />
              Continue to Withdraw
            </>
          ) : (
            <>
              <QrCode className="mr-2 h-4 w-4" />
              Connect Cash App & Withdraw
            </>
          )}
        </Button>

        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          Funds will be withdrawn from {SOURCE_CONFIG[source].name}, converted to USD, and sent to your Cash App instantly.
        </p>
      </CardContent>
    </Card>
  );
}
