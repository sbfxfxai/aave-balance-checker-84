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
import { isSquareConfigured, getSquareConfig } from '@/lib/square';
import { SquarePaymentForm } from './SquarePaymentForm';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  depositType: 'usd' | 'bitcoin';
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
  depositType,
  riskProfile,
}) => {
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentNonce, setPaymentNonce] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Check Square configuration when modal opens
    if (isOpen) {
      const configured = isSquareConfigured();
      setIsConfigured(configured);
      
      if (configured) {
        const config = getSquareConfig();
        console.log('[DepositModal] Square configured:', {
          environment: config.environment,
          locationId: config.locationId,
        });
      } else {
        console.warn('[DepositModal] Square not configured');
        toast({
          title: 'Square API not configured',
          description: 'Please configure Square API credentials in .env file',
          variant: 'destructive',
        });
      }
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

    const minAmount = depositType === 'usd' ? 1 : 0.001; // $1 USD min for testing, 0.001 BTC min
    if (parseFloat(amount) < minAmount) {
      toast({
        title: 'Amount too low',
        description: `Minimum deposit: ${minAmount} ${depositType === 'usd' ? 'USD' : 'BTC'}`,
        variant: 'destructive',
      });
      return;
    }

    // For USD deposits, show payment form
    if (depositType === 'usd') {
      setShowPaymentForm(true);
      return;
    }

    // For Bitcoin deposits, process directly
    setIsProcessing(true);
    try {
      // TODO: Implement Bitcoin deposit processing
      toast({
        title: 'Bitcoin deposits',
        description: 'Bitcoin deposit processing coming soon',
      });
      setIsProcessing(false);
    } catch (error) {
      console.error('Bitcoin deposit error:', error);
      toast({
        title: 'Deposit failed',
        description: 'Failed to process Bitcoin deposit',
        variant: 'destructive',
      });
      setIsProcessing(false);
    }
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
            Deposit {depositType === 'usd' ? 'USD' : 'Bitcoin'} for {riskProfile.name} strategy
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Square Configuration Status */}
          {isConfigured ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-xs text-green-600 font-medium">
                Square API configured ({getSquareConfig().environment})
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
                Deposit Amount ({depositType === 'usd' ? 'USD' : 'BTC'})
              </Label>
              <Input
                id="amount"
                type="number"
                placeholder={depositType === 'usd' ? '1.00' : '0.001'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isProcessing}
                min={depositType === 'usd' ? 1 : 0.001}
                step={depositType === 'usd' ? 0.01 : 0.0001}
              />
              <p className="text-xs text-muted-foreground">
                Minimum: {depositType === 'usd' ? '$1.00' : '0.001 BTC'}
              </p>
            </div>
          )}

          {/* Square Payment Form (for USD deposits) */}
          {showPaymentForm && depositType === 'usd' && amount && (
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
                {depositType === 'usd' ? 'Continue to Payment' : 'Deposit'}
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

