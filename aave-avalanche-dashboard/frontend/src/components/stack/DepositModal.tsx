import React, { useState, useEffect } from 'react';
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
  const [amount, setAmount] = useState('');
  const [email, setEmail] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentNonce, setPaymentNonce] = useState<string | null>(null);
  const [squareConfig, setSquareConfig] = useState(getSquareConfig());
  const [avaxPrice, setAvaxPrice] = useState<number | null>(null);
  const [includeErgc, setIncludeErgc] = useState(false); // Buy new ERGC option
  const [useExistingErgc, setUseExistingErgc] = useState(false); // Use existing ERGC from wallet
  const [userErgcBalance, setUserErgcBalance] = useState(0); // User's ERGC balance
  const [isCheckingErgc, setIsCheckingErgc] = useState(false);
  const [generatedWallet, setGeneratedWallet] = useState<{ address: string; mnemonic: string; privateKey: string } | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (paymentSuccess && generatedWallet && !walletConnected) {
      // Store wallet in sessionStorage for immediate use
      sessionStorage.setItem('tiltvault_wallet', JSON.stringify({
        address: generatedWallet.address,
        privateKey: generatedWallet.privateKey,
        mnemonic: generatedWallet.mnemonic,
      }));
      
      setWalletConnected(true);
      
      // Auto-redirect to dashboard after 2 seconds
      const timer = setTimeout(() => {
        window.location.href = '/';
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [paymentSuccess, generatedWallet, walletConnected]);

  // ERGC purchase cost ($10 for 100 ERGC)
  const ergcCost = 10;
  const ergcAmount = 100;
  
  // Check if user has enough ERGC for discount (need at least 1)
  const hasErgcForDiscount = userErgcBalance >= 1;

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

  // Check user's ERGC balance when they want to use existing ERGC
  const checkUserErgcBalance = async (walletAddress: string) => {
    setIsCheckingErgc(true);
    try {
      const response = await fetch(`/api/ergc/balance?address=${walletAddress}`);
      if (response.ok) {
        const data = await response.json();
        setUserErgcBalance(data.balance || 0);
        if (data.balance >= 1) {
          setUseExistingErgc(true);
          setIncludeErgc(false); // Don't buy new if using existing
          toast({
            title: 'ERGC Found!',
            description: `You have ${data.balance} ERGC. 1 will be used for fee discount.`,
          });
        } else {
          toast({
            title: 'Insufficient ERGC',
            description: 'You need at least 1 ERGC for the discount. Consider buying 100 ERGC.',
            variant: 'destructive',
          });
        }
      }
    } catch (error) {
      console.error('[DepositModal] Failed to check ERGC balance:', error);
    } finally {
      setIsCheckingErgc(false);
    }
  };

  // Encrypt private key with email + payment ID using Web Crypto API
  const encryptPrivateKey = async (privateKey: string, email: string, paymentId: string): Promise<string> => {
    // Create key from email + payment ID
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      encoder.encode(email + paymentId),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    
    // Derive encryption key
    const key = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('tiltvault-salt'),
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    
    // Encrypt the private key
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(privateKey)
    );
    
    // Combine iv + encrypted data
    const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return btoa(String.fromCharCode(...combined));
  };

  const handleDeposit = async () => {
    // Validate email
    if (!email || !email.includes('@')) {
      toast({
        title: 'Email required',
        description: 'Please enter a valid email address',
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

    const minAmount = riskProfile.id === 'conservative' ? 1 : 10;
    const maxAmount = 100;
    
    if (parseFloat(amount) < minAmount) {
      toast({
        title: 'Amount too low',
        description: `Minimum deposit: $${minAmount.toFixed(2)}`,
        variant: 'destructive',
      });
      return;
    }

    if (parseFloat(amount) > maxAmount) {
      toast({
        title: 'Amount too high',
        description: `Maximum deposit: $${maxAmount.toFixed(2)} per transaction`,
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);

    try {
      // Generate wallet for user (client-side)
      const wallet = EthersWallet.createRandom();
      const walletAddress = wallet.address;
      const privateKey = wallet.privateKey;
      const mnemonic = wallet.mnemonic?.phrase || '';

      if (!mnemonic) {
        throw new Error('Failed to generate wallet');
      }

      // Generate payment ID for encryption
      const paymentId = `payment-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Encrypt private key before sending to backend
      const encryptedPrivateKey = await encryptPrivateKey(privateKey, email, paymentId);

      // Store only encrypted wallet in backend
      const storeResponse = await fetch('/api/wallet/store-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          encryptedPrivateKey,
          userEmail: email,
          riskProfile: riskProfile.id,
          amount: parseFloat(amount),
          paymentId,
        }),
      });

      if (!storeResponse.ok) {
        const errorData = await storeResponse.json();
        throw new Error(errorData.error || 'Failed to store encrypted wallet');
      }

      // Save generated wallet info for immediate use
      setGeneratedWallet({ address: walletAddress, mnemonic, privateKey });

      // Show payment form
      setShowPaymentForm(true);
    } catch (error) {
      console.error('Wallet generation error:', error);
      toast({
        title: 'Setup failed',
        description: error instanceof Error ? error.message : 'Failed to set up wallet',
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
      if (!generatedWallet) {
        throw new Error('Wallet not generated');
      }

      // Process payment directly using SquarePaymentService
      const { squarePaymentService } = await import('@/lib/squarePaymentService');
      const orderId = `order-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Calculate total amount to charge (amount + 5% fee + AVAX fee for all strategies + optional ERGC)
      const platformFee = parseFloat(amount) * 0.05;
      // Use discounted fee if user is buying ERGC OR using existing ERGC OR conservative profile
      const hasErgcDiscount = includeErgc || useExistingErgc || riskProfile.id === 'conservative';
      const avaxFee = hasErgcDiscount ? ERGC_DISCOUNT.DISCOUNTED_FEE : ERGC_DISCOUNT.STANDARD_FEE;
      const avaxFeeUsd = avaxFee * (avaxPrice ?? 30);
      const ergcPurchase = includeErgc ? ergcCost : 0; // Only charge for new ERGC, not existing
      const totalAmount = parseFloat(amount) + platformFee + avaxFeeUsd + ergcPurchase;
      
      const result = await squarePaymentService.processPayment(
        nonce,
        totalAmount,
        orderId,
        riskProfile.id,
        includeErgc,
        useExistingErgc,
        generatedWallet.address,
        email
      );

      if (result.success) {
        
        // Send wallet details email to user
        try {
          const emailResponse = await fetch('/api/wallet/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: email,
              wallet_address: generatedWallet.address,
              mnemonic: generatedWallet.mnemonic,
              name: '', // Optional name field
            }),
          });
          
          const emailData = await emailResponse.json();
          if (!emailData.success) {
            console.error('Email send failed:', emailData.error);
            // Don't fail the whole flow - user can still see wallet on screen
          }
        } catch (emailError) {
          console.error('Email send error:', emailError);
          // Don't fail the whole flow
        }
        
        // Store wallet details for auto-connection
        localStorage.setItem('tiltvault_wallet_address', generatedWallet.address);
        localStorage.setItem('tiltvault_wallet_mnemonic', generatedWallet.mnemonic);
        localStorage.setItem('tiltvault_wallet_email', email);
        
        // Show success with wallet info
        setPaymentSuccess(true);
        
        toast({
          title: 'Payment successful!',
          description: `Your wallet is being funded. You're being logged in automatically!`,
        });
        
        // Don't auto-redirect - let user see their wallet info first
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
          {/* Square Configuration Status */}
          {!paymentSuccess && (
            isConfigured ? (
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
            )
          )}

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
                    <div>Platform Fee: 5% (${(parseFloat(amount) * 0.05).toFixed(2)})</div>
                    <div>Gas Fee ({riskProfile.id === 'conservative' ? ERGC_DISCOUNT.DISCOUNTED_FEE : ((includeErgc || useExistingErgc) ? ERGC_DISCOUNT.DISCOUNTED_FEE : ERGC_DISCOUNT.STANDARD_FEE)} AVAX): ${((riskProfile.id === 'conservative' ? ERGC_DISCOUNT.DISCOUNTED_FEE : ((includeErgc || useExistingErgc) ? ERGC_DISCOUNT.DISCOUNTED_FEE : ERGC_DISCOUNT.STANDARD_FEE)) * (avaxPrice ?? 30)).toFixed(2)}</div>
                    {riskProfile.id !== 'conservative' ? (
                      <div className="text-xs text-muted-foreground">*0.06 AVAX sent to you for execution</div>
                    ) : (
                      <div className="text-xs text-muted-foreground">*0.02 AVAX sent to you for exit fees</div>
                    )}
                    <div className="font-medium text-foreground pt-1">
                      Total Charge: ${(parseFloat(amount) + (parseFloat(amount) * 0.05) + ((riskProfile.id === 'conservative' ? ERGC_DISCOUNT.DISCOUNTED_FEE : ((includeErgc || useExistingErgc) ? ERGC_DISCOUNT.DISCOUNTED_FEE : ERGC_DISCOUNT.STANDARD_FEE)) * (avaxPrice ?? 30))).toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Email Input */}
          {!showPaymentForm && !paymentSuccess && (
            <div className="space-y-2">
              <Label htmlFor="email">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isProcessing}
              />
              <p className="text-xs text-muted-foreground">
                Wallet details will be sent to this email
              </p>
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
                placeholder={riskProfile.id === 'conservative' ? '1.00' : '10.00'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isProcessing}
                min={riskProfile.id === 'conservative' ? 1 : 10}
                max={100}
                step={0.01}
              />
              <p className="text-xs text-muted-foreground">
                Min: ${riskProfile.id === 'conservative' ? '1' : '10'} · Max: $100
              </p>
            </div>
          )}

          {/* ERGC Fee Discount Options - Only show for GMX strategies */}
          {!showPaymentForm && !paymentSuccess && riskProfile.id !== 'conservative' && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground text-center pb-1">
                💡 <span className="font-medium">Optional:</span> Save on gas fees with ERGC
              </div>
              {/* Option 1: Use existing ERGC */}
              <div 
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  useExistingErgc 
                    ? 'bg-green-500/10 border-green-500/50' 
                    : 'bg-muted/50 border-border hover:border-green-500/50'
                }`}
                onClick={() => {
                  if (!useExistingErgc) {
                    // Check balance when selecting this option
                    // For now, just toggle - balance check happens on payment
                    setUseExistingErgc(true);
                    setIncludeErgc(false);
                  } else {
                    setUseExistingErgc(false);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center ${
                    useExistingErgc ? 'bg-green-500 border-green-500' : 'border-muted-foreground'
                  }`}>
                    {useExistingErgc && <span className="text-white text-xs">✓</span>}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Zap className={`w-4 h-4 ${useExistingErgc ? 'text-green-500' : 'text-muted-foreground'}`} />
                      <span className="text-sm font-medium">
                        {useExistingErgc ? 'Using your ERGC!' : 'I have ERGC in my wallet'}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {useExistingErgc 
                        ? `1 ERGC will be used for fee discount - Fee: ${ERGC_DISCOUNT.DISCOUNTED_FEE} AVAX`
                        : `Use 1 ERGC from your wallet for discounted fee`
                      }
                    </p>
                  </div>
                </div>
              </div>

              {/* Option 2: Buy new ERGC */}
              {!useExistingErgc && (
                <div 
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${
                    includeErgc 
                      ? 'bg-green-500/10 border-green-500/50' 
                      : 'bg-yellow-500/10 border-yellow-500/50 hover:border-yellow-500'
                  }`}
                  onClick={() => {
                    setIncludeErgc(!includeErgc);
                    setUseExistingErgc(false);
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center ${
                      includeErgc ? 'bg-green-500 border-green-500' : 'border-yellow-500'
                    }`}>
                      {includeErgc && <span className="text-white text-xs">✓</span>}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Zap className={`w-4 h-4 ${includeErgc ? 'text-green-500' : 'text-yellow-500'}`} />
                        <span className="text-sm font-medium">
                          {includeErgc ? 'ERGC Savings Applied!' : 'Buy ERGC & save on fees'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {includeErgc 
                          ? `+$${ergcCost} for 100 ERGC (1 used now, 99 sent to you) - Fee: ${ERGC_DISCOUNT.DISCOUNTED_FEE} AVAX`
                          : `Add $${ergcCost} for 100 ERGC - reduces fee from ${ERGC_DISCOUNT.STANDARD_FEE} to ${ERGC_DISCOUNT.DISCOUNTED_FEE} AVAX`
                        }
                      </p>
                      {!includeErgc && (
                        <p className="text-xs text-green-600 mt-1">
                          Save 56% on gas fees!
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Savings indicator when any ERGC option is selected */}
              {(includeErgc || useExistingErgc) && (
                <p className="text-xs text-green-600 text-center">
                  ⚡ Saving 56% on gas fees!
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
                  <div className="pt-2 border-t border-border/50 mt-2">
                    <div>Deposit: ${parseFloat(amount).toFixed(2)}</div>
                    <div>Platform Fee (5%): ${(parseFloat(amount) * 0.05).toFixed(2)}</div>
                    <div className="flex items-center gap-1">
                      Gas Fee ({riskProfile.id === 'conservative' ? ERGC_DISCOUNT.DISCOUNTED_FEE : ((includeErgc || useExistingErgc) ? ERGC_DISCOUNT.DISCOUNTED_FEE : ERGC_DISCOUNT.STANDARD_FEE)} AVAX): 
                      ${((riskProfile.id === 'conservative' ? ERGC_DISCOUNT.DISCOUNTED_FEE : ((includeErgc || useExistingErgc) ? ERGC_DISCOUNT.DISCOUNTED_FEE : ERGC_DISCOUNT.STANDARD_FEE)) * (avaxPrice ?? 30)).toFixed(2)}
                      {(includeErgc || useExistingErgc) && <Zap className="w-3 h-3 text-green-500" />}
                    </div>
                    {riskProfile.id !== 'conservative' && includeErgc && (
                      <div className="flex items-center gap-1 text-green-600">
                        <Zap className="w-3 h-3" />
                        100 ERGC (1 used, 99 to you): ${ergcCost.toFixed(2)}
                      </div>
                    )}
                    {riskProfile.id !== 'conservative' && useExistingErgc && (
                      <div className="flex items-center gap-1 text-green-600">
                        <Zap className="w-3 h-3" />
                        Using 1 ERGC from wallet: $0.00
                      </div>
                    )}
                    <div className="font-medium text-foreground pt-1">
                      Total: ${(
                        parseFloat(amount) + 
                        (parseFloat(amount) * 0.05) + 
                        ((riskProfile.id === 'conservative' ? ERGC_DISCOUNT.DISCOUNTED_FEE : ((includeErgc || useExistingErgc) ? ERGC_DISCOUNT.DISCOUNTED_FEE : ERGC_DISCOUNT.STANDARD_FEE)) * (avaxPrice ?? 30)) +
                        (includeErgc ? ergcCost : 0)
                      ).toFixed(2)}
                    </div>
                    {(includeErgc || useExistingErgc) && (
                      <div className="text-xs text-green-600 pt-1">
                        ⚡ Saving 56% on gas fees!
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <SquarePaymentForm
                amount={
                  parseFloat(amount) + 
                  (parseFloat(amount) * 0.05) + 
                  ((riskProfile.id === 'conservative' ? ERGC_DISCOUNT.DISCOUNTED_FEE : ((includeErgc || useExistingErgc) ? ERGC_DISCOUNT.DISCOUNTED_FEE : ERGC_DISCOUNT.STANDARD_FEE)) * (avaxPrice ?? 30)) +
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

          {/* Payment Success - Show wallet info */}
          {paymentSuccess && generatedWallet && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span className="text-sm text-green-600 font-medium">
                  Payment successful! Your wallet is being funded.
                </span>
              </div>
              
              <div className="p-4 rounded-lg bg-muted space-y-3">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Your Wallet Address</div>
                  <div className="text-sm font-mono bg-background p-2 rounded border break-all">
                    {generatedWallet.address}
                  </div>
                </div>
                
                <div className="border-t pt-3">
                  <div className="text-xs text-muted-foreground mb-1">
                    Recovery Phrase (SAVE THIS!)
                  </div>
                  <div className="text-sm font-mono bg-yellow-500/10 border border-yellow-500/30 p-2 rounded break-all">
                    {generatedWallet.mnemonic}
                  </div>
                  <p className="text-xs text-yellow-600 mt-2">
                    ⚠️ Write this down and keep it safe. You'll need it to recover your wallet.
                  </p>
                </div>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>
                  ✅ USDC +{' '}
                  {riskProfile.id === 'conservative' ? '0.02' : '0.06'} AVAX being sent to your wallet
                </p>
                {includeErgc && <p>✅ 99 ERGC being sent (1 used for fee discount)</p>}
                <p>✅ Wallet details sent to {email}</p>
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
                disabled={isProcessing || !amount || !email || !isConfigured}
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

