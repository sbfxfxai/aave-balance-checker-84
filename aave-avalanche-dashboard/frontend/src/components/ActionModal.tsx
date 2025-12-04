import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAccount, useReadContract, useBalance } from 'wagmi';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { readContract, waitForTransactionReceipt } from '@wagmi/core';
import { CONTRACTS, ERC20_ABI, AAVE_DATA_PROVIDER_ABI } from '@/config/contracts';
import { toast } from 'sonner';
import { getExplorerTxLink } from '@/lib/blockchain';
import { avalanche } from 'wagmi/chains';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useQueryClient } from '@tanstack/react-query';
import { config } from '@/config/wagmi';
import { parseError, getErrorMessage } from '@/utils/errorParser';
import { TRADER_JOE_ROUTER_ABI } from '@/lib/constants';


// Aave Pool ABI
const AAVE_POOL_ABI = [
  {
    name: 'supply',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' },
      { name: 'referralCode', type: 'uint16' }
    ],
    outputs: []
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' }
    ],
    outputs: []
  },
  {
    name: 'borrow',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'interestRateMode', type: 'uint256' },
      { name: 'referralCode', type: 'uint16' },
      { name: 'onBehalfOf', type: 'address' }
    ],
    outputs: []
  },
  {
    name: 'repay',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'rateMode', type: 'uint256' },
      { name: 'onBehalfOf', type: 'address' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

interface ActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  action: 'swap' | 'supply' | 'withdraw' | 'borrow' | 'repay';
}

