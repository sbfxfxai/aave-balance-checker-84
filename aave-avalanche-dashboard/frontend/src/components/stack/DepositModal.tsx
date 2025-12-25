import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  ensureSquareConfigAvailable,
  getSquareConfig,
} from '@/lib/square';
import { SquarePaymentForm } from './SquarePaymentForm';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  riskProfile: {
    id: string;
    name: string;
    description: string;
    allocation: string;
    apy: string;
    leverage: string;
  };
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  riskProfile,
}) => {
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentNonce, setPaymentNonce] = useState<string | null>(null);
  const [squareConfig, setSquareConfig] = useState(getSquareConfig());
  const { toast } = useToast();

  useEffect(() => {
    // Check Square configuration when modal opens
    if (isOpen) {
      let cancelled = false;
      const checkConfig = async () => {
        await ensureSquareConfigAvailable();
        const resolvedConfig = getSquareConfig();

        if (cancelled) return;

        setSquareConfig(resolvedConfig);

        const configured = !!resolvedConfig.applicationId && !!resolvedConfig.locationId;
        setIsConfigured(configured);
        
        if (configured) {
          console.log('[DepositModal] Square configured:', {
            environment: resolvedConfig.environment,
            locationId: resolvedConfig.locationId,
            source: resolvedConfig.source,
          });
        } else if (import.meta.env.DEV) {
          console.warn('[DepositModal] Square not configured');
          toast({
            title: 'Square API not configured',
            description: 'Please configure Square API credentials in .env file',
            variant: 'destructive',
          });
        }
      };

      checkConfig();

      return () => {
        cancelled = true;
      };
    }
  }, [isOpen, toast]);

  const handleDeposit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid deposit amount',
        variant: 'destructive',
      });
      return;
    }

    const minAmount = 10;
    if (parseFloat(amount) < minAmount) {
      toast({
        title: 'Amount too low',
        description: `Minimum deposit: $${minAmount.toFixed(2)}`,
        variant: 'destructive',
      });
      return;
    }

    setShowPaymentForm(true);
  };

  const handlePaymentNonce = async (nonce: string) => {
    setPaymentNonce(nonce);
    setIsProcessing(true);
    
    try {
      // Process payment directly using SquarePaymentService
      const { squarePaymentService } = await import('@/lib/squarePaymentService');
      const orderId = `order-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      const result = await squarePaymentService.processPayment(
        nonce,
        parseFloat(amount),
        orderId,
        riskProfile.id
      );

      if (result.success) {
        toast({
          title: 'Deposit successful',
          description: `Payment of $${amount} processed successfully!`,
        });
        
        // Close modal and reset
        setTimeout(() => {
          setAmount('');
          setIsProcessing(false);
          setShowPaymentForm(false);
          setPaymentNonce(null);
          onClose();
        }, 2000);
      } else {
        throw new Error(result.error || 'Payment processing failed');
      }
    } catch (error: unknown) {
      console.error('Payment processing error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to process payment. Please try again.';
      toast({
        title: 'Payment failed',
        description: errorMessage,
        variant: 'destructive',
      });
      setIsProcessing(false);
      setShowPaymentForm(false);
    }
  };

  const handlePaymentError = (error: Error) => {
    console.error('Payment form error:', error);
    toast({
      title: 'Payment failed',
      description: error.message || 'Failed to process payment. Please try again.',
      variant: 'destructive',
    });
    setIsProcessing(false);
    setShowPaymentForm(false);
  };


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete Your Deposit</DialogTitle>
          <DialogDescription>
            Deposit USD for {riskProfile.name} strategy
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Square Configuration Status */}
          {isConfigured ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-xs text-green-600 font-medium">
                Square API configured ({squareConfig.environment})
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <span className="text-xs text-yellow-600 font-medium">
                Square API not configured - payments will not work
              </span>
            </div>
          )}

          {/* Risk Profile Summary */}
          <div className="p-4 rounded-lg bg-muted">
            <div className="text-sm font-medium mb-2">{riskProfile.name}</div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Allocation: {riskProfile.allocation}</div>
              <div>Expected APY: {riskProfile.apy}</div>
              <div>Leverage: {riskProfile.leverage}</div>
            </div>
          </div>

          {/* Amount Input */}
          {!showPaymentForm && (
            <div className="space-y-2">
              <Label htmlFor="amount">
                Deposit Amount (USD)
              </Label>
              <Input
                id="amount"
                type="number"
                placeholder="10.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isProcessing}
                min={10}
                step={0.01}
              />
              <p className="text-xs text-muted-foreground">
                Minimum: $10.00
              </p>
            </div>
          )}

          {/* Square Payment Form (for USD deposits) */}
          {showPaymentForm && amount && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted">
                <div className="text-sm font-medium">Amount: ${parseFloat(amount).toFixed(2)}</div>
              </div>
              <SquarePaymentForm
                amount={parseFloat(amount)}
                onPaymentSuccess={handlePaymentNonce}
                onPaymentError={handlePaymentError}
              />
            </div>
          )}

          {/* Processing State */}
          {isProcessing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing payment...
            </div>
          )}

          {/* Action Buttons */}
          {!showPaymentForm && (
            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isProcessing}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeposit}
                disabled={isProcessing || !amount || !isConfigured}
                className="flex-1"
              >
                Continue to Payment
              </Button>
            </div>
          )}
          
          {showPaymentForm && (
            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowPaymentForm(false);
                  setIsProcessing(false);
                }}
                disabled={isProcessing}
                className="flex-1"
              >
                Back
              </Button>
              {isProcessing && (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing payment...
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

