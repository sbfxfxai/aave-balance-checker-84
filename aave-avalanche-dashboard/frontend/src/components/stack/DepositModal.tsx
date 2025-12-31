import React, { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Wallet as EthersWallet } from 'ethers';
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
import { Loader2, CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  ensureSquareConfigAvailable,
  getSquareConfig,
} from '@/lib/square';
import { SquarePaymentForm } from './SquarePaymentForm';
import { ERGC_DISCOUNT } from '@/config/contracts';

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
  const { address: wagmiAddress, isConnected: isWagmiConnected } = useAccount();
  const { authenticated, user, ready } = usePrivy();
  const { wallets } = useWallets();
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentNonce, setPaymentNonce] = useState<string | null>(null);
  const [squareConfig, setSquareConfig] = useState(getSquareConfig());
  const [avaxPrice, setAvaxPrice] = useState<number | null>(null);
  const [includeErgc, setIncludeErgc] = useState(false); // Buy 100 ERGC option
  const [userErgcBalance, setUserErgcBalance] = useState(0); // User's ERGC balance
  const [isCheckingErgc, setIsCheckingErgc] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [cooldownTime, setCooldownTime] = useState<number>(0);
  const { toast } = useToast();

  // Get the most relevant wallet address - prioritize Privy for authenticated users
  const connectedAddress = React.useMemo(() => {
    // If user is authenticated with Privy, use Privy wallet
    if (authenticated && ready) {
      const privyWallet = wallets.find(w => w.walletClientType === 'privy');
      if (privyWallet) return privyWallet.address;
      return user?.wallet?.address;
    }
    
    // Fall back to wagmi wallet
    return wagmiAddress;
  }, [authenticated, ready, wallets, user, wagmiAddress]);

  // Check if user has any wallet connected (Privy or wagmi)
  const isConnected = Boolean(connectedAddress && (authenticated || isWagmiConnected));

  // ERGC purchase cost ($10 for 100 ERGC)
  const ergcCost = 10;
  const ergcAmount = 100;
  
  // Check if user has enough ERGC for discount (need at least 100)
  const hasErgcForDiscount = userErgcBalance >= 100;

  // Calculate platform fee based on deposit amount tiers
  const getPlatformFeeRate = (depositAmount: number) => {
    if (depositAmount >= 1000) return 0.033; // 3.3%
    if (depositAmount >= 100) return 0.042; // 4.2%
    if (depositAmount >= 50) return 0.055; // 5.5%
    if (depositAmount >= 20) return 0.074; // 7.4%
    return 0.074; // Default 7.4% for amounts < $20
  };

  const platformFeeRate = getPlatformFeeRate(parseFloat(amount) || 0);
  
  // Calculate ERGC discount rates (fixed rates based on tier)
  const getErgcDiscountRate = (baseRate: number) => {
    const depositAmount = parseFloat(amount) || 0;
    if (depositAmount >= 1000) return 0.031; // Fixed 3.1%
    if (depositAmount >= 100) return 0.04; // Fixed 4.0%
    if (depositAmount >= 50) return 0.045; // Fixed 4.5%
    if (depositAmount >= 20) return 0.055; // Fixed 5.5%
    return 0.055; // Fixed 5.5% for amounts < $20
  };

  const effectivePlatformFeeRate = (includeErgc || hasErgcForDiscount) ? getErgcDiscountRate(platformFeeRate) : platformFeeRate;
  
  // Debug logging for fee calculation
  console.log(`[DepositModal] Fee calculation debug:`, {
    amount: parseFloat(amount) || 0,
    platformFeeRate,
    hasErgcForDiscount,
    userErgcBalance,
    includeErgc,
    effectivePlatformFeeRate
  });

  // Cooldown logic - 10 minutes between deposits
  useEffect(() => {
    if (!isOpen) return;

    const checkCooldown = () => {
      const lastDepositTime = localStorage.getItem(`lastDeposit_${connectedAddress}`);
      if (lastDepositTime) {
        const timeSinceLastDeposit = Date.now() - parseInt(lastDepositTime);
        const cooldownPeriod = 10 * 60 * 1000; // 10 minutes in milliseconds
        const remainingCooldown = Math.max(0, cooldownPeriod - timeSinceLastDeposit);
        
        setCooldownTime(remainingCooldown);
        
        if (remainingCooldown > 0) {
          const timer = setTimeout(() => {
            setCooldownTime(0);
          }, remainingCooldown);
          
          return () => clearTimeout(timer);
        }
      } else {
        setCooldownTime(0);
      }
    };

    checkCooldown();
    
    // Update cooldown every second
    const interval = setInterval(checkCooldown, 1000);
    
    return () => clearInterval(interval);
  }, [isOpen, connectedAddress]);

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

        // Fetch AVAX price for fee calculation
        try {
          const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd');
          const priceData = await priceResponse.json();
          if (!cancelled && priceData['avalanche-2']?.usd) {
            setAvaxPrice(priceData['avalanche-2'].usd);
            console.log('[DepositModal] AVAX price fetched:', priceData['avalanche-2'].usd);
          }
        } catch (error) {
          console.error('[DepositModal] Failed to fetch AVAX price:', error);
          if (!cancelled) {
            setAvaxPrice(30); // Fallback price
          }
        }
      };

      checkConfig();

      return () => {
        cancelled = true;
      };
    }
  }, [isOpen, toast]);

  // Check user's ERGC balance (discount if 100+)
  const checkUserErgcBalance = useCallback(async (walletAddress: string) => {
    setIsCheckingErgc(true);
    try {
      console.log(`[DepositModal] Checking ERGC balance for ${walletAddress}`);
      const response = await fetch(`/api/ergc/balance?address=${walletAddress}`);
      if (response.ok) {
        const data = await response.json();
        console.log(`[DepositModal] ERGC balance response:`, data);
        setUserErgcBalance(data.balance || 0);
        if (data.balance >= 100) {
          toast({
            title: 'ERGC Found!',
            description: `You have ${data.balance} ERGC (100+ qualifies for discount).`,
          });
        }
      }
    } catch (error) {
      console.error('[DepositModal] Failed to check ERGC balance:', error);
    } finally {
      setIsCheckingErgc(false);
    }
  }, [toast]);

  // Auto-check ERGC balance when wallet is connected
  useEffect(() => {
    if (isOpen && isConnected && connectedAddress) {
      checkUserErgcBalance(connectedAddress);
    }
  }, [isOpen, isConnected, connectedAddress, checkUserErgcBalance]);


  const handleDeposit = async () => {
    // REQUIRE: Web3 wallet must be connected (funds go to connected wallet)
    if (!isConnected || !connectedAddress) {
      toast({
        title: 'Wallet required',
        description: 'Please connect your Web3 wallet (MetaMask) to make a deposit. Funds will be sent to your connected wallet.',
        variant: 'destructive',
      });
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast({
        title: 'Invalid amount',
        description: 'Please enter a valid deposit amount',
        variant: 'destructive',
      });
      return;
    }

    const depositAmount = parseFloat(amount);
    
    // Validate minimum and maximum limits
    if (depositAmount < 10) {
      toast({
        title: 'Minimum deposit required',
        description: 'Minimum deposit amount is $10',
        variant: 'destructive',
      });
      return;
    }
    
    if (depositAmount > 9999) {
      toast({
        title: 'Maximum deposit exceeded',
        description: 'Maximum deposit amount is $9,999',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);

    try {
      // SECURITY: Generate payment ID first (validated format)
      const paymentId = `payment-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Use connected Web3 wallet address (required)
      const walletAddress = connectedAddress;
      
      // Get email from localStorage if available (optional, for payment info)
      const userEmail = localStorage.getItem('tiltvault_email') || '';

      // Store payment info with wallet address (for webhook)
      const runtimeApiBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const paymentInfoResponse = await fetch(`${runtimeApiBaseUrl}/api/wallet/store-payment-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId,
          walletAddress,
          userEmail: userEmail || undefined, // Optional - only if user is logged in
          riskProfile: riskProfile.id,
          amount: parseFloat(amount),
        }),
      });

      if (!paymentInfoResponse.ok) {
        const errorData = await paymentInfoResponse.json().catch(() => ({}));
        console.warn('[DepositModal] Failed to store payment info:', errorData.error || 'Unknown error');
        toast({
          title: 'Warning',
          description: 'Payment info storage failed, but deposit will continue',
          variant: 'destructive',
        });
      }

      toast({
        title: 'Using connected wallet',
        description: `Deposits will be sent to ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`,
      });

      // Show payment form
      setShowPaymentForm(true);
    } catch (error) {
      console.error('Deposit setup error:', error);
      toast({
        title: 'Setup failed',
        description: error instanceof Error ? error.message : 'Failed to set up deposit',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaymentNonce = async (nonce: string) => {
    setPaymentNonce(nonce);
    setIsProcessing(true);
    
    try {
      // REQUIRE: Web3 wallet must be connected
      if (!isConnected || !connectedAddress) {
        throw new Error('Wallet not connected');
      }

      // Process payment directly using SquarePaymentService
      const { squarePaymentService } = await import('@/lib/squarePaymentService');
      const orderId = `order-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Calculate total amount to charge (amount + tiered platform fee + optional ERGC pack)
      const platformFee = parseFloat(amount) * effectivePlatformFeeRate;
      const ergcPurchase = includeErgc ? ergcCost : 0; // $10 for 100 ERGC
      const totalAmount = parseFloat(amount) + platformFee + ergcPurchase;
      
      // Get email from localStorage if available (optional)
      const userEmail = localStorage.getItem('tiltvault_email') || '';
      
      // Get paymentId from earlier step (stored in state or generate if needed)
      const paymentId = `payment-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Store payment info with paymentId BEFORE processing payment
      const runtimeApiBaseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const paymentInfoResponse = await fetch(`${runtimeApiBaseUrl}/api/wallet/store-payment-info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId,
          walletAddress: connectedAddress,
          userEmail: userEmail || undefined,
          riskProfile: riskProfile.id,
          amount: parseFloat(amount),
        }),
      });

      if (!paymentInfoResponse.ok) {
        console.warn('[DepositModal] Failed to store payment info before payment');
      }

      const result = await squarePaymentService.processPayment(
        nonce,
        totalAmount,
        orderId,
        riskProfile.id,
        includeErgc,
        connectedAddress, // Use connected wallet address
        userEmail || undefined, // Optional email
        paymentId // Pass paymentId so it can be included in payment note
      );

      if (result.success) {
        // Save deposit time for cooldown
        localStorage.setItem(`lastDeposit_${connectedAddress}`, Date.now().toString());
        
        // Show success
        setPaymentSuccess(true);
        
        toast({
          title: 'Payment successful!',
          description: `Funds will be sent to your connected wallet: ${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`,
        });
        
        // Auto-redirect to dashboard after 2 seconds
        setTimeout(() => {
          window.location.href = '/';
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
      <DialogContent className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">Complete Your Deposit</DialogTitle>
          <DialogDescription className="text-sm">
            Deposit USD for {riskProfile.name} strategy
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Risk Profile Summary */}
          {!showPaymentForm && !paymentSuccess && (
            <div className="p-4 rounded-lg bg-muted">
              <div className="text-sm font-medium mb-2">{riskProfile.name}</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Allocation: {riskProfile.allocation}</div>
                <div>Expected APY: {riskProfile.apy}</div>
                <div>Leverage: {riskProfile.leverage}</div>
                {amount && avaxPrice && (
                  <div className="pt-2 border-t border-border/50">
                    <div className="font-medium text-foreground">
                      Total Fee: ${((parseFloat(amount) * effectivePlatformFeeRate)).toFixed(2)}
                    </div>
                    <details className="mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Fee details
                      </summary>
                      <div className="mt-2 text-xs text-muted-foreground space-y-1 pl-4">
                        <div>Platform Fee: {(effectivePlatformFeeRate * 100).toFixed(1)}% (${(parseFloat(amount) * effectivePlatformFeeRate).toFixed(2)})</div>
                        <div className="text-xs text-green-600">
                          *AVAX sent to your wallet
                        </div>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </div>
          )}


          {/* Amount Input */}
          {!showPaymentForm && !paymentSuccess && (
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
                max={9999}
                step={0.01}
              />
              <p className="text-xs text-muted-foreground">
                Min: $10 · Max: $9,999
              </p>
              {cooldownTime > 0 && (
                <p className="text-xs text-orange-600">
                  ⏱️ Cooldown: {Math.ceil(cooldownTime / 60000)}m {Math.ceil((cooldownTime % 60000) / 1000)}s remaining
                </p>
              )}
            </div>
          )}

          {/* ERGC Fee Discount Option - Only show for GMX strategies */}
          {!showPaymentForm && !paymentSuccess && riskProfile.id !== 'conservative' && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground text-center pb-1">
                💡 <span className="font-medium">Optional:</span> Add 100 ERGC for $10 (qualifies for discount)
              </div>
              <div 
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  includeErgc 
                    ? 'bg-green-500/10 border-green-500/50' 
                    : 'bg-muted/50 border-border hover:border-green-500/50'
                }`}
                onClick={() => {
                  setIncludeErgc(!includeErgc);
                }}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center ${
                    includeErgc ? 'bg-green-500 border-green-500' : 'border-muted-foreground'
                  }`}>
                    {includeErgc && <span className="text-white text-xs">✓</span>}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Zap className={`w-4 h-4 ${includeErgc ? 'text-green-500' : 'text-muted-foreground'}`} />
                      <span className="text-sm font-medium">
                        {includeErgc ? 'ERGC pack added' : 'Add 100 ERGC ($10)'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {includeErgc 
                        ? `+$${ergcCost} for 100 ERGC. Discounted fee: ${ERGC_DISCOUNT.DISCOUNTED_FEE} AVAX`
                        : `Reduces fee from ${ERGC_DISCOUNT.STANDARD_FEE} to ${ERGC_DISCOUNT.DISCOUNTED_FEE} AVAX and qualifies for discount`}
                    </p>
                    {includeErgc && (
                      <p className="text-xs text-green-600 mt-1">
                        100 ERGC will be sent to your wallet after payment.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Savings indicator when ERGC pack selected or already has 100+ */}
              {(includeErgc || hasErgcForDiscount) && (
                <p className="text-xs text-green-600 text-center">
                  ⚡ Discount applied (requires ≥100 ERGC)
                </p>
              )}
            </div>
          )}

          {/* Square Payment Form (for USD deposits) */}
          {showPaymentForm && amount && (
            <div className="space-y-4">
              {/* Order Summary */}
              <div className="p-4 rounded-lg bg-muted">
                <div className="text-sm font-medium mb-2">{riskProfile.name}</div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>Allocation: {riskProfile.allocation}</div>
                  <div>Expected APY: {riskProfile.apy}</div>
                  <div>Leverage: {riskProfile.leverage}</div>
                  {amount && avaxPrice && (
                  <div className="pt-2 border-t border-border/50">
                    <div className="font-medium text-foreground">
                      Total Fee: ${((parseFloat(amount) * effectivePlatformFeeRate)).toFixed(2)}
                    </div>
                    <details className="mt-1">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Fee details
                      </summary>
                      <div className="mt-2 text-xs text-muted-foreground space-y-1 pl-4">
                        <div>Platform Fee: {(effectivePlatformFeeRate * 100).toFixed(1)}% (${(parseFloat(amount) * effectivePlatformFeeRate).toFixed(2)})</div>
                        <div className="text-xs text-green-600">
                          *AVAX sent to your wallet
                        </div>
                      </div>
                    </details>
                  </div>
                )}
                </div>
              </div>
              <SquarePaymentForm
                amount={
                  parseFloat(amount) + 
                  (parseFloat(amount) * effectivePlatformFeeRate) +
                  (includeErgc ? ergcCost : 0)
                }
                onPaymentSuccess={handlePaymentNonce}
                onPaymentError={handlePaymentError}
              />
            </div>
          )}

          {/* Processing State */}
          {isProcessing && !paymentSuccess && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing payment...
            </div>
          )}

          {/* Payment Success */}
          {paymentSuccess && isConnected && connectedAddress && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="text-sm text-green-600 font-medium">
                  Payment successful! Your wallet is being funded.
                </span>
              </div>
              
              <div className="p-4 rounded-lg bg-muted space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Your Connected Wallet</div>
                  <div className="text-sm font-mono bg-background p-2 rounded border break-all">
                    {connectedAddress}
                  </div>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>
                  ✅ USDC +{' '}
                  {riskProfile.id === 'conservative' ? '0.005' : '0.06'} AVAX being sent to your wallet
                </p>
                {includeErgc && <p>✅ 100 ERGC being sent (qualifies for discount)</p>}
              </div>

              <Button
                onClick={() => {
                  window.location.href = '/';
                }}
                className="w-full"
              >
                Go to Dashboard
              </Button>
            </div>
          )}

          {/* Action Buttons */}
          {!showPaymentForm && !paymentSuccess && (
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
                disabled={isProcessing || !amount || !isConnected || !connectedAddress || !isConfigured || cooldownTime > 0}
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

