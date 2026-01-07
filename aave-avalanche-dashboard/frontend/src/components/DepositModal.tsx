import React, { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, usePublicClient } from 'wagmi';
import { parseEther, formatEther, parseUnits, formatUnits } from 'viem';
import { avalanche } from 'wagmi/chains';
import { CONTRACTS, ERC20_ABI, AAVE_POOL_ABI, AAVE_POOL_ADDRESSES_PROVIDER_ABI } from '@/config/contracts';
import { toast } from 'sonner';
import { Loader2, ArrowDown, Plus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getExplorerTxLink } from '@/lib/blockchain';
import { TRADER_JOE_ROUTER_ABI } from '@/lib/constants';
import { parseError, getErrorMessage } from '@/utils/errorParser';

export function DepositModal() {
  const [amount, setAmount] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<'swap' | 'approve' | 'supply'>('swap');
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: avalanche.id });
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [isLoading, setIsLoading] = useState(false);
  const [expectedUsdc, setExpectedUsdc] = useState<string>('');
  const [minUsdc, setMinUsdc] = useState<string>('');
  const [slippageTolerance] = useState(0.5); // 0.5% default slippage tolerance

  // Calculate expected USDC output using getAmountsOut
  const amountInWei = amount ? (() => {
    try {
      return parseEther(amount);
    } catch {
      return 0n;
    }
  })() : 0n;

  const { data: amountsOut, isLoading: isCalculatingQuote } = useReadContract({
    address: CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`,
    abi: TRADER_JOE_ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: amountInWei > 0n ? [amountInWei, [CONTRACTS.WAVAX, CONTRACTS.USDC]] : undefined, // Swap to native USDC for Aave V3
    query: {
      enabled: !!amount && amountInWei > 0n && step === 'swap',
      refetchInterval: 10_000, // Refresh quote every 10 seconds
    },
  });

  // Update expected USDC when quote changes
  useEffect(() => {
    if (amountsOut && Array.isArray(amountsOut) && amountsOut.length >= 2) {
      const expectedAmountWei = amountsOut[amountsOut.length - 1] as bigint; // Last element is USDC output
      const expectedFormatted = formatUnits(expectedAmountWei, 6);
      setExpectedUsdc(expectedFormatted);

      // Calculate minimum with slippage protection
      const slippageMultiplier = BigInt(Math.floor((100 - slippageTolerance) * 100)); // e.g., 9950 for 0.5% slippage
      const minAmountWei = (expectedAmountWei * slippageMultiplier) / 10000n;
      setMinUsdc(formatUnits(minAmountWei, 6));
    } else {
      setExpectedUsdc('');
      setMinUsdc('');
    }
  }, [amountsOut, slippageTolerance]);

  // Transaction hooks
  const { writeContractAsync } = useWriteContract({
    mutation: {
      onError: (error) => {
        console.error('Transaction error:', error);
        setError(error.message);
        toast.error(`Transaction failed: ${error.message || 'Unknown error'}`);
      },
    },
  });
  const { data: swapReceipt, isLoading: isSwapLoading } = useWaitForTransactionReceipt({
    hash: txHash!,
    query: {
      enabled: !!txHash && step === 'swap',
    },
  });
  const { data: approveReceipt, isLoading: isApproveLoading } = useWaitForTransactionReceipt({
    hash: txHash!,
    query: {
      enabled: !!txHash && step === 'approve',
    },
  });
  const { data: supplyReceipt, isLoading: isSupplyLoading } = useWaitForTransactionReceipt({
    hash: txHash!,
    query: {
      enabled: !!txHash && step === 'supply',
    },
  });

  // Reset state when modal is closed
  const resetState = useCallback(() => {
    setAmount('');
    setStep('swap');
    setError(null);
    setTxHash(null);
    setIsLoading(false);
    setExpectedUsdc('');
    setMinUsdc('');
  }, []);

  const onOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      resetState();
    }
  };

  // Fetch USDC balance
  const fetchUsdcBalance = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      const balance = await publicClient.readContract({
        address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      setUsdcBalance(balance as bigint);
    } catch (error) {
      console.error('Error fetching USDC balance:', error);
      setError('Failed to fetch USDC balance');
    }
  }, [address, publicClient]);

  // Fetch allowance
  const fetchAllowance = useCallback(async () => {
    if (!address || !publicClient) return;
    try {
      // Get the dynamic Pool address first
      const poolAddress = await publicClient.readContract({
        address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
        abi: AAVE_POOL_ADDRESSES_PROVIDER_ABI,
        functionName: 'getPool',
      }) as `0x${string}`;

      const allowance = await publicClient.readContract({
        address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, poolAddress],
      });
      setAllowance(allowance as bigint);
    } catch (error) {
      console.error('Error fetching allowance:', error);
      setError('Failed to fetch token allowance');
    }
  }, [address]);

  // Set up polling for data
  useEffect(() => {
    if (!isOpen) return;

    fetchUsdcBalance();
    fetchAllowance();

    const interval = setInterval(() => {
      fetchUsdcBalance();
      fetchAllowance();
    }, 10000);

    return () => clearInterval(interval);
  }, [fetchUsdcBalance, fetchAllowance, isOpen]);

  // Check if user has USDC that needs depositing (recovery mechanism)
  const [hasUndepositedUsdc, setHasUndepositedUsdc] = useState(false);
  
  const checkForUndepositedUsdc = useCallback(async () => {
    if (!address || !publicClient) return false;
    
    try {
      const balance = await publicClient.readContract({
        address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      
      // If user has USDC but we're not in the middle of a deposit flow
      if (balance > 0n && step === 'swap' && !isLoading) {
        setHasUndepositedUsdc(true);
        return balance;
      } else {
        setHasUndepositedUsdc(false);
      }
    } catch (error) {
      console.error('Error checking USDC balance:', error);
      setHasUndepositedUsdc(false);
    }
    
    return false;
  }, [address, step, isLoading]);

  // Auto-detect and prompt for incomplete deposits
  useEffect(() => {
    if (isOpen && address) {
      checkForUndepositedUsdc().then(balance => {
        if (balance && balance > 0n) {
          const amount = parseFloat(formatUnits(balance, 6)).toFixed(6);
          toast.info(`You have ${amount} USDC ready to deposit to Aave. Click "Deposit" to complete.`, {
            duration: 8000,
            action: {
              label: 'Complete Deposit',
              onClick: () => {
                setStep('approve');
                setUsdcBalance(balance);
              },
            },
          });
        }
      });
    }
  }, [isOpen, address, checkForUndepositedUsdc]);

  // Handle transaction receipts
  useEffect(() => {
    if (swapReceipt && step === 'swap') {
      if (swapReceipt.status === 'success') {
        toast.success('Swap completed successfully!');
        setStep('approve');
        setTxHash(null);
        // Refresh USDC balance after swap
        fetchUsdcBalance();
      } else if (swapReceipt.status === 'reverted') {
        setError('Transaction failed');
        setIsLoading(false);
      }
    }
  }, [swapReceipt, step, resetState, fetchUsdcBalance]);

  useEffect(() => {
    if (approveReceipt && step === 'approve') {
      if (approveReceipt.status === 'success') {
        toast.success('Approval completed!');
        const maxUint256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        setAllowance(maxUint256);
        setStep('supply');
        setTxHash(null);
      } else if (approveReceipt.status === 'reverted') {
        setError('Approval transaction failed');
        setIsLoading(false);
      }
    }
  }, [approveReceipt, step, resetState]);

  useEffect(() => {
    if (supplyReceipt && step === 'supply') {
      if (supplyReceipt.status === 'success') {
        toast.success('Supply completed successfully!');
        setIsOpen(false);
        resetState();
      } else if (supplyReceipt.status === 'reverted') {
        setError('Supply transaction failed');
        setIsLoading(false);
      }
    }
  }, [supplyReceipt, step, resetState]);

  const handleSwap = async () => {
    if (!amount || !address || !chainId) {
      setError('Please connect your wallet and enter an amount');
      return;
    }

    // Network guard: Ensure user is on Avalanche C-Chain
    if (chainId !== avalanche.id) {
      setError('Please switch to Avalanche C-Chain to perform swaps');
      toast.error('Wrong network. Please switch to Avalanche C-Chain.', {
        duration: 8000,
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Validate and parse amount using BigInt for precision
      const amountInWei = parseEther(amount);
      if (amountInWei <= 0n) {
        setError('Amount must be greater than 0');
        setIsLoading(false);
        return;
      }
      const path = [CONTRACTS.WAVAX, CONTRACTS.USDC]; // Swap to native USDC for Aave V3
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20); // 20 minutes

      // Calculate minimum amount out with slippage protection
      let amountOutMin = 0n;
      if (amountsOut && Array.isArray(amountsOut) && amountsOut.length >= 2) {
        const expectedAmountWei = amountsOut[amountsOut.length - 1] as bigint;
        // Apply slippage tolerance (0.5% default)
        const slippageMultiplier = BigInt(Math.floor((100 - slippageTolerance) * 100));
        amountOutMin = (expectedAmountWei * slippageMultiplier) / 10000n;
        
        if (amountOutMin <= 0n) {
          setError('Unable to calculate swap quote. Please try again.');
          setIsLoading(false);
          return;
        }
      } else {
        setError('Unable to fetch swap quote. Please try again.');
        setIsLoading(false);
        return;
      }

      const txHash = await writeContractAsync({
        address: CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`,
        abi: TRADER_JOE_ROUTER_ABI,
        functionName: 'swapExactAVAXForTokens',
        args: [
          amountOutMin,
          path,
          address,
          deadline,
        ],
        value: amountInWei,
      });

      setTxHash(txHash);
      toast.success('Swap transaction sent!', {
        action: {
          label: 'View on Explorer',
          onClick: () => window.open(getExplorerTxLink(chainId || 43114, txHash), '_blank'),
        },
      });
    } catch (error) {
      console.error('Swap error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to execute swap';
      setError(errorMessage);
      toast.error(`Swap failed: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!usdcBalance || !address) {
      setError('Missing balance or wallet connection');
      return;
    }

    // Network guard: Ensure user is on Avalanche C-Chain
    if (chainId !== avalanche.id) {
      setError('Please switch to Avalanche C-Chain');
      toast.error('Wrong network. Please switch to Avalanche C-Chain.', {
        duration: 8000,
      });
      return;
    }

    if (!publicClient) {
      setError('Public client not available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get the dynamic Pool address
      const poolAddress = await publicClient.readContract({
        address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
        abi: AAVE_POOL_ADDRESSES_PROVIDER_ABI,
        functionName: 'getPool',
      }) as `0x${string}`;

      // Use the maximum uint256 value for unlimited approval
      const maxUint256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");

      const txHash = await writeContractAsync({
        address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [poolAddress, maxUint256],
      });

      setTxHash(txHash);
      toast.success('Approval transaction sent!', {
        action: {
          label: 'View on Explorer',
          onClick: () => window.open(getExplorerTxLink(chainId || 43114, txHash), '_blank'),
        },
      });
    } catch (error) {
      console.error('Approval error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to approve token';
      setError(errorMessage);
      toast.error(`Approval failed: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSupply = async () => {
    if (!usdcBalance || !address || !chainId) {
      setError('Missing required parameters');
      return;
    }

    // Network guard: Ensure user is on Avalanche C-Chain
    if (chainId !== avalanche.id) {
      setError('Please switch to Avalanche C-Chain');
      toast.error('Wrong network. Please switch to Avalanche C-Chain.', {
        duration: 8000,
      });
      return;
    }

    if (!publicClient) {
      setError('Public client not available');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Get the dynamic Pool address
      const poolAddress = await publicClient.readContract({
        address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
        abi: AAVE_POOL_ADDRESSES_PROVIDER_ABI,
        functionName: 'getPool',
      }) as `0x${string}`;

      const txHash = await writeContractAsync({
        address: poolAddress,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [
          CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
          usdcBalance, // amount
          address, // onBehalfOf
          0 // referralCode (uint16)
        ],
      });

      setTxHash(txHash);
      toast.success('Supply transaction sent!', {
        action: {
          label: 'View on Explorer',
          onClick: () => window.open(getExplorerTxLink(chainId || 43114, txHash), '_blank'),
        },
      });
    } catch (error) {
      console.error('Supply error:', error);
      
      // Use improved error parser
      const parsed = parseError(error);
      
      console.error('Parsed error type:', parsed.type);
      if (parsed.revertReason) {
        console.error('Revert reason:', parsed.revertReason);
      }
      
      const userMessage = getErrorMessage(error, 'Supply failed');
      setError(userMessage);
      
      // Show appropriate toast based on error type
      switch (parsed.type) {
        case 'user_rejected':
          toast.error('Transaction rejected in wallet');
          break;
        case 'gas_insufficient':
          toast.error('Insufficient AVAX for gas. Please add more AVAX to your wallet.');
          break;
        case 'contract_revert':
          toast.error(parsed.message, {
            duration: 10000,
            description: 'This is NOT a gas issue. Check Snowtrace for transaction details.',
          });
          break;
        case 'allowance':
          toast.error('Insufficient allowance. Please approve first.');
          break;
        case 'balance':
          toast.error('Insufficient USDC balance');
          break;
        default:
          toast.error(userMessage);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSpeedUp = async (txHash: `0x${string}`) => {
    toast.info('Speed up feature coming soon');
  };

  const handleCancel = async (txHash: `0x${string}`) => {
    toast.info('Cancel feature coming soon');
  };

  // Check if approval is needed
  const needsApproval = allowance !== undefined && 
                       usdcBalance !== undefined && 
                       allowance < usdcBalance;

  // Format balance for display (USDC has 6 decimals, not 18)
  const formattedUsdcBalance = usdcBalance ? 
    formatUnits(usdcBalance, 6) : '0';

  // Handle max button click
  const handleMaxClick = () => {
    if (usdcBalance) {
      // USDC has 6 decimals, not 18
      setAmount(formatUnits(usdcBalance, 6));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button 
          size="lg" 
          className="bg-gradient-primary hover:opacity-90 transition-opacity shadow-glow"
          onClick={() => setIsOpen(true)}
        >
          <Plus className="mr-2 h-5 w-5" />
          Deposit AVAX
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deposit AVAX to Aave</DialogTitle>
          <DialogDescription>
            Your AVAX will be swapped to USDC and supplied to Aave V3
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Amount Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Amount (AVAX)</Label>
              {usdcBalance > 0n && step === 'swap' && (
                <button
                  type="button"
                  onClick={handleMaxClick}
                  className="text-sm text-primary hover:underline"
                  disabled={isLoading}
                >
                  Max: {formattedUsdcBalance} AVAX
                </button>
              )}
            </div>
            <div className="relative">
              <Input
                id="amount"
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                disabled={step !== 'swap' || isLoading}
                className="text-lg pr-20"
                min="0"
                step="0.000000000000000001"
              />
              {step === 'swap' && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center space-x-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleMaxClick}
                    className="h-6 px-2 text-xs"
                    disabled={isLoading || !usdcBalance}
                  >
                    MAX
                  </Button>
                </div>
              )}
            </div>
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
            
            {/* Swap Quote Display */}
            {step === 'swap' && amount && expectedUsdc && (
              <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Expected USDC:</span>
                    <span className="font-semibold text-blue-700 dark:text-blue-300">
                      {isCalculatingQuote ? (
                        <Loader2 className="h-3 w-3 animate-spin inline" />
                      ) : (
                        `${parseFloat(expectedUsdc).toFixed(2)} USDC`
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Minimum (with {slippageTolerance}% slippage):</span>
                    <span className="font-semibold text-orange-700 dark:text-orange-300">
                      {minUsdc ? `${parseFloat(minUsdc).toFixed(2)} USDC` : 'Calculating...'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-blue-200 dark:border-blue-800">
                    ⚠️ You will receive at least {minUsdc ? parseFloat(minUsdc).toFixed(2) : '...'} USDC even if price moves unfavorably
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Visual Flow */}
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex items-center justify-between w-full">
              <div className="flex-1 text-center p-3 rounded-lg bg-primary/10">
                <p className="text-sm text-muted-foreground">From</p>
                <p className="text-lg font-bold text-primary">AVAX</p>
              </div>
              <ArrowDown className="mx-4 h-5 w-5 text-muted-foreground" />
              <div className="flex-1 text-center p-3 rounded-lg bg-accent/10">
                <p className="text-sm text-muted-foreground">To</p>
                <p className="text-lg font-bold text-accent">USDC</p>
              </div>
            </div>

            {/* Progress Steps */}
            <div className="flex items-center justify-between w-full text-xs">
              <div className={`text-center ${step === 'swap' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                1. Swap
              </div>
              <div className={`text-center ${step === 'approve' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                2. Approve
              </div>
              <div className={`text-center ${step === 'supply' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                3. Supply
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          {hasUndepositedUsdc && step === 'swap' && (
            <Button
              onClick={() => {
                setStep('approve');
                setHasUndepositedUsdc(false);
              }}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              Complete USDC Deposit to Aave
            </Button>
          )}
          
          {step === 'swap' && !hasUndepositedUsdc && (
            <Button
              onClick={handleSwap}
              disabled={!amount || isLoading || parseFloat(amount) <= 0}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {txHash ? 'Processing...' : 'Confirm in Wallet'}
                </>
              ) : (
                'Swap AVAX to USDC'
              )}
            </Button>
          )}

          {step === 'approve' && (
            <Button
              onClick={handleApprove}
              disabled={!needsApproval || isLoading}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {txHash ? 'Processing...' : 'Approve in Wallet'}
                </>
              ) : (
                needsApproval ? 'Approve USDC' : 'Approved!'
              )}
            </Button>
          )}

          {step === 'supply' && (
            <Button
              onClick={handleSupply}
              disabled={isLoading}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {txHash ? 'Processing...' : 'Confirm in Wallet'}
                </>
              ) : (
                'Supply to Aave'
              )}
            </Button>
          )}
        </div>
        {txHash && (
          <div className="mt-4 p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Transaction:</span>
              <a 
                href={getExplorerTxLink(chainId || 43114, txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-primary hover:underline"
              >
                View on Explorer
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-sm font-mono truncate">
                {`${txHash.substring(0, 6)}...${txHash.substring(txHash.length - 4)}`}
              </span>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleSpeedUp(txHash)}
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  disabled={isLoading}
                >
                  Speed Up
                </Button>
                <Button
                  onClick={() => handleCancel(txHash)}
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-red-500 hover:text-red-600"
                  disabled={isLoading}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
