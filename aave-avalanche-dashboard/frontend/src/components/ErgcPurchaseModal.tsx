import React, { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, AlertCircle, Zap, ExternalLink, ArrowRight } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SquarePaymentForm } from './stack/SquarePaymentForm';
import { ensureSquareConfigAvailable, getSquareConfig } from '@/lib/square';
import { normalizeWalletAddress, getApiBaseUrl } from '@/lib/utils';

interface ErgcPurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ERGC_PURCHASE_PRICE = 10.00; // $10 for 100 ERGC
const ERGC_PURCHASE_AMOUNT = 100; // 100 ERGC tokens
const UNISWAP_ERGC_POOL = 'https://app.uniswap.org/explore/pools/avalanche/0x3c83d0058e9d1652534be264dba75cfcc2e1d48a3ff1d2c3611a194a361a16ee';

export const ErgcPurchaseModal: React.FC<ErgcPurchaseModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { address: wagmiAddress, isConnected: isWagmiConnected } = useAccount();
  const { authenticated, user } = usePrivy();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [squareConfig, setSquareConfig] = useState(getSquareConfig());
  const { toast } = useToast();

  // Get the most relevant wallet address
  const connectedAddress = wagmiAddress || (authenticated && user?.wallet?.address) || null;
  const userEmail = user?.email?.address || undefined;

  // Check Square configuration
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const config = await ensureSquareConfigAvailable();
        if (config) {
          // Add sdkUrl to match the expected type
          setSquareConfig({
            ...config,
            sdkUrl: config.environment === 'production'
              ? 'https://web.squarecdn.com/v1/square.js'
              : 'https://sandbox.web.squarecdn.com/v1/square.js',
          });
          setIsConfigured(true);
        } else {
          const fallbackConfig = getSquareConfig();
          if (fallbackConfig.applicationId && fallbackConfig.locationId) {
            setSquareConfig(fallbackConfig);
            setIsConfigured(true);
          }
        }
      } catch (error) {
        console.error('[ErgcPurchase] Config check error:', error);
      }
    };

    if (isOpen) {
      checkConfig();
    }
  }, [isOpen]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setPaymentSuccess(false);
      setIsProcessing(false);
    }
  }, [isOpen]);

  const handlePaymentNonce = async (nonce: string) => {
    if (!connectedAddress) {
      toast({
        title: 'Wallet Required',
        description: 'Please connect your wallet to purchase ERGC tokens.',
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);

    try {
      // Normalize wallet address
      const normalizedWallet = normalizeWalletAddress(connectedAddress);
      if (!normalizedWallet) {
        throw new Error('Invalid wallet address');
      }

      // Generate order ID for idempotency
      const orderId = `ergc_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

      console.log('[ErgcPurchase] Processing payment:', {
        walletAddress: normalizedWallet,
        amount: ERGC_PURCHASE_PRICE,
        ergcAmount: ERGC_PURCHASE_AMOUNT,
      });

      // Call ERGC purchase API
      const apiUrl = `${getApiBaseUrl()}/api/ergc/purchase`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_id: nonce,
          wallet_address: normalizedWallet,
          user_email: userEmail,
          idempotency_key: orderId,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Payment processing failed');
      }

      // Payment successful
      setPaymentSuccess(true);
      
      // Store pending ERGC purchase for immediate UI update
      const pendingErgc = {
        amount: 100,
        timestamp: Date.now(),
        walletAddress: normalizedWallet,
        paymentId: result.payment_id
      };
      
      // Store in sessionStorage for immediate dashboard access
      sessionStorage.setItem('pendingErgcPurchase', JSON.stringify(pendingErgc));
      
      toast({
        title: 'Payment successful!',
        description: `100 ERGC added to your balance! View your dashboard to see your updated ERGC holdings.`,
      });

      // Redirect to dashboard after delay to show ERGC balance
      setTimeout(() => {
        onClose();
        // Navigate to dashboard to show ERGC balance (dashboard is at root path)
        window.location.href = '/';
      }, 3000);

    } catch (error: unknown) {
      console.error('[ErgcPurchase] Payment error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Payment processing failed';
      
      toast({
        title: 'Payment failed',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePaymentError = (error: Error) => {
    console.error('[ErgcPurchase] Payment form error:', error);
    toast({
      title: 'Payment form error',
      description: error.message,
      variant: 'destructive',
    });
    setIsProcessing(false);
  };

  // Early return if not open - this prevents hooks from being called
  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-purple-500" />
            Get ERGC Tokens
          </DialogTitle>
          <DialogDescription>
            Choose how you want to purchase ERGC tokens
          </DialogDescription>
        </DialogHeader>

        {!connectedAddress ? (
          <div className="space-y-4 py-4">
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-yellow-500 mb-1">Wallet Required</h4>
                  <p className="text-sm text-muted-foreground">
                    Please connect your wallet to purchase ERGC tokens. The tokens will be sent directly to your connected wallet.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : paymentSuccess ? (
          <div className="space-y-4 py-4">
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-green-500 mb-1">Payment Successful!</h4>
                  <p className="text-sm text-muted-foreground">
                    Your payment has been processed. 100 ERGC tokens have been added to your balance!
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Wallet: {connectedAddress.slice(0, 6)}...{connectedAddress.slice(-4)}
                  </p>
                </div>
              </div>
            </div>
            
            <div className="flex justify-center">
              <Button 
                onClick={() => {
                  onClose();
                  window.location.href = '/';
                }}
                className="bg-gradient-primary text-white hover:opacity-90"
              >
                View ERGC Balance
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6 py-4">
            {/* Left Side: Direct Purchase with Payment Form */}
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-500/20 text-green-500">
                    RECOMMENDED
                  </span>
                  <span className="text-xs text-muted-foreground">Easy</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Buy Direct from TiltVault</h3>
                <div className="mb-4">
                  <div className="text-3xl font-bold text-purple-400 mb-1">$1.00</div>
                  <div className="text-sm text-muted-foreground">for 100 ERGC (fixed price)</div>
                </div>
                
                <div className="space-y-2 mb-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>Instant delivery to your wallet</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>No price uncertainty</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>No gas fees or slippage</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>Unlock free transfers forever</span>
                  </div>
                </div>

                <div className="bg-background/50 rounded-lg p-3 mb-4">
                  <div className="text-xs text-muted-foreground mb-1">Your Wallet:</div>
                  <div className="font-mono text-xs break-all">{connectedAddress}</div>
                </div>

                {isConfigured ? (
                  <div className="space-y-4">
                    <div className="bg-muted/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-muted-foreground">Amount</span>
                        <span className="text-lg font-semibold">${ERGC_PURCHASE_PRICE.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">You'll receive</span>
                        <span className="text-lg font-semibold text-purple-400">{ERGC_PURCHASE_AMOUNT} ERGC</span>
                      </div>
                    </div>

                    <SquarePaymentForm
                      amount={ERGC_PURCHASE_PRICE}
                      onPaymentSuccess={handlePaymentNonce}
                      onPaymentError={handlePaymentError}
                    />

                    {isProcessing && (
                      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing payment...
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                    <p className="text-sm text-muted-foreground">
                      Payment system is being configured. Please try again in a moment.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: DEX Purchase Option */}
            <div className="space-y-4">
              <div className="border border-border rounded-lg p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-orange-500/20 text-orange-500">
                    ADVANCED
                  </span>
                  <span className="text-xs text-muted-foreground">Traders</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Buy on Exchange (DEX)</h3>
                <div className="mb-4">
                  <div className="text-3xl font-bold text-orange-400 mb-1">Variable</div>
                  <div className="text-sm text-muted-foreground">Market price (potential savings or profit)</div>
                </div>
                
                <div className="space-y-2 mb-6 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>Could buy for less than $1</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>Token could appreciate in value</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                    <span>Requires crypto wallet knowledge</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                    <span>Gas fees on Avalanche</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-500 flex-shrink-0" />
                    <span>Price can fluctuate</span>
                  </div>
                </div>

                <a
                  href={UNISWAP_ERGC_POOL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <Button
                    variant="outline"
                    className="w-full border-orange-500/30 text-orange-500 hover:bg-orange-500/10"
                    size="lg"
                  >
                    Trade on Uniswap
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </a>

                <p className="text-xs text-center text-muted-foreground mt-4">
                  You'll need AVAX for gas fees and a connected wallet to trade on DEX
                </p>
              </div>

              {/* Benefits Section */}
              <div className="bg-muted/30 rounded-lg p-4">
                <h4 className="font-semibold mb-2 text-sm">Why Hold 100+ ERGC?</h4>
                <p className="text-xs text-muted-foreground">
                  Holding 100+ ERGC makes deposits over $10 <strong className="text-green-400">completely FREE</strong> - no platform fees!
                </p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