export function ActionModal({ isOpen, onClose, action }: ActionModalProps) {
  const { address, isConnected, chainId } = useAccount();
  const { writeContract, writeContractAsync, data: hash, isPending } = useWriteContract({
    mutation: {
      onError: (error) => {
        console.error('Transaction error from hook:', error);
      },
    },
  });
  const queryClient = useQueryClient();
  
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<'approve' | 'supply'>('approve');

  // Get dynamic Pool address
  const { data: poolAddress } = useReadContract({
    address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
    abi: [{ name: 'getPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }] as const,
    functionName: 'getPool',
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Get AVAX balance for gas fees
  const { data: avaxBalance } = useBalance({
    address,
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Get native USDC balance for supply action (Aave V3 uses native USDC, not USDC.e)
  const { data: usdcBalance, refetch: refetchUsdcBalance } = useBalance({
    address,
    token: action === 'supply' ? (CONTRACTS.USDC as `0x${string}`) : undefined,
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address && action === 'supply',
      refetchInterval: 15_000, // Reduced from 5s to 15s
    },
  });

  // Get Aave positions to refresh after supply
  const positions = useAavePositions();

  // Check current allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && poolAddress ? [address, poolAddress] : undefined,
    query: {
      enabled: isConnected && !!address && !!poolAddress,
      refetchInterval: 20_000, // Reduced from 10s to 20s
    },
  });

  // Get transaction receipt to check status
  const { data: receipt, isError: isReceiptError, isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash,
    query: {
      enabled: !!hash,
    },
  });

  // This useEffect is now a fallback for transactions that complete outside the inline flow
  React.useEffect(() => {
    if (receipt && hash && receipt.status === 'reverted') {
      console.error('Transaction reverted:', hash);
      toast.error('Transaction failed. Please check the transaction on Snowtrace.');
      setIsProcessing(false);
    }
  }, [receipt, hash]);

  React.useEffect(() => {
    if (isReceiptError) {
      console.error('Error waiting for transaction receipt');
      toast.error('Error confirming transaction. Please check your wallet.');
      setIsProcessing(false);
    }
  }, [isReceiptError]);

  const executeSupplyStep = async () => {
    console.log('=== ENTERING SUPPLY STEP (DIRECT) ===');
    console.log('Current step state:', step);
    console.log('Amount entered:', amount);
    
    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    // Network guard: Ensure user is on Avalanche C-Chain
    if (chainId !== avalanche.id) {
      toast.error('Please switch to Avalanche C-Chain to perform this action', {
        duration: 8000,
      });
      return;
    }
    
    // Supply USDC to Aave
    const supplyAmountWei = parseUnits(amount, 6);
    console.log('Parsed amount in wei:', supplyAmountWei.toString());
    
    // Read allowance directly from contract to ensure we have latest value
    let currentAllowance = allowance || 0n;
    try {
      if (poolAddress) {
        const freshAllowance = await readContract(config, {
          address: CONTRACTS.USDC as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [address!, poolAddress],
        });
        currentAllowance = freshAllowance as bigint;
        console.log('Fresh allowance from contract:', currentAllowance.toString());
      }
    } catch (error) {
      console.warn('Could not read fresh allowance, using cached value:', error);
    }
    
    if (currentAllowance < supplyAmountWei) {
      console.error('Insufficient allowance:', {
        current: currentAllowance.toString(),
        required: supplyAmountWei.toString(),
      });
      toast.error('Insufficient allowance. Please approve first.');
      setStep('approve');
      setIsProcessing(false);
      return;
    }
    
    // Fresh balance check right before supply to ensure we have enough
    console.log('=== FRESH BALANCE CHECK BEFORE SUPPLY ===');
    let freshBalance: bigint;
    try {
      freshBalance = await readContract(config, {
        address: CONTRACTS.USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address!],
      }) as bigint;
      
      const freshBalanceFormatted = formatUnits(freshBalance, 6);
      console.log('Fresh USDC balance:', freshBalance.toString(), `(${freshBalanceFormatted} USDC)`);
      console.log('Required amount:', supplyAmountWei.toString(), `(${amount} USDC)`);
      
      if (freshBalance < supplyAmountWei) {
        const errorMsg = `Insufficient USDC balance. You have ${freshBalanceFormatted} USDC, but trying to supply ${amount} USDC`;
        console.error('❌', errorMsg);
        toast.error(errorMsg);
        setIsProcessing(false);
        return;
      }
      
      console.log('✅ Balance check passed');
    } catch (error) {
      console.warn('Could not read fresh balance, proceeding anyway:', error);
      // Continue with transaction - worst case it will fail on-chain
    }
    
    console.log('=== SUPPLY STEP DEBUG ===');
    console.log('Supplying native USDC to Aave V3:', {
      poolAddress,
      asset: CONTRACTS.USDC,
      amountWei: supplyAmountWei.toString(),
      amountFormatted: formatUnits(supplyAmountWei, 6),
      onBehalfOf: address,
      currentAllowance: currentAllowance.toString(),
      allowanceFormatted: formatUnits(currentAllowance, 6),
    });
    console.log('writeContract function type:', typeof writeContract);
    console.log('isPending before supply:', isPending);
    console.log('Current hash before supply:', hash);
    console.log('Pool address:', poolAddress);
    console.log('ABI length:', AAVE_POOL_ABI.length);
    
    try {
      console.log('Calling writeContract for supply...');
      
      if (!poolAddress) {
        throw new Error('Pool address not available');
      }
      
      // Avalanche C-Chain uses legacy gasPrice (not EIP-1559)
      // Set minimum gas price: 27-30 gwei is typical for Avalanche
      const minGasPriceGwei = 27; // 27 gwei minimum for Avalanche
      const gasPriceWei = BigInt(Math.ceil(minGasPriceGwei * 1e9));
      
      console.log('Gas parameters:', {
        gasPrice: `${minGasPriceGwei} gwei (${gasPriceWei.toString()} wei)`,
        note: 'Avalanche C-Chain uses legacy gasPrice (not EIP-1559)',
      });
      
      console.log('Calling writeContractAsync with gas parameters...');
      
      // Use writeContractAsync with explicit gas parameters
      // Avalanche C-Chain uses gasPrice (legacy), not maxFeePerGas/maxPriorityFeePerGas
      // Aave V3 uses native USDC, not USDC.e
      const supplyHash = await writeContractAsync({
        address: poolAddress as `0x${string}`,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [CONTRACTS.USDC as `0x${string}`, supplyAmountWei, address, 0],
        gas: 500000n, // Set gas limit
        gasPrice: gasPriceWei, // Legacy gasPrice for Avalanche
      });
      
      console.log('writeContractAsync returned:', supplyHash);
      console.log('Type of returned hash:', typeof supplyHash);
      console.log('isPending after supply call:', isPending);
      console.log('hash after supply call:', hash);
      
      if (!supplyHash) {
        console.error('❌ Supply transaction failed - writeContract returned undefined');
        console.error('This usually means:');
        console.error('1. Wallet rejected the transaction');
        console.error('2. User cancelled in wallet');
        console.error('3. Transaction simulation failed');
        throw new Error('Supply transaction failed - no hash returned. Check wallet for rejection or error.');
      }
      
      console.log('✅ Supply transaction hash received:', supplyHash);
      toast.success('Supply transaction submitted! Waiting for confirmation...', {
        action: {
          label: 'View on Explorer',
          onClick: () => window.open(getExplorerTxLink(avalanche.id, supplyHash), '_blank'),
        },
      });
      
      // Wait a moment for transaction to be indexed before querying receipt
      // This prevents "cannot query unfinalized data" errors
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Wait for supply to be confirmed with timeout
      try {
        const receipt = await waitForTransactionReceipt(config, { 
          hash: supplyHash,
          timeout: 120_000, // 120 second timeout (2 minutes)
          pollingInterval: 2_000, // Poll every 2 seconds to reduce RPC calls
        });
        
        if (receipt.status === 'success') {
          console.log('Supply confirmed! Transaction successful.');
          toast.success(`Successfully supplied ${amount} USDC to Aave V3!`);
          
          // Refetch balances immediately
          await refetchUsdcBalance();
          await refetchAllowance();
          
          // Refetch AVAX balance to update gas fee deduction
          if (avaxBalance) {
            // Trigger refetch by invalidating wagmi balance queries
            queryClient.invalidateQueries({ 
              queryKey: ['balance', { address, chainId: avalanche.id }] 
            });
          }
          
          // Invalidate all queries to force refresh of positions
          queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
          queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
          
          // Reset and close modal
          setAmount('');
          setIsProcessing(false);
          onClose();
        } else {
          throw new Error('Supply transaction failed');
        }
      } catch (timeoutError: unknown) {
        // Handle timeout and "unfinalized data" errors gracefully
        const error = timeoutError as { name?: string; message?: string; details?: string };
        const isTimeout = error?.name === 'WaitForTransactionReceiptTimeoutError' || error?.message?.includes('Timed out');
        const isUnfinalized = error?.message?.includes('cannot query unfinalized data') || error?.details?.includes('cannot query unfinalized data');
        
        if (isTimeout || isUnfinalized) {
          console.log('Transaction submitted but confirmation timed out or data not yet finalized. Transaction is pending.');
          toast.success('Transaction submitted! It may take a moment to confirm. Check the explorer for status.', {
            action: {
              label: 'View on Explorer',
              onClick: () => window.open(getExplorerTxLink(avalanche.id, supplyHash), '_blank'),
            },
            duration: 10000,
          });
          
          // Refetch balances in case transaction went through
          await refetchUsdcBalance();
          await refetchAllowance();
          
          // Refetch AVAX balance to update gas fee deduction
          if (avaxBalance) {
            queryClient.invalidateQueries({ 
              queryKey: ['balance', { address, chainId: avalanche.id }] 
            });
          }
          
          queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
          queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
          
          // Reset and close modal
          setAmount('');
          setIsProcessing(false);
          onClose();
        } else {
          throw timeoutError; // Re-throw if it's not a timeout or unfinalized error
        }
      }
    } catch (error) {
      console.error('❌ SUPPLY ERROR:', error);
      console.error('Error type:', error?.constructor?.name);
      console.error('Error message:', error instanceof Error ? error.message : String(error));
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      
      // Use improved error parser
      const parsed = parseError(error);
      
      console.error('Parsed error type:', parsed.type);
      if (parsed.revertReason) {
        console.error('Revert reason:', parsed.revertReason);
      }
      
      // Handle based on error type
      switch (parsed.type) {
        case 'user_rejected':
          toast.error('Transaction rejected in wallet. Please try again.');
          break;
          
        case 'gas_insufficient':
          toast.error('Insufficient funds for gas. Please add more AVAX to your wallet.');
          break;
          
        case 'contract_revert':
          // Contract execution would revert (NOT a gas balance issue)
          console.error('Contract execution would revert. This is NOT a gas issue.');
          console.error('Revert reason:', parsed.revertReason || 'Unknown');
          toast.error(parsed.message, {
            duration: 10000,
            action: {
              label: 'View on Snowtrace',
              onClick: () => {
                // If we have a transaction hash, link to it
                const explorerUrl = `https://snowtrace.io/`;
                window.open(explorerUrl, '_blank');
              },
            },
          });
          break;
          
        case 'allowance':
          toast.error('Insufficient allowance. Please approve first.');
          setStep('approve');
          break;
          
        case 'balance':
          toast.error('Insufficient USDC balance. Please check your balance and try again.');
          break;
          
        case 'network':
          toast.error('Network error. Please check your connection and try again.');
          break;
          
        default:
          toast.error(getErrorMessage(error, 'Supply failed'));
      }
      
      setIsProcessing(false);
    }
  };

  const handleAction = async (): Promise<void> => {
    // Prevent multiple simultaneous calls
    if (isProcessing) {
      console.log('handleAction already processing, ignoring duplicate call');
      return;
    }
    
    console.log('=== handleAction called ===');
    console.log('Action:', action);
    console.log('Step:', step);
    console.log('Amount:', amount);
    console.log('isConnected:', isConnected);
    console.log('address:', address);
    
    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    // Network guard: Ensure user is on Avalanche C-Chain
    if (chainId !== avalanche.id) {
      toast.error('Please switch to Avalanche C-Chain to perform this action', {
        duration: 8000,
      });
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    // Validate balance for supply using BigInt for precision
    if (action === 'supply') {
      if (!usdcBalance || !usdcBalance.value) {
        toast.error('Unable to fetch balance. Please try again.');
        return;
      }
      
      // Convert amount to wei (USDC has 6 decimals)
      const amountWei = parseUnits(amount, 6);
      const balanceWei = BigInt(usdcBalance.value);
      
      // Precise BigInt comparison
      if (amountWei > balanceWei) {
        const balanceFormatted = parseFloat(usdcBalance.formatted);
        toast.error(`Insufficient balance. You have ${balanceFormatted.toFixed(2)} USDC`);
        return;
      }
      
      if (amountWei <= 0n) {
        toast.error('Amount must be greater than 0');
        return;
      }
      
      // Check AVAX balance for gas fees using BigInt
      if (!avaxBalance || !avaxBalance.value) {
        toast.error('Unable to fetch AVAX balance. Please try again.');
        return;
      }
      
      // Minimum 0.01 AVAX for gas fees (18 decimals)
      const minAvaxForGasWei = parseUnits('0.01', 18);
      const avaxBalanceWei = BigInt(avaxBalance.value);
      
      if (avaxBalanceWei < minAvaxForGasWei) {
        const avaxBalanceFormatted = parseFloat(avaxBalance.formatted);
        toast.error(`Insufficient AVAX for gas fees. You have ${avaxBalanceFormatted.toFixed(4)} AVAX, need at least 0.01 AVAX`);
        return;
      }
    }

    // Set processing state early to prevent duplicate calls
    setIsProcessing(true);

    try {

      switch (action) {
        case 'swap': {
          // AVAX → USDC swap
          const avaxAmountWei = parseUnits(amount, 18);
          
          // Get swap quote for slippage protection
          let amountOutMin = 0n;
          try {
            const amountsOut = await readContract(config, {
              address: CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`,
              abi: TRADER_JOE_ROUTER_ABI,
              functionName: 'getAmountsOut',
              args: [avaxAmountWei, [CONTRACTS.WAVAX, CONTRACTS.USDC]],
            });
            
            if (Array.isArray(amountsOut) && amountsOut.length >= 2) {
              const expectedAmountWei = amountsOut[amountsOut.length - 1] as bigint;
              // Apply 0.5% slippage tolerance
              const slippageMultiplier = BigInt(Math.floor(99.5 * 100)); // 9950 for 0.5% slippage
              amountOutMin = (expectedAmountWei * slippageMultiplier) / 10000n;
              console.log('Swap quote:', {
                expectedUSDC: formatUnits(expectedAmountWei, 6),
                minUSDC: formatUnits(amountOutMin, 6),
                slippage: '0.5%'
              });
            }
          } catch (quoteError) {
            console.warn('Failed to get swap quote, using fallback calculation:', quoteError);
            // Fallback: use 30 USDC per AVAX with 5% slippage
            const fallbackUsdc = parseUnits((parseFloat(amount) * 30).toString(), 6);
            amountOutMin = (fallbackUsdc * 95n) / 100n; // 5% slippage for fallback
          }
          
          if (amountOutMin === 0n) {
            toast.error('Unable to calculate swap quote. Please try again.');
            setIsProcessing(false);
            return;
          }
          
          // Avalanche C-Chain uses legacy gasPrice (not EIP-1559)
          const minGasPriceGwei = 27; // 27 gwei minimum for Avalanche
          const gasPriceWei = BigInt(Math.ceil(minGasPriceGwei * 1e9));
          
          console.log('Executing swap with gas parameters:', {
            gasPrice: `${minGasPriceGwei} gwei`,
            amountIn: formatUnits(avaxAmountWei, 18) + ' AVAX',
            minAmountOut: formatUnits(amountOutMin, 6) + ' USDC',
          });
          
          const swapHash = await writeContractAsync({
            address: CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`,
            abi: TRADER_JOE_ROUTER_ABI,
            functionName: 'swapExactAVAXForTokens',
            args: [
              amountOutMin,
              [CONTRACTS.WAVAX, CONTRACTS.USDC], // Native USDC for Aave V3
              address,
              BigInt(Math.floor(Date.now() / 1000) + 60 * 20) // 20 minutes deadline
            ],
            value: avaxAmountWei,
            gas: 500000n,
            gasPrice: gasPriceWei, // Legacy gasPrice for Avalanche
          });
          
          console.log('Swap transaction hash:', swapHash);
          
          // Wait for swap confirmation
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          try {
            const receipt = await waitForTransactionReceipt(config, {
              hash: swapHash,
              timeout: 120_000,
              pollingInterval: 2_000,
            });
            
            if (receipt.status === 'success') {
              toast.success(`Successfully swapped ${amount} AVAX → USDC!`);
              // Refetch balances
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              setAmount('');
              setIsProcessing(false);
              onClose();
            } else {
              throw new Error('Swap transaction failed');
            }
          } catch (timeoutError: unknown) {
            const error = timeoutError as { name?: string; message?: string };
            const isTimeout = error?.name === 'WaitForTransactionReceiptTimeoutError' || error?.message?.includes('Timed out');
            const isUnfinalized = error?.message?.includes('cannot query unfinalized data');
            
            if (isTimeout || isUnfinalized) {
              toast.success('Swap transaction submitted! Check explorer for status.', {
                action: {
                  label: 'View on Explorer',
                  onClick: () => window.open(getExplorerTxLink(avalanche.id, swapHash), '_blank'),
                },
                duration: 10000,
              });
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              setAmount('');
              setIsProcessing(false);
              onClose();
            } else {
              throw timeoutError;
            }
          }
          break;
        }

        case 'supply':
          if (!poolAddress) {
            toast.error('Pool address not available. Please try again.');
            setIsProcessing(false);
            return;
          }

          if (step === 'approve') {
            // Check if we already have allowance
            const supplyAmountWei = parseUnits(amount, 6);
            const currentAllowanceValue = allowance ?? 0n;
            console.log('Checking allowance:', {
              currentAllowance: currentAllowanceValue.toString(),
              requiredAmount: supplyAmountWei.toString(),
              poolAddress,
            });
            
            if (currentAllowanceValue >= supplyAmountWei) {
              console.log('Allowance sufficient, skipping approval');
              setStep('supply');
              setIsProcessing(true);
              // Execute supply step directly - don't call handleAction to avoid recursion
              // Use setTimeout to ensure state updates before executing
              setTimeout(() => {
                executeSupplyStep().catch((error) => {
                  console.error('Supply step error:', error);
                  setIsProcessing(false);
                });
              }, 0);
              return;
            }
            
            // Approve USDC spending - use specific amount instead of max for better compatibility
            console.log('Approving native USDC for Aave V3 pool:', {
              token: CONTRACTS.USDC,
              spender: poolAddress,
              amount: supplyAmountWei.toString() + ' wei (exact amount)',
            });
            
            try {
              console.log('=== APPROVAL STEP DEBUG ===');
              console.log('Attempting approval with params:', {
                address: CONTRACTS.USDC,
                spender: poolAddress,
                amount: 'MAX (unlimited)'
              });
              
              // Use writeContractAsync from hook
              const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
              
              console.log('Using writeContractAsync from hook');
              
              const approveHash = await writeContractAsync({
                address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [poolAddress, maxApproval], // Use max approval
              });
              
              console.log('writeContractAsync returned:', approveHash);
              console.log('Type of returned hash:', typeof approveHash);
              
              if (!approveHash) {
                console.error('writeContractAsync returned undefined - possible wallet rejection or error');
                throw new Error('Approval transaction failed - no hash returned. Check if wallet rejected the transaction.');
              }
              
              console.log('✅ Approval transaction hash:', approveHash);
              
              // Wait for approval to be confirmed with timeout and retries
              console.log('Waiting for approval transaction to be mined...');
              let receipt = null;
              let attempts = 0;
              const maxAttempts = 20; // 20 attempts * 3 seconds = 60 seconds total
              
              while (!receipt && attempts < maxAttempts) {
                attempts++;
                console.log(`Waiting for approval receipt... attempt ${attempts}/${maxAttempts}`);
                
                try {
                  receipt = await waitForTransactionReceipt(config, { 
                    hash: approveHash,
                    timeout: 3_000, // 3 second timeout per attempt
                    pollingInterval: 500, // Poll every 0.5 seconds
                  });
                  
                  if (receipt) {
                    console.log('✅ Approval receipt found:', receipt.status);
                    break;
                  }
                } catch (error) {
                  console.log(`Attempt ${attempts} failed:`, error instanceof Error ? error.message : String(error));
                  
                  if (attempts < maxAttempts) {
                    // Wait 2 seconds before retrying
                    console.log('Waiting 2 seconds before retry...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                  }
                }
              }
              
              if (!receipt) {
                console.log('Approval transaction not confirmed after retries, but proceeding anyway...');
                toast.info('Approval transaction submitted. Proceeding to supply...');
                
                // Proceed anyway - the transaction might still be mining
                // We'll check allowance before supply to see if it worked
                setTimeout(() => {
                  console.log('Proceeding to supply step after delay...');
                  setStep('supply');
                  setTimeout(() => {
                    executeSupplyStep();
                  }, 1000);
                }, 3000);
                return;
              }
              
              if (receipt.status === 'success') {
                console.log('Approval confirmed!');
                console.log('Proceeding directly to supply step...');
                toast.success('USDC approved! Proceeding to supply...');
                
                // Update step for UI
                setStep('supply');
                
                // Wait a moment for allowance to propagate, then execute supply directly
                // This avoids the closure issue with step state
                setTimeout(() => {
                  console.log('Auto-executing supply step...');
                  executeSupplyStep();
                }, 1500);
                return;
              } else {
                throw new Error('Approval transaction failed');
              }
            } catch (error) {
              console.error('Approval error:', error);
              toast.error(`Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
              setIsProcessing(false);
            }
          } else if (step === 'supply') {
            // Use the centralized executeSupplyStep function to avoid code duplication
            await executeSupplyStep();
          }
          break;

        case 'withdraw': {
          if (!poolAddress) {
            toast.error('Pool address not available. Please try again.');
            setIsProcessing(false);
            return;
          }

          // Withdraw USDC from Aave
          const withdrawAmountWei = parseUnits(amount, 6);
          
          // Avalanche C-Chain uses legacy gasPrice (not EIP-1559)
          const minGasPriceGwei = 27; // 27 gwei minimum for Avalanche
          const gasPriceWei = BigInt(Math.ceil(minGasPriceGwei * 1e9));
          
          const withdrawHash = await writeContractAsync({
            address: poolAddress, // Use dynamic pool address
            abi: AAVE_POOL_ABI,
            functionName: 'withdraw',
            args: [CONTRACTS.USDC as `0x${string}`, withdrawAmountWei, address], // Native USDC for Aave V3
            gas: 500000n,
            gasPrice: gasPriceWei, // Legacy gasPrice for Avalanche
          });
          
          console.log('Withdraw transaction hash:', withdrawHash);
          
          if (!withdrawHash) {
            throw new Error('Withdraw transaction failed - no hash returned. Check if wallet rejected the transaction.');
          }
          
          toast.success('Withdraw transaction submitted! Waiting for confirmation...', {
            action: {
              label: 'View on Explorer',
              onClick: () => window.open(getExplorerTxLink(avalanche.id, withdrawHash), '_blank'),
            },
          });
          
          // Wait for withdrawal confirmation
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          try {
            const receipt = await waitForTransactionReceipt(config, {
              hash: withdrawHash,
              timeout: 120_000,
              pollingInterval: 2_000,
            });
            
            if (receipt.status === 'success') {
              toast.success(`Successfully withdrew ${amount} USDC from Aave!`);
              // Refetch balances and positions
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
              setAmount('');
              setIsProcessing(false);
              onClose();
            } else {
              throw new Error('Withdraw transaction failed');
            }
          } catch (timeoutError: unknown) {
            const error = timeoutError as { name?: string; message?: string };
            const isTimeout = error?.name === 'WaitForTransactionReceiptTimeoutError' || error?.message?.includes('Timed out');
            const isUnfinalized = error?.message?.includes('cannot query unfinalized data');
            
            if (isTimeout || isUnfinalized) {
              toast.success('Withdraw transaction submitted! Check explorer for status.', {
                action: {
                  label: 'View on Explorer',
                  onClick: () => window.open(getExplorerTxLink(avalanche.id, withdrawHash), '_blank'),
                },
                duration: 10000,
              });
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
              setAmount('');
              setIsProcessing(false);
              onClose();
            } else {
              throw timeoutError;
            }
          }
          break;
        }

        case 'borrow': {
          if (!poolAddress) {
            toast.error('Pool address not available. Please try again.');
            setIsProcessing(false);
            return;
          }

          // Borrow AVAX from Aave
          const borrowAmountWei = parseUnits(amount, 18);
          
          // Avalanche C-Chain uses legacy gasPrice (not EIP-1559)
          const minGasPriceGwei = 27; // 27 gwei minimum for Avalanche
          const gasPriceWei = BigInt(Math.ceil(minGasPriceGwei * 1e9));
          
          const borrowHash = await writeContractAsync({
            address: poolAddress, // Use dynamic pool address
            abi: AAVE_POOL_ABI,
            functionName: 'borrow',
            args: [CONTRACTS.WAVAX as `0x${string}`, borrowAmountWei, 2n, 0, address as `0x${string}`],
            gas: 500000n,
            gasPrice: gasPriceWei, // Legacy gasPrice for Avalanche
          });
          
          console.log('Borrow transaction hash:', borrowHash);
          
          if (!borrowHash) {
            throw new Error('Borrow transaction failed - no hash returned. Check if wallet rejected the transaction.');
          }
          
          toast.success('Borrow transaction submitted! Waiting for confirmation...', {
            action: {
              label: 'View on Explorer',
              onClick: () => window.open(getExplorerTxLink(avalanche.id, borrowHash), '_blank'),
            },
          });
          
          // Wait for borrow confirmation
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          try {
            const receipt = await waitForTransactionReceipt(config, {
              hash: borrowHash,
              timeout: 120_000,
              pollingInterval: 2_000,
            });
            
            if (receipt.status === 'success') {
              toast.success(`Successfully borrowed ${amount} AVAX from Aave!`);
              // Refetch balances and positions
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
              setAmount('');
              setIsProcessing(false);
              onClose();
            } else {
              throw new Error('Borrow transaction failed');
            }
          } catch (timeoutError: unknown) {
            const error = timeoutError as { name?: string; message?: string };
            const isTimeout = error?.name === 'WaitForTransactionReceiptTimeoutError' || error?.message?.includes('Timed out');
            const isUnfinalized = error?.message?.includes('cannot query unfinalized data');
            
            if (isTimeout || isUnfinalized) {
              toast.success('Borrow transaction submitted! Check explorer for status.', {
                action: {
                  label: 'View on Explorer',
                  onClick: () => window.open(getExplorerTxLink(avalanche.id, borrowHash), '_blank'),
                },
                duration: 10000,
              });
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
              setAmount('');
              setIsProcessing(false);
              onClose();
            } else {
              throw timeoutError;
            }
          }
          break;
        }

        case 'repay': {
          if (!poolAddress) {
            toast.error('Pool address not available. Please try again.');
            setIsProcessing(false);
            return;
          }

          // Check AVAX balance first
          if (!avaxBalance || !avaxBalance.value) {
            toast.error('Unable to fetch AVAX balance. Please try again.');
            setIsProcessing(false);
            return;
          }

          const avaxBalanceWei = BigInt(avaxBalance.value);
          const repayAmountWei = parseUnits(amount, 18);
          
          // Check if user has enough AVAX balance (including gas fees)
          const minAvaxForGasWei = parseUnits('0.01', 18); // Minimum 0.01 AVAX for gas
          if (avaxBalanceWei < repayAmountWei + minAvaxForGasWei) {
            const available = formatUnits(avaxBalanceWei - minAvaxForGasWei, 18);
            toast.error(`Insufficient AVAX balance. You have ${parseFloat(avaxBalance.formatted).toFixed(4)} AVAX, need at least ${formatUnits(repayAmountWei + minAvaxForGasWei, 18)} AVAX (including gas)`);
            setIsProcessing(false);
            return;
          }

          // Get current AVAX debt to validate repay amount
          let currentAvaxDebt = 0n;
          try {
            const wavaxUserReserveData = await readContract(config, {
              address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
              abi: AAVE_DATA_PROVIDER_ABI,
              functionName: 'getUserReserveData',
              args: [CONTRACTS.WAVAX as `0x${string}`, address!],
            });
            
            if (wavaxUserReserveData && Array.isArray(wavaxUserReserveData)) {
              const [, currentStableDebt, currentVariableDebt] = wavaxUserReserveData;
              currentAvaxDebt = (currentStableDebt as bigint) + (currentVariableDebt as bigint);
            }
          } catch (error) {
            console.error('Could not fetch current AVAX debt:', error);
            toast.error('Failed to fetch current debt. Please try again.');
            setIsProcessing(false);
            return;
          }

          // Validate that user has debt
          if (currentAvaxDebt === 0n) {
            toast.error('No AVAX debt to repay');
            setIsProcessing(false);
            return;
          }

          const currentDebtFormatted = formatUnits(currentAvaxDebt, 18);
          console.log('Current AVAX debt:', currentDebtFormatted, 'Requested repay:', amount);
          
          // Use type(uint256).max for full repayment to avoid issues with interest accrual
          // If user is repaying close to full debt (within 1%), use max for full repayment
          const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
          let useMaxRepay = false;
          let finalRepayAmount = repayAmountWei;
          
          // If repay amount is >= 95% of debt, use max for full repayment
          // This avoids issues with interest accrual making the exact amount fail
          const ninetyFivePercent = (currentAvaxDebt * 95n) / 100n;
          if (repayAmountWei >= ninetyFivePercent) {
            useMaxRepay = true;
            finalRepayAmount = MAX_UINT256;
            console.log('Using type(uint256).max for full repayment to avoid interest accrual issues');
            toast.info(`Repaying full debt: ${currentDebtFormatted} AVAX`);
          } else if (repayAmountWei > currentAvaxDebt) {
            // Cap to debt if exceeds - args amount cannot exceed debt
            console.log(`Repay amount ${repayAmountWei.toString()} exceeds debt ${currentAvaxDebt.toString()}, capping to debt amount`);
            finalRepayAmount = currentAvaxDebt;
            toast.info(`Repay amount capped to current debt: ${currentDebtFormatted} AVAX`);
          }
          // Note: finalRepayAmount is capped to debt to prevent revert
          // The value sent can be slightly more to cover interest accrual
          
          // For max repayment, value should be enough to cover debt + buffer
          // For partial repayment, add small buffer to value to account for interest accrual
          // The args amount stays at finalRepayAmount (capped to debt), but value can be slightly more
          const valueToSend = useMaxRepay && currentAvaxDebt > 0n 
            ? currentAvaxDebt + (currentAvaxDebt / 100n) // Add 1% buffer for interest
            : finalRepayAmount + (finalRepayAmount * 5n) / 1000n; // Add 0.5% buffer for partial repayment
          
          // Ensure value doesn't exceed balance
          if (valueToSend > avaxBalanceWei - minAvaxForGasWei) {
            const maxRepayable = avaxBalanceWei - minAvaxForGasWei;
            toast.error(`Insufficient AVAX balance. Maximum repayable: ${formatUnits(maxRepayable, 18)} AVAX (after reserving gas)`);
            setIsProcessing(false);
            return;
          }
          
          console.log('Repay parameters:', {
            debt: currentDebtFormatted,
            repayAmount: formatUnits(finalRepayAmount, 18),
            valueToSend: formatUnits(valueToSend, 18),
            useMaxRepay,
          });
          
          // Avalanche C-Chain uses legacy gasPrice (not EIP-1559)
          const minGasPriceGwei = 27; // 27 gwei minimum for Avalanche
          const gasPriceWei = BigInt(Math.ceil(minGasPriceGwei * 1e9));
          
          // For AVAX repayment on Avalanche, use WAVAX address and send native AVAX as value
          // Aave V3 will automatically wrap the native AVAX to WAVAX for repayment
          const repayHash = await writeContractAsync({
            address: poolAddress, // Use dynamic pool address
            abi: AAVE_POOL_ABI,
            functionName: 'repay',
            args: [CONTRACTS.WAVAX as `0x${string}`, finalRepayAmount, 2n, address as `0x${string}`],
            value: valueToSend, // Send native AVAX, Aave will wrap it to WAVAX
            gas: 500000n,
            gasPrice: gasPriceWei, // Legacy gasPrice for Avalanche
          });
          
          console.log('Repay transaction hash:', repayHash);
          
          if (!repayHash) {
            throw new Error('Repay transaction failed - no hash returned. Check if wallet rejected the transaction.');
          }
          
          toast.success('Repay transaction submitted! Waiting for confirmation...', {
            action: {
              label: 'View on Explorer',
              onClick: () => window.open(getExplorerTxLink(avalanche.id, repayHash), '_blank'),
            },
          });
          
          // Wait for repay confirmation
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          try {
            const receipt = await waitForTransactionReceipt(config, {
              hash: repayHash,
              timeout: 120_000,
              pollingInterval: 2_000,
            });
            
            if (receipt.status === 'success') {
              toast.success(`Successfully repaid ${amount} AVAX to Aave!`);
              // Refetch balances and positions
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
              setAmount('');
              setIsProcessing(false);
              onClose();
            } else {
              throw new Error('Repay transaction failed');
            }
          } catch (timeoutError: unknown) {
            const error = timeoutError as { name?: string; message?: string };
            const isTimeout = error?.name === 'WaitForTransactionReceiptTimeoutError' || error?.message?.includes('Timed out');
            const isUnfinalized = error?.message?.includes('cannot query unfinalized data');
            
            if (isTimeout || isUnfinalized) {
              toast.success('Repay transaction submitted! Check explorer for status.', {
                action: {
                  label: 'View on Explorer',
                  onClick: () => window.open(getExplorerTxLink(avalanche.id, repayHash), '_blank'),
                },
                duration: 10000,
              });
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
              setAmount('');
              setIsProcessing(false);
              onClose();
            } else {
              throw timeoutError;
            }
          }
          break;
        }
      }
      
    } catch (error) {
      console.error('Action failed:', error);
      toast.error(`${action} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  const getActionInfo = () => {
    switch (action) {
      case 'swap':
        return { title: 'Swap AVAX → USDC', token: 'AVAX', description: 'Swap AVAX for USDC on Trader Joe DEX' };
      case 'supply':
        return { title: 'Supply USDC to Aave', token: 'USDC', description: 'Supply USDC to earn interest' };
      case 'withdraw':
        return { title: 'Withdraw USDC from Aave', token: 'USDC', description: 'Withdraw your supplied USDC' };
      case 'borrow':
        return { title: 'Borrow AVAX from Aave', token: 'AVAX', description: 'Borrow AVAX using your collateral' };
      case 'repay':
        return { title: 'Repay AVAX to Aave', token: 'AVAX', description: 'Repay your borrowed AVAX' };
    }
  };

  const actionInfo = getActionInfo();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-sm p-4 bg-white max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-3">{actionInfo.title}</h2>
        
        <div className="space-y-2.5">
          {/* Balance Display for Supply */}
          {action === 'supply' && usdcBalance && (
            <div className="bg-blue-50 p-2 rounded border border-blue-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-600">Available Balance</div>
                  <div className="text-base font-semibold text-blue-700">
                    {parseFloat(usdcBalance.formatted).toFixed(2)} USDC
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const maxAmount = parseFloat(usdcBalance.formatted);
                    setAmount(maxAmount.toFixed(2));
                  }}
                  disabled={isProcessing}
                >
                  MAX
                </Button>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label htmlFor="amount" className="text-sm">{actionInfo.token} Amount</Label>
              {action === 'supply' && usdcBalance && (
                <span className="text-xs text-gray-500">
                  Max: {parseFloat(usdcBalance.formatted).toFixed(2)}
                </span>
              )}
            </div>
            <Input
              id="amount"
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              min="0"
              max={action === 'supply' && usdcBalance ? usdcBalance.formatted : undefined}
            />
            {action === 'supply' && amount && usdcBalance && usdcBalance.value && (() => {
              try {
                const amountWei = parseUnits(amount, 6);
                const balanceWei = BigInt(usdcBalance.value);
                return amountWei > balanceWei;
              } catch {
                return parseFloat(amount) > parseFloat(usdcBalance.formatted);
              }
            })() && (
              <p className="text-xs text-red-500 mt-1">Amount exceeds available balance</p>
            )}
          </div>

          <Alert className="py-2">
            <AlertDescription className="text-xs">
              {actionInfo.description}
            </AlertDescription>
          </Alert>

          {/* Transaction Hash Display */}
          {hash && (
            <Alert className="py-2">
              <AlertDescription className="text-xs">
                <div className="flex items-center justify-between">
                  <span>Transaction:</span>
                  <a
                    href={getExplorerTxLink(avalanche.id, hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    View on Snowtrace
                  </a>
                </div>
                <div className="text-xs font-mono mt-0.5 break-all">
                  {hash.slice(0, 10)}...{hash.slice(-8)}
                </div>
                {receipt && (
                  <div className="text-xs mt-0.5">
                    Status: {receipt.status === 'success' ? '✅ Success' : receipt.status === 'reverted' ? '❌ Failed' : '⏳ Pending'}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Current Aave Position for Supply */}
          {action === 'supply' && positions.usdcSupply && (
            <Alert className="bg-green-50 border-green-200 py-2">
              <AlertDescription className="text-xs">
                <div className="font-semibold text-green-700">Current Aave Position</div>
                <div className="mt-0.5">Supplied: {parseFloat(positions.usdcSupply).toFixed(2)} USDC</div>
                {positions.usdcSupplyApy && (
                  <div>APY: {positions.usdcSupplyApy.toFixed(2)}%</div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Step Indicator for Supply */}
          {action === 'supply' && (
            <Alert className={`${step === 'approve' ? 'bg-yellow-50 border-yellow-200' : 'bg-blue-50 border-blue-200'} py-2`}>
              <AlertDescription className="text-xs">
                <div className="font-semibold">
                  {step === 'approve' ? '📝 Step 1: Approve USDC' : '💰 Step 2: Supply to Aave V3'}
                </div>
                {step === 'supply' && (
                  <div className="text-xs mt-0.5 text-green-700">✅ Approval complete! Ready to supply.</div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Debug Info for Supply */}
          {action === 'supply' && poolAddress && (
            <Alert className="bg-gray-50 py-2">
              <AlertDescription className="text-xs">
                <div>Pool: {poolAddress.slice(0, 8)}...{poolAddress.slice(-6)}</div>
                <div>Token: {CONTRACTS.USDC.slice(0, 8)}...{CONTRACTS.USDC.slice(-6)} (Native USDC)</div>
                {allowance !== undefined && (
                  <div>Allowance: {formatUnits(allowance, 6)} USDC</div>
                )}
                <div className="mt-0.5 text-gray-500">Current Step: {step}</div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2 pt-1">
            <Button 
              variant="outline" 
              onClick={onClose} 
              disabled={isProcessing}
              className="px-3 py-1.5 h-9 text-sm"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAction}
              disabled={isProcessing || isPending || isConfirming}
              className="flex-1 px-3 py-1.5 h-9 text-sm font-medium"
            >
              {isProcessing || isPending ? 'Submitting...' : isConfirming ? 'Confirming...' : 
               action === 'supply' ? (step === 'approve' ? 'Approve USDC' : 'Supply to Aave') : 
               actionInfo.title}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
