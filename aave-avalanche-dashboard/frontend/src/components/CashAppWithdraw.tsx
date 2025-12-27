import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, DollarSign, QrCode, Smartphone, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface WithdrawalState {
  status: 'idle' | 'linking' | 'processing' | 'completed' | 'error';
  withdrawalId?: string;
  customerRequestId?: string;
  qrCodeUrl?: string;
  mobileUrl?: string;
  paymentId?: string;
  error?: string;
}

interface CashAppWithdrawProps {
  availableBalance: number; // Available USDC balance
  onWithdrawComplete?: () => void;
}

export function CashAppWithdraw({ availableBalance, onWithdrawComplete }: CashAppWithdrawProps) {
  const { address } = useAccount();
  const [amount, setAmount] = useState('');
  const [state, setState] = useState<WithdrawalState>({ status: 'idle' });
  const [savedGrantId, setSavedGrantId] = useState<string | null>(null);

  // Load saved grant ID from localStorage
  useEffect(() => {
    if (address) {
      const saved = localStorage.getItem(`cashapp_grant_${address}`);
      if (saved) {
        setSavedGrantId(saved);
      }
    }
  }, [address]);

  // Process payment after Cash App is linked
  const processPayment = useCallback(async (withdrawalId: string, grantId: string) => {
    setState(prev => ({ ...prev, status: 'processing' }));

    try {
      const amountUsd = parseFloat(amount);
      const res = await fetch(`${API_BASE}/api/cashapp/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          amountUsd,
          grantId,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setState({
          status: 'completed',
          withdrawalId: data.withdrawalId,
          paymentId: data.paymentId,
        });
        toast.success('Withdrawal complete!', {
          description: `$${amountUsd.toFixed(2)} sent to your Cash App`,
        });
        onWithdrawComplete?.();
      } else {
        throw new Error(data.error || 'Payment failed');
      }
    } catch (error) {
      setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Payment failed',
      });
      toast.error('Withdrawal failed', {
        description: error instanceof Error ? error.message : 'Please try again',
      });
    }
  }, [address, amount, onWithdrawComplete]);

  // Poll for customer request approval
  const pollForApproval = useCallback(async (customerRequestId: string, withdrawalId: string) => {
    const maxAttempts = 120; // 2 minutes at 1 second intervals
    let attempts = 0;

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setState(prev => ({
          ...prev,
          status: 'error',
          error: 'Linking timed out. Please try again.',
        }));
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

          // Process the payment
          await processPayment(withdrawalId, grantId);
          return;
        }

        // Update QR code if refreshed
        if (data.qrCodeUrl && data.qrCodeUrl !== state.qrCodeUrl) {
          setState(prev => ({
            ...prev,
            qrCodeUrl: data.qrCodeUrl,
          }));
        }

        attempts++;
        setTimeout(poll, 1000);
      } catch (error) {
        console.error('Polling error:', error);
        attempts++;
        setTimeout(poll, 1000);
      }
    };

    poll();
  }, [address, state.qrCodeUrl, processPayment]);

  // Initiate withdrawal
  const handleWithdraw = async () => {
    const amountUsd = parseFloat(amount);

    if (!amountUsd || amountUsd < 1) {
      toast.error('Minimum withdrawal is $1');
      return;
    }

    if (amountUsd > availableBalance) {
      toast.error('Insufficient balance');
      return;
    }

    // If user has a saved grant, process directly
    if (savedGrantId) {
      setState({ status: 'processing' });
      await processPayment(`WD_${Date.now()}`, savedGrantId);
      return;
    }

    // Otherwise, initiate linking flow
    setState({ status: 'linking' });

    try {
      const res = await fetch(`${API_BASE}/api/cashapp/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: address,
          amountUsd,
        }),
      });

      const data = await res.json();

      if (data.success && data.status === 'pending_link') {
        setState({
          status: 'linking',
          withdrawalId: data.withdrawalId,
          customerRequestId: data.customerRequestId,
          qrCodeUrl: data.qrCodeUrl,
          mobileUrl: data.mobileUrl,
        });

        // Start polling for approval
        pollForApproval(data.customerRequestId, data.withdrawalId);
      } else {
        throw new Error(data.error || 'Failed to initiate withdrawal');
      }
    } catch (error) {
      setState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to initiate withdrawal',
      });
      toast.error('Failed to start withdrawal');
    }
  };

  // Reset state
  const handleReset = () => {
    setState({ status: 'idle' });
    setAmount('');
  };

  // Render based on state
  if (state.status === 'completed') {
    return (
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <div>
              <h3 className="text-lg font-semibold">Withdrawal Complete</h3>
              <p className="text-sm text-muted-foreground">
                ${parseFloat(amount).toFixed(2)} has been sent to your Cash App
              </p>
            </div>
            <Button onClick={handleReset} variant="outline">
              Make Another Withdrawal
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.status === 'error') {
    return (
      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <div>
              <h3 className="text-lg font-semibold">Withdrawal Failed</h3>
              <p className="text-sm text-muted-foreground">{state.error}</p>
            </div>
            <Button onClick={handleReset} variant="outline">
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (state.status === 'linking') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-emerald-500" />
            Connect Cash App
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Scan the QR code with your Cash App or tap the button below on mobile
          </p>

          {state.qrCodeUrl && (
            <div className="flex justify-center">
              <div className="p-4 bg-white rounded-lg">
                <img
                  src={state.qrCodeUrl}
                  alt="Cash App QR Code"
                  className="w-48 h-48"
                />
              </div>
            </div>
          )}

          {state.mobileUrl && (
            <Button
              asChild
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600"
            >
              <a href={state.mobileUrl} target="_blank" rel="noopener noreferrer">
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

  if (state.status === 'processing') {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-emerald-500" />
            <div>
              <h3 className="text-lg font-semibold">Processing Withdrawal</h3>
              <p className="text-sm text-muted-foreground">
                Sending ${parseFloat(amount).toFixed(2)} to your Cash App...
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Idle state - show withdrawal form
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
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-2 block">Amount (USD)</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="pl-9"
              min="1"
              max={availableBalance}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Available: ${availableBalance.toFixed(2)}
          </p>
        </div>

        {savedGrantId && (
          <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-500/10 p-2 rounded">
            <CheckCircle2 className="h-4 w-4" />
            Cash App connected • Instant withdrawal
          </div>
        )}

        <Button
          onClick={handleWithdraw}
          disabled={!amount || parseFloat(amount) < 1}
          className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
        >
          {savedGrantId ? (
            <>
              <DollarSign className="mr-2 h-4 w-4" />
              Withdraw to Cash App
            </>
          ) : (
            <>
              <QrCode className="mr-2 h-4 w-4" />
              Connect Cash App & Withdraw
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          Funds will be converted from USDC to USD and sent to your Cash App instantly.
        </p>
      </CardContent>
    </Card>
  );
}
