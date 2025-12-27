import { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Loader2, DollarSign, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useCashAppPay } from '@/hooks/useCashAppPay';

const API_BASE = import.meta.env.VITE_API_URL || '';

// Cash App Pay configuration from environment
const CASHAPP_CLIENT_ID = import.meta.env.VITE_CASHAPP_CLIENT_ID || '';
const CASHAPP_MERCHANT_ID = import.meta.env.VITE_CASHAPP_MERCHANT_ID || '';
const CASHAPP_BRAND_ID = import.meta.env.VITE_CASHAPP_BRAND_ID || '';
const IS_SANDBOX = import.meta.env.VITE_CASHAPP_ENVIRONMENT !== 'production';

interface CashAppPayButtonProps {
  availableBalance: number;
  onWithdrawComplete?: () => void;
}

type WithdrawalStatus = 'idle' | 'ready' | 'processing' | 'success' | 'error';

export function CashAppPayButton({ availableBalance, onWithdrawComplete }: CashAppPayButtonProps) {
  const { address } = useAccount();
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<WithdrawalStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const hasRenderedRef = useRef(false);

  // Initialize Cash App Pay Kit
  const {
    isLoaded,
    isLoading: sdkLoading,
    error: sdkError,
    createPaymentRequest,
    renderButton,
    restart,
    approvalData,
  } = useCashAppPay({
    clientId: CASHAPP_CLIENT_ID,
    merchantId: CASHAPP_MERCHANT_ID,
    brandId: CASHAPP_BRAND_ID,
    sandbox: IS_SANDBOX,
    onApproved: async (data) => {
      console.log('[CashApp] Payment approved:', data);
      setStatus('processing');
      
      // Process the withdrawal with the grant
      try {
        // Get grant ID from the payment action grant
        const paymentGrant = data.grants.payment;
        const grantId = paymentGrant?.grantId;
        if (!grantId) {
          throw new Error('No grant ID received');
        }

        // Save grant for future use
        if (address) {
          localStorage.setItem(`cashapp_grant_${address}`, grantId);
        }

        // Complete the withdrawal
        const res = await fetch(`${API_BASE}/api/withdraw/complete-flow`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: address,
            amount,
            source: 'aave', // Default to AAVE for now
            cashappGrantId: grantId,
          }),
        });

        const result = await res.json();

        if (result.success) {
          setStatus('success');
          toast.success('Withdrawal complete!', {
            description: `$${parseFloat(amount).toFixed(2)} sent to ${data.customerProfile.cashtag}`,
          });
          onWithdrawComplete?.();
        } else {
          throw new Error(result.error || 'Withdrawal failed');
        }
      } catch (err) {
        console.error('[CashApp] Withdrawal error:', err);
        setError(err instanceof Error ? err.message : 'Withdrawal failed');
        setStatus('error');
        toast.error('Withdrawal failed');
      }
    },
    onDeclined: () => {
      setError('Payment was declined');
      setStatus('error');
      toast.error('Cash App payment declined');
    },
    onFailed: (err) => {
      console.error('[CashApp] Payment failed:', err);
      setError('Payment failed. Please try again.');
      setStatus('error');
    },
    onDismissed: () => {
      // User closed the modal without completing
      console.log('[CashApp] User dismissed');
    },
  });

  // Render Cash App Pay button when SDK is loaded and amount is set
  useEffect(() => {
    if (isLoaded && buttonContainerRef.current && !hasRenderedRef.current && parseFloat(amount) >= 1) {
      hasRenderedRef.current = true;
      
      const initPayment = async () => {
        try {
          // Create the payment request
          const referenceId = `withdraw-${address}-${Date.now()}`;
          await createPaymentRequest(parseFloat(amount), referenceId);
          
          // Render the button
          await renderButton('#cash-app-pay-button', {
            shape: 'semiround',
            theme: 'dark',
            width: 'full',
          });
          
          setStatus('ready');
        } catch (err) {
          console.error('[CashApp] Failed to initialize:', err);
          setError('Failed to initialize Cash App Pay');
        }
      };

      initPayment();
    }
  }, [isLoaded, amount, address, createPaymentRequest, renderButton]);

  // Reset when amount changes significantly
  useEffect(() => {
    if (hasRenderedRef.current && status === 'ready') {
      // Restart Pay Kit for new amount
      restart();
      hasRenderedRef.current = false;
      setStatus('idle');
    }
  }, [amount]);

  // Handle reset
  const handleReset = useCallback(() => {
    restart();
    hasRenderedRef.current = false;
    setStatus('idle');
    setAmount('');
    setError(null);
  }, [restart]);

  // Render success state
  if (status === 'success') {
    return (
      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            <div>
              <h3 className="text-lg font-semibold">Withdrawal Complete!</h3>
              <p className="text-sm text-muted-foreground">
                ${parseFloat(amount).toFixed(2)} sent to your Cash App
              </p>
              {approvalData?.customerProfile?.cashtag && (
                <p className="text-xs text-emerald-600 mt-1">
                  {approvalData.customerProfile.cashtag}
                </p>
              )}
            </div>
            <Button onClick={handleReset} variant="outline">
              Make Another Withdrawal
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render error state
  if (status === 'error' || sdkError) {
    return (
      <Card className="border-red-500/20 bg-red-500/5">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <div>
              <h3 className="text-lg font-semibold">Withdrawal Failed</h3>
              <p className="text-sm text-muted-foreground">{error || sdkError}</p>
            </div>
            <Button onClick={handleReset} variant="outline">
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Render processing state
  if (status === 'processing') {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4 py-8">
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

  // Main withdrawal form
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5 text-emerald-500" />
          Withdraw to Cash App
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Instant withdrawals via Cash App Pay • Powered by Square
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Amount Input */}
        <div>
          <label className="text-sm font-medium mb-2 block">Amount (USD)</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                if (hasRenderedRef.current) {
                  hasRenderedRef.current = false;
                  setStatus('idle');
                }
              }}
              className="pl-9"
              min="1"
              max={availableBalance}
            />
          </div>
          <div className="flex justify-between mt-1">
            <p className="text-xs text-muted-foreground">
              Available: ${availableBalance.toFixed(2)}
            </p>
            <button
              onClick={() => setAmount(availableBalance.toFixed(2))}
              className="text-xs text-primary hover:underline"
            >
              Max
            </button>
          </div>
        </div>

        {/* Cash App Pay Button Container */}
        {parseFloat(amount) >= 1 && (
          <div className="space-y-3">
            {sdkLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading Cash App Pay...</span>
              </div>
            )}
            
            {/* Pay Kit renders the button here */}
            <div 
              id="cash-app-pay-button" 
              ref={buttonContainerRef}
              className="min-h-[48px]"
            />
          </div>
        )}

        {/* Fallback button if SDK not loaded */}
        {!isLoaded && !sdkLoading && parseFloat(amount) >= 1 && (
          <Button
            disabled
            className="w-full"
            variant="outline"
          >
            Cash App Pay unavailable
          </Button>
        )}

        {/* Disclaimer */}
        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          Funds will be withdrawn from your savings, converted to USD, and sent to your Cash App instantly.
        </p>
      </CardContent>
    </Card>
  );
}
