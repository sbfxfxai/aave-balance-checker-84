import React, { useState, useEffect, useCallback, useRef, startTransition, useMemo } from 'react';
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
import { normalizeWalletAddress, getApiBaseUrl } from '@/lib/utils';
import { storage } from '@/lib/storage';
import {
  ERGC_CONSTANTS,
  DEPOSIT_LIMITS,
  COOLDOWN_CONSTANTS,
  PRICE_CONSTANTS,
  API_TIMEOUTS,
  UI_CONSTANTS,
} from '@/lib/constants';
import {
  calculatePlatformFeeRate,
  calculateEffectiveFeeRate,
  calculatePlatformFee,
  calculateTotalAmount,
  isFreeDeposit,
} from '@/lib/fees';
import { createComponentLogger } from '@/lib/logger';

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

interface Wallet {
  address: string;
  walletClientType: string;
}

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  riskProfile,
}) => {
  // Create component-specific logger
  const log = useMemo(() => createComponentLogger('DepositModal'), []);
  
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
  const [userErgcBalance, setUserErgcBalance] = useState(0); // User's ERGC balance
  const [isCheckingErgc, setIsCheckingErgc] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [cooldownTime, setCooldownTime] = useState<number>(0);
  const [storedPaymentId, setStoredPaymentId] = useState<string | null>(null); // Store paymentId from first step (for UI display)
  const paymentIdRef = useRef<string | null>(null); // CRITICAL: Ref stores paymentId synchronously to avoid race conditions
  const [hubUsdcBalance, setHubUsdcBalance] = useState<number | null>(null); // Hub wallet USDC balance
  const [isLoadingHubBalance, setIsLoadingHubBalance] = useState(false);
  const { toast } = useToast();

  // Get the most relevant wallet address - prioritize Privy for authenticated users
  const connectedAddress = React.useMemo(() => {
    // If user is authenticated with Privy, use Privy wallet
    if (authenticated && ready) {
      const privyWallet = wallets.find((w: Wallet) => w.walletClientType === 'privy');
      if (privyWallet) return privyWallet.address;
      return user?.wallet?.address;
    }
    
    // Fall back to wagmi wallet
    return wagmiAddress;
  }, [authenticated, ready, wallets, user, wagmiAddress]);

  // Check if user has any wallet connected (Privy or wagmi)
  const isConnected = Boolean(connectedAddress && (authenticated || isWagmiConnected));

  // Check if user has enough ERGC for free deposits
  const hasErgcForFreeDeposit = userErgcBalance >= ERGC_CONSTANTS.FREE_DEPOSIT_THRESHOLD;

  // Parse deposit amount once
  const depositAmount = parseFloat(amount) || 0;

  // Memoize fee calculations to prevent expensive recalculations on every render
  // Only recalculates when depositAmount or hasErgcForFreeDeposit changes
  const feeDetails = useMemo(() => {
    const platformFeeRate = calculatePlatformFeeRate(depositAmount);
    const effectivePlatformFeeRate = calculateEffectiveFeeRate(depositAmount, hasErgcForFreeDeposit);
    const platformFee = calculatePlatformFee(depositAmount, hasErgcForFreeDeposit);
    const totalAmount = calculateTotalAmount(depositAmount, hasErgcForFreeDeposit);
    const isFree = isFreeDeposit(depositAmount, hasErgcForFreeDeposit);

    // Debug logging for fee calculation (only when values change)
    log.debug('Fee calculation', {
      amount: depositAmount,
      platformFeeRate,
      hasErgcForFreeDeposit,
      userErgcBalance,
      effectivePlatformFeeRate,
      platformFee,
      totalAmount,
      isFreeDeposit: isFree,
    });

    return {
      platformFeeRate,
      effectivePlatformFeeRate,
      platformFee,
      totalAmount,
      isFree,
    };
  }, [depositAmount, hasErgcForFreeDeposit, userErgcBalance, log]);

  // Destructure fee details for easier access
  const {
    platformFeeRate,
    effectivePlatformFeeRate,
    platformFee,
    totalAmount,
    isFree,
  } = feeDetails;

  // Cooldown logic - 10 minutes between deposits
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const checkCooldown = () => {
      // Check if component is still mounted
      if (cancelled || !connectedAddress) return;

      const lastDepositTime = storage.getLastDepositTime(connectedAddress);
      if (lastDepositTime !== null) {
        const timeSinceLastDeposit = Date.now() - lastDepositTime;
        const cooldownPeriod = COOLDOWN_CONSTANTS.PERIOD_MS;
        const remainingCooldown = Math.max(0, cooldownPeriod - timeSinceLastDeposit);
        
        if (!cancelled) {
          setCooldownTime(remainingCooldown);
        }
        
        if (remainingCooldown > 0 && !cancelled) {
          // Clear any existing timeout
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          
          timeoutId = setTimeout(() => {
            if (!cancelled) {
              setCooldownTime(0);
            }
          }, remainingCooldown);
        }
      } else {
        if (!cancelled) {
          setCooldownTime(0);
        }
      }
    };

    checkCooldown();
    
    // Update cooldown at regular interval
    const interval = setInterval(() => {
      if (!cancelled) {
        checkCooldown();
      }
    }, COOLDOWN_CONSTANTS.CHECK_INTERVAL_MS);
    
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isOpen, connectedAddress]);

  useEffect(() => {
    // Check Square configuration when modal opens
    if (isOpen) {
      // Gate: only fetch once per modal open
      if (priceFetchedRef.current) {
        return;
      }
      priceFetchedRef.current = true;

      let cancelled = false;
      const controller = new AbortController();
      
      const checkConfig = async () => {
        try {
          // Try to get config from API first (production), then fall back to env
          await ensureSquareConfigAvailable();
          const resolvedConfig = getSquareConfig();

          if (cancelled || controller.signal.aborted) return;

          setSquareConfig(resolvedConfig);

          // Check if Square is properly configured (both app ID and location ID required)
          // Use resolved config (which merges API + env vars)
          const hasAppId = !!resolvedConfig.applicationId;
          const hasLocationId = !!resolvedConfig.locationId;
          const configured = hasAppId && hasLocationId;
          
          setIsConfigured(configured);
          
          if (!configured) {
            log.warn('Square config incomplete', {
              hasAppId,
              hasLocationId,
              configAppId: !!resolvedConfig.applicationId,
              configLocationId: !!resolvedConfig.locationId,
            });
          }
        } catch (error) {
          log.error('Error loading Square config', error);
          if (cancelled || controller.signal.aborted) return;
          
          // Fallback to env vars if API fails
          const hasAppId = !!import.meta.env.VITE_SQUARE_APPLICATION_ID;
          const hasLocationId = !!import.meta.env.VITE_SQUARE_LOCATION_ID;
          setIsConfigured(hasAppId && hasLocationId);
        }

        // Fetch AVAX price for fee calculation using our API endpoint with fallbacks
        try {
          const apiBaseUrl = getApiBaseUrl();
          const priceController = new AbortController();
          const timeoutId = setTimeout(() => priceController.abort(), API_TIMEOUTS.SHORT);
          
          // If main controller aborts, also abort price fetch
          if (controller.signal.aborted) {
            priceController.abort();
            clearTimeout(timeoutId);
            return;
          }
          
          const priceResponse = await fetch(`${apiBaseUrl}/api/price/avax`, {
            signal: priceController.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (cancelled || controller.signal.aborted || priceController.signal.aborted) return;
          
          if (!priceResponse.ok) {
            throw new Error(`AVAX price API returned ${priceResponse.status}: ${priceResponse.statusText}`);
          }
          
          const priceData = await priceResponse.json();
          
          if (cancelled || controller.signal.aborted) return;
          
          if (priceData && priceData.success && typeof priceData.price === 'number' && priceData.price > 0) {
            setAvaxPrice(priceData.price);
            log.info('AVAX price fetched from API', { 
              price: priceData.price, 
              source: priceData.source,
              cached: priceData.cached 
            });
          } else {
            throw new Error('Invalid AVAX price data format from API');
          }
        } catch (error) {
          // Silently handle aborts - don't log as error
          if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted') || error.message.includes('timeout'))) {
            return; // Don't update state if aborted
          }
          
          log.error('Failed to fetch AVAX price from API, using fallback', error);
          if (!cancelled && !controller.signal.aborted) {
            setAvaxPrice(PRICE_CONSTANTS.AVAX_FALLBACK_PRICE_USD);
          }
        }
      };

      checkConfig();

      return () => {
        cancelled = true;
        controller.abort();
      };
    } else {
      // Reset gate when modal closes
      priceFetchedRef.current = false;
    }
  }, [isOpen, log]); // Removed toast and log from dependencies

  // Reset paymentId ref and fetch gates when modal closes to prevent stale data
  useEffect(() => {
    if (!isOpen) {
      paymentIdRef.current = null;
      ergcFetchedRef.current = false;
      hubBalanceFetchedRef.current = false;
      priceFetchedRef.current = false;
      // Batch state updates to prevent unnecessary re-renders
      startTransition(() => {
        setStoredPaymentId(null);
        setShowPaymentForm(false);
        setPaymentSuccess(false);
        setAmount('');
        setIsProcessing(false);
      });
    }
  }, [isOpen]);

  // Refs to prevent duplicate fetches
  const ergcFetchedRef = useRef<boolean>(false);
  const hubBalanceFetchedRef = React.useRef<string | false>(false);
  const priceFetchedRef = useRef<boolean>(false);

  // Check user's ERGC balance (free deposits if 100+)
  const checkUserErgcBalance = useCallback(async (walletAddress: string, signal: AbortSignal) => {
    if (!walletAddress || signal.aborted) {
      return;
    }
    
    setIsCheckingErgc(true);
    const timeoutId = setTimeout(() => {
      if (!signal.aborted) {
        // Timeout handled by AbortController in effect
      }
    }, API_TIMEOUTS.STANDARD);
    
    try {
      log.debug('Checking ERGC balance', { walletAddress });
      
      const response = await fetch(`/api/ergc/balance?address=${walletAddress}`, {
        signal,
      });
      
      clearTimeout(timeoutId);
      
      if (signal.aborted) {
        return;
      }
      
      if (!response.ok) {
        throw new Error(`ERGC balance API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Check if request was aborted after JSON parse
      if (signal.aborted) {
        return;
      }
      
      // Validate response structure
      if (data && typeof data === 'object') {
        const balance = typeof data.balance === 'number' ? data.balance : 0;
        log.debug('ERGC balance response', { balance, data });
        
        // Batch state update with toast notification
        startTransition(() => {
          setUserErgcBalance(balance);
          
          if (balance >= ERGC_CONSTANTS.FREE_DEPOSIT_THRESHOLD) {
            toast({
              title: 'ERGC Found!',
              description: `You have ${balance} ERGC. Deposits over $100 are FREE!`,
            });
          }
        });
      } else {
        log.warn('Invalid ERGC balance response format', { data });
        startTransition(() => {
          setUserErgcBalance(0);
        });
      }
    } catch (error) {
      // Check if request was aborted - silently return, don't log as error
      if (signal.aborted || (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted')))) {
        return; // Don't update state if aborted
      }
      
      // Don't show error toast for network errors - it's not critical
      log.error('Failed to check ERGC balance', error);
      
      // Reset to 0 on error (user doesn't have ERGC or check failed)
      startTransition(() => {
        setUserErgcBalance(0);
      });
    } finally {
      clearTimeout(timeoutId);
      if (!signal.aborted) {
        startTransition(() => {
          setIsCheckingErgc(false);
        });
      }
    }
  }, [log, toast]);

  // Auto-check ERGC balance when wallet is connected (only once per modal open)
  useEffect(() => {
    if (!isOpen || !isConnected || !connectedAddress) {
      ergcFetchedRef.current = false;
      return;
    }

    // Gate: only fetch once per modal open
    if (ergcFetchedRef.current) {
      return;
    }
    ergcFetchedRef.current = true;

    const controller = new AbortController();
    checkUserErgcBalance(connectedAddress, controller.signal);
    
    return () => {
      controller.abort();
    };
  }, [isOpen, isConnected, connectedAddress, checkUserErgcBalance]);

  // Fetch hub wallet USDC balance when modal opens
  // For Morpho profile, check Arbitrum USDC balance; for others, check Avalanche
  useEffect(() => {
    if (!isOpen) {
      hubBalanceFetchedRef.current = false;
      return;
    }

    // Gate: only fetch once per modal open (or when risk profile changes)
    const fetchKey = `${isOpen}-${riskProfile.id}`;
    if (hubBalanceFetchedRef.current === fetchKey) {
      return;
    }
    hubBalanceFetchedRef.current = fetchKey;

    let cancelled = false;
    let controller: AbortController | null = null;
    let timeoutId: NodeJS.Timeout | null = null;

    // Determine which chain to check based on risk profile (outside try block for error handling)
    const chain = riskProfile.id === 'morpho' ? 'arbitrum' : 'avalanche';

    const fetchHubBalance = async () => {
      if (cancelled) return;
      
      setIsLoadingHubBalance(true);
      const currentController = new AbortController();
      controller = currentController;
      timeoutId = setTimeout(() => currentController.abort(), API_TIMEOUTS.STANDARD);
      
      try {
        const apiBaseUrl = getApiBaseUrl();
        const response = await fetch(`${apiBaseUrl}/api/hub/balance?chain=${chain}`, {
          signal: currentController.signal,
        });
        
        if (cancelled || currentController.signal.aborted) return;
        
        if (!response.ok) {
          throw new Error(`Hub balance API returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (cancelled || currentController.signal.aborted) return;
        
        // Validate response structure
        if (data && typeof data === 'object' && data.success && typeof data.balance === 'number') {
          const balance = Math.floor(data.balance);
          log.info('Hub USDC balance fetched', { chain, balance });
          startTransition(() => {
            setHubUsdcBalance(balance);
          });
        } else {
          log.warn('Hub balance API returned invalid response', { chain, data });
          if (!cancelled) {
            startTransition(() => {
              setHubUsdcBalance(DEPOSIT_LIMITS.HUB_BALANCE_FALLBACK);
            });
          }
        }
      } catch (error) {
        // Silently handle aborts - don't log as error
        if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))) {
          return; // Don't update state if aborted
        }
        
        log.error('Failed to fetch hub balance', error, { chain });
        
        // Fallback to default if fetch fails
        if (!cancelled) {
          startTransition(() => {
            setHubUsdcBalance(DEPOSIT_LIMITS.HUB_BALANCE_FALLBACK);
          });
        }
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (controller === currentController) {
          controller = null;
        }
        if (!cancelled) {
          startTransition(() => {
            setIsLoadingHubBalance(false);
          });
        }
      }
    };

    fetchHubBalance();

    return () => {
      cancelled = true;
      // Abort the fetch request if it's still in progress
      if (controller) {
        controller.abort();
        controller = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isOpen, riskProfile.id, log]);

  // Calculate max deposit amount: min(hub balance, MAX_DEPOSIT)
  // If hub balance is less than MAX_DEPOSIT, use hub balance; otherwise cap at MAX_DEPOSIT
  const maxDepositAmount = hubUsdcBalance !== null 
    ? Math.min(hubUsdcBalance, DEPOSIT_LIMITS.MAX_DEPOSIT)
    : DEPOSIT_LIMITS.MAX_DEPOSIT;


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
    // TEMPORARY: MIN_DEPOSIT is $1 for Morpho testing, will revert to $10 after testing
    if (depositAmount < DEPOSIT_LIMITS.MIN_DEPOSIT) {
      toast({
        title: 'Minimum deposit required',
        description: `Minimum deposit amount is $${DEPOSIT_LIMITS.MIN_DEPOSIT}`,
        variant: 'destructive',
      });
      return;
    }
    
    if (depositAmount > maxDepositAmount) {
      toast({
        title: 'Maximum deposit exceeded',
        description: `Maximum deposit amount is $${maxDepositAmount.toLocaleString()}`,
        variant: 'destructive',
      });
      return;
    }

    setIsProcessing(true);

    try {
      // SECURITY: Generate payment ID first (validated format)
      const paymentId = `payment-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // CRITICAL: Store paymentId in ref immediately (synchronous) to avoid race conditions
      // This ensures handlePaymentNonce can access it even if state hasn't updated yet
      paymentIdRef.current = paymentId;
      // Batch state update to prevent unnecessary re-render
      startTransition(() => {
        setStoredPaymentId(paymentId); // Also update state for UI display
      });
      
      // CRITICAL: Validate and normalize wallet address
      // Both payment_info and payment note must use the same normalized format
      const normalizedWallet = normalizeWalletAddress(connectedAddress);
      
      log.success('Wallet address validated', {
        original: connectedAddress,
        normalized: normalizedWallet
      });
      
      // Get email from secure storage (sessionStorage) if available (optional, for payment info)
      const userEmail = storage.getUserEmail();

      // Store payment info with normalized wallet address (for webhook)
      // CRITICAL: Use normalized wallet address to match payment note format
      const apiBaseUrl = getApiBaseUrl();
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.STANDARD);
        
        const paymentInfoResponse = await fetch(`${apiBaseUrl}/api/wallet/store-payment-info`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentId,
            walletAddress: normalizedWallet, // Use normalized wallet address
            userEmail: userEmail || undefined, // Optional - only if user is logged in
            riskProfile: riskProfile.id,
            amount: parseFloat(amount),
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!paymentInfoResponse.ok) {
          let errorMessage = `HTTP ${paymentInfoResponse.status}`;
          try {
            const errorData = await paymentInfoResponse.json();
            errorMessage = errorData.error || errorMessage;
          } catch {
            // Ignore JSON parse errors
          }
          throw new Error(errorMessage);
        }
        
        const responseData = await paymentInfoResponse.json().catch(() => ({}));
        log.success('Payment info stored successfully', { paymentId, responseData });
      } catch (error) {
        // Payment info storage failure is not critical - webhook can still process payment
        // But we should log it and warn the user
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.warn('Failed to store payment info', { errorMessage, paymentId });
        toast({
          title: 'Warning',
          description: 'Payment info storage failed, but deposit will continue. If payment fails, contact support.',
          variant: 'destructive',
        });
      }

      toast({
        title: 'Using connected wallet',
        description: `Deposits will be sent to ${normalizedWallet.slice(0, 6)}...${normalizedWallet.slice(-4)}`,
      });

      // Show payment form (batch with other state updates if any)
      startTransition(() => {
        setShowPaymentForm(true);
      });
    } catch (error) {
      log.error('Deposit setup error', error);
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
    // Batch related state updates
    startTransition(() => {
      setPaymentNonce(nonce);
      setIsProcessing(true);
    });
    
    try {
      // REQUIRE: Web3 wallet must be connected
      if (!isConnected || !connectedAddress) {
        throw new Error('Wallet not connected');
      }

      // Process payment directly using SquarePaymentService
      const { squarePaymentService } = await import('@/lib/squarePaymentService');
      const orderId = `order-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      // Calculate total amount to charge using centralized fee calculation
      // Use memoized fee details (already calculated and up-to-date)
      const currentDepositAmount = depositAmount;
      const currentTotalAmount = totalAmount;
      const currentPlatformFee = platformFee;
      
      // Get email from secure storage (sessionStorage) if available (optional)
      const userEmail = storage.getUserEmail();
      
      // CRITICAL: Get paymentId from ref (synchronous, avoids race condition)
      // Fallback to state if ref is null (shouldn't happen, but defensive)
      // Final fallback: generate new paymentId (shouldn't happen in normal flow)
      const paymentId = paymentIdRef.current || storedPaymentId || `payment-${Date.now()}-${Math.random().toString(36).substring(7)}`;
      
      if (!paymentIdRef.current && !storedPaymentId) {
        log.warn('PaymentId not found in ref or state - this indicates a race condition or flow issue', { paymentId });
        log.warn('Generated new paymentId as fallback', { paymentId });
      }
      
      // CRITICAL: Validate and normalize wallet address
      // Both payment_info and payment note must use the same normalized format
      const normalizedWallet = normalizeWalletAddress(connectedAddress);
      
      log.success('Wallet address validated for payment', {
        original: connectedAddress,
        normalized: normalizedWallet,
        paymentId,
        paymentIdSource: paymentIdRef.current ? 'ref' : storedPaymentId ? 'state' : 'generated'
      });
      
      // Payment info should already be stored in handleDeposit, but verify it exists
      // If not stored (e.g., user skipped first step or race condition), store it now
      if (!paymentIdRef.current && !storedPaymentId) {
        log.warn('Payment info not stored in first step, storing now', { paymentId });
        const apiBaseUrl = getApiBaseUrl();
        
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUTS.STANDARD);
          
          const paymentInfoResponse = await fetch(`${apiBaseUrl}/api/wallet/store-payment-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paymentId,
              walletAddress: normalizedWallet, // Use normalized wallet address
              userEmail: userEmail || undefined,
              riskProfile: riskProfile.id,
              amount: parseFloat(amount),
            }),
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (!paymentInfoResponse.ok) {
            let errorMessage = `HTTP ${paymentInfoResponse.status}`;
            try {
              const errorData = await paymentInfoResponse.json();
              errorMessage = errorData.error || errorMessage;
            } catch {
              // Ignore JSON parse errors
            }
            throw new Error(errorMessage);
          }
          
          const responseData = await paymentInfoResponse.json().catch(() => ({}));
          log.success('Payment info stored successfully', { responseData, paymentId });
          
          // Update ref and state for consistency (batch state update)
          paymentIdRef.current = paymentId;
          startTransition(() => {
            setStoredPaymentId(paymentId);
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          log.error('Failed to store payment info before payment', error, { errorMessage, paymentId });
          // Don't throw - continue with payment even if storage fails
          // The webhook may still be able to process the payment from the note field
        }
      }

      // CRITICAL: Log wallet address being sent to payment note
      log.success('Processing payment', {
        paymentId,
        walletAddress: normalizedWallet,
        riskProfile: riskProfile.id,
        amount: currentTotalAmount,
        note: `payment_id:${paymentId} wallet:${normalizedWallet} risk:${riskProfile.id}`
      });
      
      const result = await squarePaymentService.processPayment(
        nonce,
        currentTotalAmount,
        orderId,
        riskProfile.id,
        false, // ERGC purchase removed - users can get ERGC from pools
        normalizedWallet, // Use normalized wallet address (lowercase)
        userEmail || undefined, // Optional email
        paymentId // Pass paymentId so it can be included in payment note
      );

      if (result.success) {
        // Save deposit time for cooldown (non-sensitive, uses localStorage)
        storage.setLastDepositTime(connectedAddress, Date.now());
        
        // Batch success state update
        startTransition(() => {
          setPaymentSuccess(true);
        });
        
        toast({
          title: 'Payment successful!',
          description: `Funds will be sent to your connected wallet: ${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`,
        });
        
        // Auto-redirect to dashboard after delay
        setTimeout(() => {
          window.location.href = '/';
        }, UI_CONSTANTS.REDIRECT_DELAY_MS);
      } else {
        throw new Error(result.error || 'Payment processing failed');
      }
    } catch (error: unknown) {
      log.error('Payment processing error', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to process payment. Please try again.';
      toast({
        title: 'Payment failed',
        description: errorMessage,
        variant: 'destructive',
      });
      // Batch cleanup state updates
      startTransition(() => {
        setIsProcessing(false);
        setShowPaymentForm(false);
      });
    }
  };

  const handlePaymentError = useCallback((error: Error) => {
    log.error('Payment form error', error);
    toast({
      title: 'Payment failed',
      description: error.message || 'Failed to process payment. Please try again.',
      variant: 'destructive',
    });
    // Batch cleanup state updates
    startTransition(() => {
      setIsProcessing(false);
      setShowPaymentForm(false);
    });
  }, [log, toast]);


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        className="w-[95vw] max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6" 
        data-testid="deposit-modal"
        aria-labelledby="deposit-modal-title"
        aria-describedby="deposit-modal-description"
      >
        <DialogHeader>
          <DialogTitle id="deposit-modal-title" className="text-lg sm:text-xl">Complete Your Deposit</DialogTitle>
          <DialogDescription id="deposit-modal-description" className="text-sm">
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
                      {isFree ? (
                        <span className="text-green-600">Total Fee: FREE</span>
                      ) : (
                        <>Total Fee: ${platformFee.toFixed(2)}</>
                      )}
                    </div>
                    <details className="mt-1">
                      <summary 
                        className="text-xs text-muted-foreground cursor-pointer hover:text-foreground"
                        aria-label="Expand fee details"
                      >
                        Fee details
                      </summary>
                      <div className="mt-2 text-xs text-muted-foreground space-y-1 pl-4">
                        {isFree ? (
                          <div className="text-green-600 font-medium">
                            Platform Fee: 0% (FREE - You have 100+ ERGC and deposit is over $100)
                          </div>
                        ) : (
                          <div>Platform Fee: {(effectivePlatformFeeRate * 100).toFixed(1)}% (${platformFee.toFixed(2)})</div>
                        )}
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
                placeholder="1.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isProcessing || isLoadingHubBalance}
                min={1}
                max={maxDepositAmount}
                step={0.01}
                aria-describedby="amount-help amount-cooldown"
                aria-required="true"
              />
              <p id="amount-help" className="text-xs text-muted-foreground">
                Min: $1 · Max: ${maxDepositAmount.toLocaleString()}
                {isLoadingHubBalance && (
                  <span aria-live="polite" aria-atomic="true"> (loading...)</span>
                )}
              </p>
              {cooldownTime > 0 && (
                <p id="amount-cooldown" className="text-xs text-orange-600" role="status" aria-live="polite">
                  ⏱️ Cooldown: {Math.ceil(cooldownTime / 60000)}m {Math.ceil((cooldownTime % 60000) / 1000)}s remaining
                </p>
              )}
            </div>
          )}

          {/* ERGC Cost/Savings Calculator - Show if user doesn't have 100+ ERGC */}
          {!showPaymentForm && !paymentSuccess && !hasErgcForFreeDeposit && depositAmount >= 100 && avaxPrice && (
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/50">
              <div className="flex items-center gap-2 mb-3">
                <Zap className="w-4 h-4 text-blue-500" aria-hidden="true" />
                <span className="text-sm font-medium text-blue-600">
                  💰 ERGC Free Deposits - Save Money!
                </span>
              </div>
              <div className="space-y-2 text-xs">
                {(() => {
                  const ergcCostAvax = 0.21; // From transaction: 0.21 AVAX for 100 ERGC
                  const ergcCostUsd = ergcCostAvax * (avaxPrice || PRICE_CONSTANTS.AVAX_FALLBACK_PRICE_USD);
                  // Calculate fee without ERGC (use base platform fee rate)
                  const feeWithoutErgc = depositAmount * platformFeeRate;
                  const breakEvenDeposits = feeWithoutErgc > 0 ? Math.ceil(ergcCostUsd / feeWithoutErgc) : 0;
                  
                  return (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">100 ERGC Cost:</span>
                        <span className="font-medium">~{ergcCostAvax} AVAX (~${ergcCostUsd.toFixed(2)})</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Platform Fee (${depositAmount} deposit):</span>
                        <span className="font-medium text-red-600">${feeWithoutErgc.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t border-border/50 pt-2">
                        <span className="text-muted-foreground">With 100 ERGC (FREE):</span>
                        <span className="font-medium text-green-600">$0.00</span>
                      </div>
                      <div className="flex justify-between pt-1">
                        <span className="text-muted-foreground">You Save:</span>
                        <span className="font-bold text-green-600">${feeWithoutErgc.toFixed(2)}</span>
                      </div>
                      <div className="pt-2 border-t border-border/50 text-muted-foreground">
                        <p className="text-xs">
                          💡 <strong>Break-even:</strong> After {breakEvenDeposits} deposit{breakEvenDeposits > 1 ? 's' : ''}, ERGC pays for itself!
                        </p>
                        <p className="text-xs mt-1">
                          Buy 100 ERGC on <a 
                            href="https://app.uniswap.org/swap?chain=avalanche&inputCurrency=AVAX&outputCurrency=0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B" 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="text-blue-500 hover:underline"
                            aria-label="Buy 100 ERGC on Uniswap to unlock free deposits (opens in new tab)"
                          >Uniswap</a> to unlock free deposits.
                        </p>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ERGC Free Deposit Indicator - Show if user has 100+ ERGC */}
          {!showPaymentForm && !paymentSuccess && hasErgcForFreeDeposit && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/50">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-green-500" aria-hidden="true" />
                <span className="text-sm font-medium text-green-600">
                  ⚡ Free Deposits Active
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                You have {userErgcBalance} ERGC. Deposits over $100 are FREE (no platform fees)!
              </p>
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
                      {isFree ? (
                        <span className="text-green-600">Total Fee: FREE</span>
                      ) : (
                        <>Total Fee: ${platformFee.toFixed(2)}</>
                      )}
                    </div>
                    <details className="mt-1">
                      <summary 
                        className="text-xs text-muted-foreground cursor-pointer hover:text-foreground"
                        aria-label="Expand fee details"
                      >
                        Fee details
                      </summary>
                      <div className="mt-2 text-xs text-muted-foreground space-y-1 pl-4">
                        {isFree ? (
                          <div className="text-green-600 font-medium">
                            Platform Fee: 0% (FREE - You have 100+ ERGC and deposit is over $100)
                          </div>
                        ) : (
                          <div>Platform Fee: {(effectivePlatformFeeRate * 100).toFixed(1)}% (${platformFee.toFixed(2)})</div>
                        )}
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
                  (parseFloat(amount) * effectivePlatformFeeRate)
                }
                onPaymentSuccess={handlePaymentNonce}
                onPaymentError={handlePaymentError}
              />
            </div>
          )}

          {/* Processing State */}
          {isProcessing && !paymentSuccess && (
            <div 
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Processing payment...</span>
            </div>
          )}

          {/* Payment Success */}
          {paymentSuccess && isConnected && connectedAddress && (
            <div className="space-y-4">
              <div 
                className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <CheckCircle2 className="h-5 w-5 text-green-600" aria-hidden="true" />
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
                  ✅{' '}
                  {riskProfile.id === 'morpho' 
                    ? 'USDC being deposited to Morpho vaults on Arbitrum (no AVAX needed)'
                    : riskProfile.id === 'conservative'
                    ? 'USDC + 0.005 AVAX being sent to your wallet'
                    : 'USDC + 0.06 AVAX being sent to your wallet'
                  }
                </p>
              </div>

              <Button
                onClick={() => {
                  window.location.href = '/';
                }}
                className="w-full"
                aria-label="Go to dashboard to view your positions"
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
                aria-label="Cancel deposit and close modal"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeposit}
                disabled={isProcessing || !amount || !isConnected || !connectedAddress || !isConfigured || cooldownTime > 0}
                className="flex-1"
                data-testid="continue-to-payment-button"
                aria-label="Continue to payment form"
                aria-describedby={!isConnected ? "wallet-connection-required" : !amount ? "amount-required" : cooldownTime > 0 ? "cooldown-active" : undefined}
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
                  // Batch state updates to prevent unnecessary re-renders
                  startTransition(() => {
                    setShowPaymentForm(false);
                    setIsProcessing(false);
                  });
                }}
                disabled={isProcessing}
                className="flex-1"
                aria-label="Go back to deposit amount input"
              >
                Back
              </Button>
              {isProcessing && (
                <div 
                  className="flex-1 flex items-center justify-center text-sm text-muted-foreground"
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Processing payment...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

