import React, { useState } from 'react';
import { ethers } from 'ethers';
import { Card } from '@/components/ui/card';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAccount, useReadContract, useBalance, useSwitchChain, usePublicClient } from 'wagmi';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits, encodeFunctionData, type Hex, createPublicClient, http } from 'viem';
import { avalanche } from 'wagmi/chains';
import { readContract, waitForTransactionReceipt } from '@wagmi/core';
import { CONTRACTS, ERC20_ABI, AAVE_DATA_PROVIDER_ABI, WAVAX_ABI } from '@/config/contracts';
import { toast } from 'sonner';
import { getExplorerTxLink } from '@/lib/blockchain';
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
  action: 'swap' | 'supply' | 'withdraw' | 'borrow' | 'repay' | 'send';
}

export function ActionModal({ isOpen, onClose, action }: ActionModalProps) {
  const { address: wagmiAddress, isConnected: isWagmiConnected, chainId } = useAccount();
  const { writeContract, writeContractAsync, data: hash, isPending } = useWriteContract({
    mutation: {
      onError: (error) => {
        console.error('Transaction error from hook:', error);
      },
    },
  });
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<'approve' | 'supply'>('approve');
  const [repayMode, setRepayMode] = useState<'full' | 'partial'>('full'); // For repay: full debt or partial

  const { authenticated, ready, sendTransaction } = usePrivy();
  const { wallets } = useWallets();
  const { switchChain: wagmiSwitchChain } = useSwitchChain();

  // Get the active wallet address (Privy or wagmi)
  // Filter out Solana addresses (only use Ethereum addresses)
  const address = React.useMemo(() => {
    // Helper to check if address is Ethereum format
    const isEthereumAddress = (addr: string | undefined | null): boolean => {
      return !!addr && addr.startsWith('0x') && addr.length === 42;
    };

    // If user is authenticated with Privy, use Privy wallet (Ethereum only)
    if (authenticated && ready) {
      // Find Privy wallet with Ethereum address
      const privyWallet = wallets.find(w =>
        w.walletClientType === 'privy' && isEthereumAddress(w.address)
      );
      if (privyWallet) return privyWallet.address as `0x${string}` | undefined;

      // Try to find any Ethereum wallet from Privy
      const ethereumWallet = wallets.find(w => isEthereumAddress(w.address));
      if (ethereumWallet) return ethereumWallet.address as `0x${string}` | undefined;
    }

    // Fall back to wagmi wallet (always Ethereum)
    return wagmiAddress;
  }, [authenticated, ready, wallets, wagmiAddress]);

  // Get chainId from Privy wallet or wagmi
  // Note: Privy smart wallets are configured for Avalanche, so if using Privy, assume Avalanche
  const activeChainId = React.useMemo(() => {
    // If using Privy wallet, Privy smart wallets are always on Avalanche (configured in privy-config)
    if (authenticated && ready && address) {
      const privyWallet = wallets.find(w => w.address === address);
      if (privyWallet && privyWallet.walletClientType === 'privy') {
        // Privy smart wallets are configured for Avalanche, return it directly
        return avalanche.id;
      }
      // If Privy wallet has chainId, use it
      if (privyWallet && privyWallet.chainId) {
        return privyWallet.chainId;
      }
    }
    // Fall back to wagmi chainId for external wallets
    return chainId;
  }, [authenticated, ready, wallets, address, chainId]);

  // Combined connection status (Privy or wagmi)
  const isConnected = isWagmiConnected || (authenticated && ready && !!address);

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

  // Get WAVAX balance for repay action
  const { data: wavaxBalance, refetch: refetchWavaxBalance } = useBalance({
    address,
    token: action === 'repay' ? (CONTRACTS.WAVAX as `0x${string}`) : undefined,
    chainId: avalanche.id,
    query: {
      enabled: isConnected && !!address && action === 'repay',
      refetchInterval: 15_000,
    },
  });

  // Check WAVAX allowance for repay
  const { data: wavaxAllowance, refetch: refetchWavaxAllowance } = useReadContract({
    address: action === 'repay' ? (CONTRACTS.WAVAX as `0x${string}`) : undefined,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && poolAddress && action === 'repay' ? [address, poolAddress] : undefined,
    query: {
      enabled: isConnected && !!address && !!poolAddress && action === 'repay',
      refetchInterval: 20_000,
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

    // Network guard: Skip for Privy smart wallets (always on Avalanche)
    const isPrivyWallet = authenticated && ready && wallets.some(w => w.address === address && w.walletClientType === 'privy');
    if (!isPrivyWallet && activeChainId !== undefined && activeChainId !== avalanche.id) {
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
      let supplyHash: Hex;

      // Check if using Privy wallet
      const privyWallet = wallets.find(w => w.address === address && w.walletClientType === 'privy');

      if (authenticated && privyWallet) {
        console.log('[ActionModal] Supplying USDC via Privy smart wallet');

        try {
          // Encode supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)
          const data = encodeFunctionData({
            abi: AAVE_POOL_ABI,
            functionName: 'supply',
            args: [
              CONTRACTS.USDC as `0x${string}`,
              supplyAmountWei,
              address,
              0, // referralCode
            ],
          });

          const provider = await privyWallet.getEthereumProvider();
          const txHash = await provider.request({
            method: 'eth_sendTransaction',
            params: [{
              to: poolAddress as `0x${string}`,
              data: data as `0x${string}`,
              gas: '0x7a120', // 500000 in hex
              gasPrice: `0x${gasPriceWei.toString(16)}`,
            }],
          });
          supplyHash = txHash as Hex;
        } catch (privyError) {
          console.error('Privy supply error:', privyError);
          throw privyError;
        }
      } else {
        supplyHash = await writeContractAsync({
          address: poolAddress as `0x${string}`,
          abi: AAVE_POOL_ABI,
          functionName: 'supply',
          args: [CONTRACTS.USDC as `0x${string}`, supplyAmountWei, address, 0],
          gas: 500000n, // Set gas limit
          gasPrice: gasPriceWei, // Legacy gasPrice for Avalanche
        });
      }

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
    console.log('activeChainId:', activeChainId);
    console.log('chainId (wagmi):', chainId);
    console.log('authenticated (Privy):', authenticated);

    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    // Network guard: Ensure user is on Avalanche C-Chain
    // Skip check for Privy smart wallets (they're always on Avalanche)
    const isPrivyWallet = authenticated && ready && wallets.some(w => w.address === address && w.walletClientType === 'privy');

    if (!isPrivyWallet && activeChainId !== undefined && activeChainId !== avalanche.id) {
      // Only check network for external wallets (wagmi)
      console.log('Network mismatch detected, attempting switch...');
      try {
        // Try wagmi switch for external wallets
        if (wagmiSwitchChain) {
          wagmiSwitchChain({ chainId: avalanche.id });
          toast.info('Switching to Avalanche C-Chain...', {
            duration: 3000,
          });
          // Wait for switch to complete before continuing
          await new Promise(resolve => setTimeout(resolve, 3000));
          // Re-check chainId after switch
          if (chainId !== avalanche.id) {
            toast.error('Please switch to Avalanche C-Chain manually in your wallet', {
              duration: 8000,
            });
            return;
          }
        } else {
          toast.error('Please switch to Avalanche C-Chain to perform this action', {
            duration: 8000,
          });
          return;
        }
      } catch (switchError) {
        console.error('Network switch error:', switchError);
        toast.error('Failed to switch network. Please switch manually in your wallet.', {
          duration: 8000,
        });
        return;
      }
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

          let swapHash: Hex;

          // Check if using Privy wallet
          const privyWallet = wallets.find(w => w.address === address && w.walletClientType === 'privy');

          if (authenticated && privyWallet) {
            console.log('[ActionModal] Swapping via Privy smart wallet');

            try {
              // Encode swapExactAVAXForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)
              const data = encodeFunctionData({
                abi: TRADER_JOE_ROUTER_ABI,
                functionName: 'swapExactAVAXForTokens',
                args: [
                  amountOutMin,
                  [CONTRACTS.WAVAX as `0x${string}`, CONTRACTS.USDC as `0x${string}`],
                  address as `0x${string}`,
                  BigInt(Math.floor(Date.now() / 1000) + 60 * 20),
                ],
              });

              const provider = await privyWallet.getEthereumProvider();
              const txHash = await provider.request({
                method: 'eth_sendTransaction',
                params: [{
                  to: CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`,
                  data: data as `0x${string}`,
                  value: `0x${avaxAmountWei.toString(16)}`,
                  gas: '0x7a120', // 500000 in hex
                  gasPrice: `0x${gasPriceWei.toString(16)}`,
                }],
              });
              swapHash = txHash as Hex;
            } catch (privyError) {
              console.error('Privy swap error:', privyError);
              throw privyError;
            }
          } else {
            swapHash = await writeContractAsync({
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
          }

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

              let approveHash: Hex;

              // Check if using Privy wallet
              const privyWallet = wallets.find(w => w.address === address && w.walletClientType === 'privy');

              if (authenticated && privyWallet) {
                console.log('[ActionModal] Approving USDC via Privy smart wallet');

                try {
                  // Encode approve(address spender, uint256 amount)
                  const data = encodeFunctionData({
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [poolAddress as `0x${string}`, maxApproval],
                  });

                  const provider = await privyWallet.getEthereumProvider();
                  const txHash = await provider.request({
                    method: 'eth_sendTransaction',
                    params: [{
                      to: CONTRACTS.USDC as `0x${string}`,
                      data: data as `0x${string}`,
                    }],
                  });
                  approveHash = txHash as Hex;
                } catch (privyError) {
                  console.error('Privy approval error:', privyError);
                  throw privyError;
                }
              } else {
                console.log('Using writeContractAsync from hook');
                approveHash = await writeContractAsync({
                  address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
                  abi: ERC20_ABI,
                  functionName: 'approve',
                  args: [poolAddress, maxApproval], // Use max approval
                });
              }

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

          // Check AVAX balance for gas fees (especially important for Privy wallets)
          if (avaxBalance && avaxBalance.value < parseUnits('0.001', 18)) {
            toast.error('Insufficient AVAX for gas fees. Please add at least 0.001 AVAX to your wallet.', {
              duration: 10000,
            });
            setIsProcessing(false);
            return;
          }

          // Withdraw USDC from Aave
          const withdrawAmountWei = parseUnits(amount, 6);

          // Avalanche C-Chain uses legacy gasPrice (not EIP-1559)
          // But Privy smart wallets use EIP-1559, so we need both
          const minGasPriceGwei = 27; // 27 gwei minimum for Avalanche
          const gasPriceWei = BigInt(Math.ceil(minGasPriceGwei * 1e9));

          // For EIP-1559 (Privy smart wallets)
          const maxFeePerGas = gasPriceWei; // Use same as gasPrice for simplicity
          const maxPriorityFeePerGas = BigInt(Math.ceil(2 * 1e9)); // 2 gwei priority fee

          // Calculate estimated gas cost for balance check
          const estimatedGasCost = gasPriceWei * 500000n; // gasPrice * gasLimit

          let withdrawHash: Hex;

          // Check if using Privy wallet
          const privyWallet = wallets.find(w => w.address === address && w.walletClientType === 'privy');

          if (authenticated && privyWallet) {
            console.log('[ActionModal] Withdrawing via Privy smart wallet');

            // Use wagmi's balance check (more reliable than Privy RPC)
            if (avaxBalance && avaxBalance.value < estimatedGasCost) {
              const balanceAvax = formatUnits(avaxBalance.value, 18);
              const estimatedGasCostAvax = formatUnits(estimatedGasCost, 18);
              toast.error(`Insufficient AVAX for gas. You have ${balanceAvax} AVAX but need ~${estimatedGasCostAvax} AVAX.`, {
                duration: 10000,
              });
              setIsProcessing(false);
              return;
            }

            try {
              // Double-check balance directly from Avalanche RPC (bypass Privy's RPC)
              const avalancheRpcUrl = import.meta.env.VITE_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
              const publicClient = createPublicClient({
                chain: avalanche,
                transport: http(avalancheRpcUrl),
              });

              const directBalance = await publicClient.getBalance({ address: address as `0x${string}` });
              const chainId = await publicClient.getChainId();
              console.log('[ActionModal] Direct Avalanche balance check:', formatUnits(directBalance, 18), 'AVAX');
              console.log('[ActionModal] Chain ID from client:', chainId, '(expected: 43114)');
              console.log('[ActionModal] Native AVAX balance (wei):', directBalance.toString());
              console.log('[ActionModal] Estimated gas cost (wei):', estimatedGasCost.toString());

              if (directBalance < estimatedGasCost) {
                const balanceAvax = formatUnits(directBalance, 18);
                const estimatedGasCostAvax = formatUnits(estimatedGasCost, 18);
                toast.error(`Insufficient AVAX for gas. Direct check shows ${balanceAvax} AVAX but need ~${estimatedGasCostAvax} AVAX.`, {
                  duration: 10000,
                });
                setIsProcessing(false);
                return;
              }

              // Verify we're on the correct chain
              if (chainId !== 43114) {
                toast.error(`Wrong chain detected. Expected Avalanche (43114), got ${chainId}. Please switch networks.`, {
                  duration: 10000,
                });
                setIsProcessing(false);
                return;
              }

              // Verify we're on the correct chain
              if (chainId !== 43114) {
                toast.error(`Wrong chain detected. Expected Avalanche (43114), got ${chainId}. Please switch networks.`, {
                  duration: 10000,
                });
                setIsProcessing(false);
                return;
              }

              // Encode withdraw(address asset, uint256 amount, address to)
              const data = encodeFunctionData({
                abi: AAVE_POOL_ABI,
                functionName: 'withdraw',
                args: [
                  CONTRACTS.USDC as `0x${string}`,
                  withdrawAmountWei,
                  address,
                ],
              });

              // Use Privy's getEthereumProvider and wrap with ethers.js for smart wallet transactions
              // This properly handles smart wallet transaction routing
              console.log('[ActionModal] Using Privy ethers provider for smart wallet');
              
              // Ensure we're on the correct chain
              await privyWallet.switchChain(43114);
              
              // Get Ethereum provider from Privy wallet
              const ethereumProvider = await privyWallet.getEthereumProvider();
              
              // Wrap the provider with ethers.js to create a signer
              const ethersProvider = new ethers.BrowserProvider(ethereumProvider);
              const signer = await ethersProvider.getSigner();
              
              // Create contract instance and call withdraw
              const poolContract = new ethers.Contract(
                poolAddress as string,
                AAVE_POOL_ABI,
                signer
              );
              
              // Call withdraw with explicit gas parameters
              // Ethers.js v6 accepts BigInt directly for gas parameters
              const tx = await poolContract.withdraw(
                CONTRACTS.USDC as string,
                withdrawAmountWei.toString(),
                address,
                {
                  gasLimit: 500000,
                  maxFeePerGas: maxFeePerGas, // BigInt - ethers.js v6 accepts this directly
                  maxPriorityFeePerGas: maxPriorityFeePerGas, // BigInt - ethers.js v6 accepts this directly
                }
              );
              
              withdrawHash = tx.hash as Hex;
            } catch (privyError) {
              console.error('Privy withdraw error:', privyError);

              // Check for insufficient gas error
              const errorMessage = privyError instanceof Error ? privyError.message : String(privyError);
              if (errorMessage.includes('insufficient funds') || errorMessage.includes('balance 0')) {
                // Privy's RPC has a known issue where it reports balance 0 even when funds exist
                // This is a Privy infrastructure issue - the transaction is signed correctly
                // but Privy's RPC rejects it due to incorrect balance check
                const balanceAvax = avaxBalance ? formatUnits(avaxBalance.value, 18) : '0';
                toast.error(
                  `Privy smart wallet balance sync issue. Your wallet has ${balanceAvax} AVAX, but Privy's RPC reports 0. ` +
                  `This is a known Privy issue. Please try again in a few moments, or contact support if it persists.`,
                  {
                    duration: 15000,
                  }
                );
                setIsProcessing(false);
                return;
              }

              throw privyError;
            }
          } else {
            console.log('[ActionModal] Withdrawing via Wagmi/External wallet');
            // External wallet via Wagmi
            withdrawHash = await writeContractAsync({
              address: poolAddress, // Use dynamic pool address
              abi: AAVE_POOL_ABI,
              functionName: 'withdraw',
              args: [CONTRACTS.USDC as `0x${string}`, withdrawAmountWei, address], // Native USDC for Aave V3
              gas: 500000n,
              gasPrice: gasPriceWei, // Legacy gasPrice for Avalanche
            });
          }

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
          // But Privy smart wallets use EIP-1559, so we need both
          const minGasPriceGwei = 27; // 27 gwei minimum for Avalanche
          const gasPriceWei = BigInt(Math.ceil(minGasPriceGwei * 1e9));
          
          // For EIP-1559 (Privy smart wallets)
          const maxFeePerGas = gasPriceWei; // Use same as gasPrice for simplicity
          const maxPriorityFeePerGas = BigInt(Math.ceil(2 * 1e9)); // 2 gwei priority fee

          let borrowHash: Hex;

          // Check if using Privy wallet
          const privyWallet = wallets.find(w => w.address === address && w.walletClientType === 'privy');

          if (authenticated && privyWallet) {
            console.log('[ActionModal] Borrowing via Privy smart wallet');

            try {
              // Ensure we're on the correct chain
              await privyWallet.switchChain(43114);
              
              // Get Ethereum provider from Privy wallet
              const ethereumProvider = await privyWallet.getEthereumProvider();
              
              // Wrap the provider with ethers.js to create a signer
              const ethersProvider = new ethers.BrowserProvider(ethereumProvider);
              const signer = await ethersProvider.getSigner();
              
              // Create contract instance and call borrow
              const poolContract = new ethers.Contract(
                poolAddress as string,
                AAVE_POOL_ABI,
                signer
              );
              
              // Call borrow with explicit gas parameters
              // Ethers.js v6 accepts BigInt directly for gas parameters
              const tx = await poolContract.borrow(
                CONTRACTS.WAVAX as string,
                borrowAmountWei.toString(),
                2n, // variable rate
                0, // referralCode
                address,
                {
                  gasLimit: 500000,
                  maxFeePerGas: maxFeePerGas, // BigInt - ethers.js v6 accepts this directly
                  maxPriorityFeePerGas: maxPriorityFeePerGas, // BigInt - ethers.js v6 accepts this directly
                }
              );
              
              borrowHash = tx.hash as Hex;
            } catch (privyError) {
              console.error('Privy borrow error:', privyError);
              throw privyError;
            }
          } else {
            borrowHash = await writeContractAsync({
              address: poolAddress as `0x${string}`,
              abi: AAVE_POOL_ABI,
              functionName: 'borrow',
              args: [CONTRACTS.WAVAX as `0x${string}`, borrowAmountWei, 2n, 0, address as `0x${string}`],
              gas: 500000n,
              gasPrice: gasPriceWei, // Legacy gasPrice for Avalanche
            });
          }

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

              // Wait a moment for blockchain state to propagate
              await new Promise(resolve => setTimeout(resolve, 2000));

              // Explicitly refetch WAVAX reserve data to get updated debt
              if ('refetch' in positions && positions.refetch) {
                await positions.refetch();
              }

              // Try to read updated borrow amount directly
              try {
                const updatedWavaxReserveData = await readContract(config, {
                  address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
                  abi: AAVE_DATA_PROVIDER_ABI,
                  functionName: 'getUserReserveData',
                  args: [CONTRACTS.WAVAX as `0x${string}`, address!],
                });

                if (updatedWavaxReserveData && Array.isArray(updatedWavaxReserveData)) {
                  const [, updatedStableDebt, updatedVariableDebt] = updatedWavaxReserveData;
                  const updatedDebt = (updatedStableDebt as bigint) + (updatedVariableDebt as bigint);
                  console.log('Updated AVAX borrow after transaction:', formatUnits(updatedDebt, 18));

                  if (updatedDebt > 0n) {
                    toast.info(`Current AVAX debt: ${formatUnits(updatedDebt, 18)} AVAX`);
                  }
                }
              } catch (error) {
                console.warn('Could not fetch updated borrow:', error);
              }

              // Refetch balances and positions
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
              queryClient.invalidateQueries({
                queryKey: ['readContract'],
                exact: false
              });

              // Wait a bit more for queries to refetch before closing
              await new Promise(resolve => setTimeout(resolve, 1000));

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

              // Wait for blockchain state to propagate
              await new Promise(resolve => setTimeout(resolve, 3000));

              // Try to read updated borrow amount
              try {
                const updatedWavaxReserveData = await readContract(config, {
                  address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
                  abi: AAVE_DATA_PROVIDER_ABI,
                  functionName: 'getUserReserveData',
                  args: [CONTRACTS.WAVAX as `0x${string}`, address!],
                });

                if (updatedWavaxReserveData && Array.isArray(updatedWavaxReserveData)) {
                  const [, updatedStableDebt, updatedVariableDebt] = updatedWavaxReserveData;
                  const updatedDebt = (updatedStableDebt as bigint) + (updatedVariableDebt as bigint);
                  console.log('Updated AVAX borrow after transaction:', formatUnits(updatedDebt, 18));
                }
              } catch (error) {
                console.warn('Could not fetch updated borrow:', error);
              }

              // Explicitly refetch positions
              if ('refetch' in positions && positions.refetch) {
                await positions.refetch();
              }

              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
              queryClient.invalidateQueries({
                queryKey: ['readContract'],
                exact: false
              });

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

          // Check WAVAX balance - user must hold WAVAX tokens to repay
          const wavaxBalanceWei = wavaxBalance?.value ? BigInt(wavaxBalance.value) : 0n;
          const repayAmountWei = parseUnits(amount, 18);

          // Check AVAX balance for gas fees first
          if (!avaxBalance || !avaxBalance.value) {
            toast.error('Unable to fetch AVAX balance for gas fees. Please try again.');
            setIsProcessing(false);
            return;
          }

          const minAvaxForGasWei = parseUnits('0.01', 18); // Minimum 0.01 AVAX for gas
          if (BigInt(avaxBalance.value) < minAvaxForGasWei) {
            toast.error(`Insufficient AVAX for gas fees. You need at least 0.01 AVAX for gas`);
            setIsProcessing(false);
            return;
          }

          // If user doesn't have enough WAVAX for the initial repay amount, check if they have AVAX to wrap
          // Note: We'll do a more accurate check later after we fetch the current debt
          if (wavaxBalanceWei < repayAmountWei) {
            const avaxBalanceWei = BigInt(avaxBalance.value);
            const neededWavaxWei = repayAmountWei - wavaxBalanceWei;
            const neededAvaxWei = neededWavaxWei + minAvaxForGasWei; // Need AVAX for wrap + gas

            if (avaxBalanceWei >= neededAvaxWei) {
              // User has AVAX, offer to wrap it
              toast.info(`You need ${formatUnits(neededWavaxWei, 18)} WAVAX but only have ${wavaxBalance ? wavaxBalance.formatted : '0'} WAVAX. Wrapping AVAX to WAVAX...`, {
                duration: 10000,
              });

              try {
                // Check if using Privy wallet for wrapping
                const privyWalletForWrap = wallets.find(w => w.address === address && w.walletClientType === 'privy');
                let wrapHash: Hex;
                
                if (authenticated && privyWalletForWrap) {
                  // Use ethers.js for Privy wallet wrapping
                  console.log('[ActionModal] Wrapping AVAX via Privy smart wallet');
                  
                  await privyWalletForWrap.switchChain(43114);
                  const ethereumProvider = await privyWalletForWrap.getEthereumProvider();
                  const ethersProvider = new ethers.BrowserProvider(ethereumProvider);
                  const signer = await ethersProvider.getSigner();
                  
                  const wavaxContract = new ethers.Contract(
                    CONTRACTS.WAVAX as string,
                    WAVAX_ABI,
                    signer
                  );
                  
                  const tx = await wavaxContract.deposit({
                    value: neededWavaxWei.toString(),
                    gasLimit: 100000,
                    maxFeePerGas: BigInt(Math.ceil(27 * 1e9)),
                    maxPriorityFeePerGas: BigInt(Math.ceil(2 * 1e9)),
                  });
                  
                  wrapHash = tx.hash as Hex;
                  
                  // Wait for wrap confirmation using ethers.js
                  toast.success('Wrapping AVAX to WAVAX... Waiting for confirmation...', {
                    action: {
                      label: 'View on Explorer',
                      onClick: () => window.open(getExplorerTxLink(avalanche.id, wrapHash), '_blank'),
                    },
                  });
                  
                  // Wait for the transaction to be mined
                  const wrapReceipt = await tx.wait();
                  
                  if (wrapReceipt.status !== 1) {
                    throw new Error('Wrap transaction failed');
                  }
                } else {
                  // Use wagmi for external wallets
                  wrapHash = await writeContractAsync({
                    address: CONTRACTS.WAVAX as `0x${string}`,
                    abi: WAVAX_ABI,
                    functionName: 'deposit',
                    value: neededWavaxWei, // Send native AVAX to wrap
                    gas: 100000n,
                    gasPrice: BigInt(Math.ceil(27 * 1e9)),
                  });

                  if (!wrapHash) {
                    throw new Error('Wrap transaction failed - no hash returned');
                  }

                  toast.success('Wrapping AVAX to WAVAX... Waiting for confirmation...', {
                    action: {
                      label: 'View on Explorer',
                      onClick: () => window.open(getExplorerTxLink(avalanche.id, wrapHash), '_blank'),
                    },
                  });

                  // Wait for wrap confirmation
                  await new Promise(resolve => setTimeout(resolve, 3000));

                  const wrapReceipt = await waitForTransactionReceipt(config, {
                    hash: wrapHash as Hex,
                    timeout: 120_000,
                    pollingInterval: 2_000,
                  });

                  if (wrapReceipt.status !== 'success') {
                    throw new Error('Wrap transaction failed');
                  }
                }

                toast.success('AVAX wrapped to WAVAX successfully!');
                await refetchWavaxBalance();

                // Refetch balance to get updated WAVAX amount
                const updatedBalance = await readContract(config, {
                  address: CONTRACTS.WAVAX as `0x${string}`,
                  abi: ERC20_ABI,
                  functionName: 'balanceOf',
                  args: [address!],
                });

                if (updatedBalance && BigInt(updatedBalance as bigint) < repayAmountWei) {
                  toast.error(`Still insufficient WAVAX after wrap. Please try again or wrap more AVAX.`);
                  setIsProcessing(false);
                  return;
                }

                // Continue with repay after wrap
              } catch (wrapError) {
                console.error('Wrap error:', wrapError);
                toast.error(`Failed to wrap AVAX: ${wrapError instanceof Error ? wrapError.message : 'Unknown error'}`);
                setIsProcessing(false);
                return;
              }
            } else {
              // Not enough AVAX either
              toast.error(`Insufficient balance. You have ${wavaxBalance ? wavaxBalance.formatted : '0'} WAVAX and ${avaxBalance.formatted} AVAX, need ${formatUnits(repayAmountWei, 18)} WAVAX total (including gas)`);
              setIsProcessing(false);
              return;
            }
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
          console.log('Current AVAX debt:', currentDebtFormatted, 'Requested repay:', amount, 'Mode:', repayMode);

          // Cap repay amount to debt if it exceeds
          let finalRepayAmount = repayAmountWei;
          if (repayAmountWei > currentAvaxDebt) {
            finalRepayAmount = currentAvaxDebt;
            toast.info(`Repay amount capped to current debt: ${currentDebtFormatted} AVAX`);
          }

          const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

          // Check if user has enough WAVAX balance for the repay
          // For full repay, we need at least the current debt amount (with small buffer for interest accrual)
          const requiredWavax = repayMode === 'full' 
            ? currentAvaxDebt + (currentAvaxDebt * 1n) / 1000n // Add 0.1% buffer for interest accrual
            : finalRepayAmount;
            
          // If user doesn't have enough WAVAX, automatically wrap AVAX to WAVAX
          if (wavaxBalanceWei < requiredWavax) {
            const neededWavaxWei = requiredWavax - wavaxBalanceWei;
            const avaxBalanceWei = BigInt(avaxBalance.value);
            const minAvaxForGasWei = parseUnits('0.01', 18); // Reserve 0.01 AVAX for gas
            const neededAvaxWei = neededWavaxWei + minAvaxForGasWei; // Need AVAX for wrap + gas
            
            if (avaxBalanceWei >= neededAvaxWei) {
              // User has enough AVAX, automatically wrap it
              toast.info(`Wrapping ${formatUnits(neededWavaxWei, 18)} AVAX to WAVAX for repayment...`, {
                duration: 10000,
              });

              try {
                // Check if using Privy wallet for wrapping
                const privyWalletForWrap = wallets.find(w => w.address === address && w.walletClientType === 'privy');
                let wrapHash: Hex;
                
                if (authenticated && privyWalletForWrap) {
                  // Use ethers.js for Privy wallet wrapping
                  console.log('[ActionModal] Wrapping AVAX via Privy smart wallet');
                  
                  await privyWalletForWrap.switchChain(43114);
                  const ethereumProvider = await privyWalletForWrap.getEthereumProvider();
                  const ethersProvider = new ethers.BrowserProvider(ethereumProvider);
                  const signer = await ethersProvider.getSigner();
                  
                  const wavaxContract = new ethers.Contract(
                    CONTRACTS.WAVAX as string,
                    WAVAX_ABI,
                    signer
                  );
                  
                  const tx = await wavaxContract.deposit({
                    value: neededWavaxWei.toString(),
                    gasLimit: 100000,
                    maxFeePerGas: BigInt(Math.ceil(27 * 1e9)),
                    maxPriorityFeePerGas: BigInt(Math.ceil(2 * 1e9)),
                  });
                  
                  wrapHash = tx.hash as Hex;
                  
                  // Wait for wrap confirmation
                  toast.success('Wrapping AVAX to WAVAX... Waiting for confirmation...', {
                    action: {
                      label: 'View on Explorer',
                      onClick: () => window.open(getExplorerTxLink(avalanche.id, wrapHash), '_blank'),
                    },
                  });
                  
                  await tx.wait();
                  
                  toast.success('AVAX wrapped to WAVAX successfully!');
                  await refetchWavaxBalance();
                  
                  // Refetch balance to get updated WAVAX amount
                  const updatedBalance = await readContract(config, {
                    address: CONTRACTS.WAVAX as `0x${string}`,
                    abi: ERC20_ABI,
                    functionName: 'balanceOf',
                    args: [address!],
                  });

                  if (updatedBalance && BigInt(updatedBalance as bigint) < requiredWavax) {
                    toast.error(`Still insufficient WAVAX after wrap. Please try again or wrap more AVAX.`);
                    setIsProcessing(false);
                    return;
                  }
                } else {
                  // Use wagmi for external wallets
                  wrapHash = await writeContractAsync({
                    address: CONTRACTS.WAVAX as `0x${string}`,
                    abi: WAVAX_ABI,
                    functionName: 'deposit',
                    value: neededWavaxWei, // Send native AVAX to wrap
                    gas: 100000n,
                    gasPrice: BigInt(Math.ceil(27 * 1e9)),
                  });

                  if (!wrapHash) {
                    throw new Error('Wrap transaction failed - no hash returned');
                  }

                  toast.success('Wrapping AVAX to WAVAX... Waiting for confirmation...', {
                    action: {
                      label: 'View on Explorer',
                      onClick: () => window.open(getExplorerTxLink(avalanche.id, wrapHash), '_blank'),
                    },
                  });

                  // Wait for wrap confirmation
                  await new Promise(resolve => setTimeout(resolve, 3000));

                  const wrapReceipt = await waitForTransactionReceipt(config, {
                    hash: wrapHash as Hex,
                    timeout: 120_000,
                    pollingInterval: 2_000,
                  });

                  if (wrapReceipt.status !== 'success') {
                    throw new Error('Wrap transaction failed');
                  }

                  toast.success('AVAX wrapped to WAVAX successfully!');
                  await refetchWavaxBalance();

                  // Refetch balance to get updated WAVAX amount
                  const updatedBalance = await readContract(config, {
                    address: CONTRACTS.WAVAX as `0x${string}`,
                    abi: ERC20_ABI,
                    functionName: 'balanceOf',
                    args: [address!],
                  });

                  if (updatedBalance && BigInt(updatedBalance as bigint) < requiredWavax) {
                    toast.error(`Still insufficient WAVAX after wrap. Please try again or wrap more AVAX.`);
                    setIsProcessing(false);
                    return;
                  }
                }
              } catch (wrapError) {
                console.error('Wrap error:', wrapError);
                toast.error(`Failed to wrap AVAX: ${wrapError instanceof Error ? wrapError.message : 'Unknown error'}`);
                setIsProcessing(false);
                return;
              }
            } else {
              // Not enough AVAX either
              const requiredFormatted = formatUnits(requiredWavax, 18);
              toast.error(`Insufficient balance. You have ${wavaxBalance ? wavaxBalance.formatted : '0'} WAVAX and ${avaxBalance.formatted} AVAX, need ${requiredFormatted} WAVAX total (including gas).`, {
                duration: 10000,
              });
              setIsProcessing(false);
              return;
            }
          }

          // Choose repay amount based on mode
          // Full mode: use max to repay entire debt (safest, avoids interest accrual issues)
          // Partial mode: use exact amount (user requested specific amount)
          const repayAmountParam = repayMode === 'full'
            ? MAX_UINT256
            : finalRepayAmount; // For partial, use exact amount but add small buffer for interest

          if (repayMode === 'partial') {
            // For partial repay, add 0.5% buffer to account for interest accrual
            const buffer = (finalRepayAmount * 5n) / 1000n;
            finalRepayAmount = finalRepayAmount + buffer;
            console.log(`Partial repay mode: using ${formatUnits(finalRepayAmount, 18)} WAVAX (requested: ${amount} + 0.5% buffer)`);
          }

          // Check and handle WAVAX approval
          const currentAllowance = (wavaxAllowance as bigint) || 0n;
          if (currentAllowance < finalRepayAmount) {
            console.log('WAVAX allowance insufficient, approving...');
            toast.info('Approving WAVAX for repayment...');

            // Check if using Privy wallet for approval
            const privyWalletForApproval = wallets.find(w => w.address === address && w.walletClientType === 'privy');
            
            const maxApproval = MAX_UINT256;
            let approveHash: Hex;
            
            if (authenticated && privyWalletForApproval) {
              // Use ethers.js for Privy wallet approval
              console.log('[ActionModal] Approving WAVAX via Privy smart wallet');
              
              await privyWalletForApproval.switchChain(43114);
              const ethereumProvider = await privyWalletForApproval.getEthereumProvider();
              const ethersProvider = new ethers.BrowserProvider(ethereumProvider);
              const signer = await ethersProvider.getSigner();
              
              const wavaxContract = new ethers.Contract(
                CONTRACTS.WAVAX as string,
                ERC20_ABI,
                signer
              );
              
              const tx = await wavaxContract.approve(
                poolAddress,
                maxApproval.toString(),
                {
                  gasLimit: 100000,
                  maxFeePerGas: BigInt(Math.ceil(27 * 1e9)),
                  maxPriorityFeePerGas: BigInt(Math.ceil(2 * 1e9)),
                }
              );
              
              approveHash = tx.hash as Hex;
              
              // Wait for approval confirmation using ethers.js
              toast.success('WAVAX approval submitted! Waiting for confirmation...', {
                action: {
                  label: 'View on Explorer',
                  onClick: () => window.open(getExplorerTxLink(avalanche.id, approveHash), '_blank'),
                },
              });
              
              // Wait for the transaction to be mined
              await tx.wait();
              
              toast.success('WAVAX approved! Proceeding to repay...');
              await refetchWavaxAllowance();
            } else {
              // Use wagmi for external wallets
              approveHash = await writeContractAsync({
                address: CONTRACTS.WAVAX as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [poolAddress, maxApproval],
                gas: 100000n,
                gasPrice: BigInt(Math.ceil(27 * 1e9)), // Legacy gasPrice for Avalanche
              });

              if (!approveHash) {
                throw new Error('WAVAX approval failed - no hash returned');
              }

              toast.success('WAVAX approval submitted! Waiting for confirmation...', {
                action: {
                  label: 'View on Explorer',
                  onClick: () => window.open(getExplorerTxLink(avalanche.id, approveHash), '_blank'),
                },
              });

              // Wait for approval confirmation
              await new Promise(resolve => setTimeout(resolve, 3000));

              try {
                const approveReceipt = await waitForTransactionReceipt(config, {
                  hash: approveHash,
                  timeout: 120_000,
                  pollingInterval: 2_000,
                });

                if (approveReceipt.status !== 'success') {
                  throw new Error('WAVAX approval transaction failed');
                }

                toast.success('WAVAX approved! Proceeding to repay...');
                await refetchWavaxAllowance();
              } catch (timeoutError: unknown) {
                const error = timeoutError as { name?: string; message?: string };
                const isTimeout = error?.name === 'WaitForTransactionReceiptTimeoutError' || error?.message?.includes('Timed out');
                const isUnfinalized = error?.message?.includes('cannot query unfinalized data');

                if (isTimeout || isUnfinalized) {
                  toast.info('WAVAX approval submitted. Proceeding to repay...');
                  await refetchWavaxAllowance();
                } else {
                  throw timeoutError;
                }
              }
            }
          }

          console.log('Repay parameters:', {
            debt: currentDebtFormatted,
            repayAmount: 'type(uint256).max (full repayment)',
            wavaxBalance: wavaxBalance?.formatted || '0',
            requestedAmount: amount,
          });

          // Avalanche C-Chain uses legacy gasPrice (not EIP-1559)
          // But Privy smart wallets use EIP-1559, so we need both
          const minGasPriceGwei = 27; // 27 gwei minimum for Avalanche
          const gasPriceWei = BigInt(Math.ceil(minGasPriceGwei * 1e9));
          
          // For EIP-1559 (Privy smart wallets)
          const maxFeePerGas = gasPriceWei; // Use same as gasPrice for simplicity
          const maxPriorityFeePerGas = BigInt(Math.ceil(2 * 1e9)); // 2 gwei priority fee

          // Repay using WAVAX tokens (ERC-20) - NO native AVAX value sent
          // The pool will take WAVAX tokens from user's wallet via transferFrom
          let repayHash: Hex;

          // Check if using Privy wallet
          const privyWallet = wallets.find(w => w.address === address && w.walletClientType === 'privy');

          if (authenticated && privyWallet) {
            console.log('[ActionModal] Repaying via Privy smart wallet');

            try {
              // Ensure we're on the correct chain
              await privyWallet.switchChain(43114);
              
              // Get Ethereum provider from Privy wallet
              const ethereumProvider = await privyWallet.getEthereumProvider();
              
              // Wrap the provider with ethers.js to create a signer
              const ethersProvider = new ethers.BrowserProvider(ethereumProvider);
              const signer = await ethersProvider.getSigner();
              
              // Create contract instance and call repay
              const poolContract = new ethers.Contract(
                poolAddress as string,
                AAVE_POOL_ABI,
                signer
              );
              
              // Call repay with explicit gas parameters
              // Ethers.js v6 accepts BigInt directly for gas parameters
              const tx = await poolContract.repay(
                CONTRACTS.WAVAX as string,
                repayAmountParam.toString(), // Convert BigInt to string for ethers.js
                2n, // variable rate
                address,
                {
                  gasLimit: 500000,
                  maxFeePerGas: maxFeePerGas, // BigInt - ethers.js v6 accepts this directly
                  maxPriorityFeePerGas: maxPriorityFeePerGas, // BigInt - ethers.js v6 accepts this directly
                }
              );
              
              repayHash = tx.hash as Hex;
            } catch (privyError) {
              console.error('Privy repay error:', privyError);
              throw privyError;
            }
          } else {
            console.log('[ActionModal] Repaying via Wagmi/External wallet');
            // External wallet via Wagmi
            repayHash = await writeContractAsync({
              address: poolAddress as `0x${string}`,
              abi: AAVE_POOL_ABI,
              functionName: 'repay',
              args: [CONTRACTS.WAVAX as `0x${string}`, repayAmountParam, 2n, address as `0x${string}`],
              // NO value field - we're using WAVAX ERC-20 tokens, not native AVAX
              gas: 500000n,
              gasPrice: gasPriceWei, // Legacy gasPrice for Avalanche
            });
          }

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

              // Wait a moment for blockchain state to propagate
              await new Promise(resolve => setTimeout(resolve, 2000));

              // Explicitly refetch WAVAX user reserve data to get updated debt
              try {
                const updatedWavaxReserveData = await readContract(config, {
                  address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
                  abi: AAVE_DATA_PROVIDER_ABI,
                  functionName: 'getUserReserveData',
                  args: [CONTRACTS.WAVAX as `0x${string}`, address!],
                });

                if (updatedWavaxReserveData && Array.isArray(updatedWavaxReserveData)) {
                  const [, updatedStableDebt, updatedVariableDebt] = updatedWavaxReserveData;
                  const updatedDebt = (updatedStableDebt as bigint) + (updatedVariableDebt as bigint);
                  console.log('Updated AVAX debt after repay:', formatUnits(updatedDebt, 18));

                  if (updatedDebt > 0n) {
                    toast.info(`Remaining debt: ${formatUnits(updatedDebt, 18)} AVAX`);
                  } else {
                    toast.success('All debt repaid! Position closed.');
                  }
                }
              } catch (error) {
                console.warn('Could not fetch updated debt:', error);
              }

              // Refetch balances and positions
              await refetchWavaxBalance();

              // Explicitly refetch WAVAX reserve data to get updated debt
              if ('refetch' in positions && positions.refetch) {
                await positions.refetch();
              }

              // Force refetch all position-related queries
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });

              // Also invalidate all wagmi queries to force fresh reads
              queryClient.invalidateQueries({
                queryKey: ['readContract'],
                exact: false
              });

              // Wait a bit more for queries to refetch before closing
              await new Promise(resolve => setTimeout(resolve, 2000));

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

              // Wait for blockchain state to propagate
              await new Promise(resolve => setTimeout(resolve, 3000));

              // Try to fetch updated debt
              try {
                const updatedWavaxReserveData = await readContract(config, {
                  address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
                  abi: AAVE_DATA_PROVIDER_ABI,
                  functionName: 'getUserReserveData',
                  args: [CONTRACTS.WAVAX as `0x${string}`, address!],
                });

                if (updatedWavaxReserveData && Array.isArray(updatedWavaxReserveData)) {
                  const [, updatedStableDebt, updatedVariableDebt] = updatedWavaxReserveData;
                  const updatedDebt = (updatedStableDebt as bigint) + (updatedVariableDebt as bigint);
                  console.log('Updated AVAX debt after repay:', formatUnits(updatedDebt, 18));
                }
              } catch (error) {
                console.warn('Could not fetch updated debt:', error);
              }

              await refetchWavaxBalance();
              queryClient.invalidateQueries({ queryKey: ['balance'] });
              queryClient.invalidateQueries({ queryKey: ['aavePositions'] });
              queryClient.invalidateQueries({ queryKey: ['userBalancesExtended'] });
              queryClient.invalidateQueries({
                queryKey: ['readContract'],
                exact: false
              });

              setAmount('');
              setIsProcessing(false);
              onClose();
            } else {
              throw timeoutError;
            }
          }
          break;
        }

        case 'send': {
          if (!recipientAddress || !recipientAddress.startsWith('0x') || recipientAddress.length !== 42) {
            toast.error('Please enter a valid recipient address');
            setIsProcessing(false);
            return;
          }

          const sendAmountWei = parseUnits(amount, 6); // USDC 6 decimals
          let sendHash: Hex | undefined;

          // Detect if using Privy wallet
          const privyWallet = wallets.find(w => w.walletClientType === 'privy');

          if (authenticated && privyWallet) {
            console.log('[ActionModal] Transferring USDC via Privy smart wallet');

            // Encode USDC transfer(address to, uint256 amount)
            const data = encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'transfer',
              args: [recipientAddress as `0x${string}`, sendAmountWei],
            });

            try {
              const provider = await privyWallet.getEthereumProvider();
              const txHash = await provider.request({
                method: 'eth_sendTransaction',
                params: [{
                  to: CONTRACTS.USDC as `0x${string}`,
                  data: data as `0x${string}`,
                }],
              });
              sendHash = txHash as Hex;
            } catch (privyError) {
              console.error('Privy transfer error:', privyError);
              throw privyError;
            }
          } else {
            console.log('[ActionModal] Transferring USDC via Wagmi/External wallet');
            // External wallet via Wagmi
            const hash = await writeContractAsync({
              address: CONTRACTS.USDC as `0x${string}`,
              abi: ERC20_ABI,
              functionName: 'transfer',
              args: [recipientAddress as `0x${string}`, sendAmountWei],
              gas: 100000n,
            });
            sendHash = hash;
          }

          if (!sendHash) {
            throw new Error('Transfer failed - no hash returned');
          }

          toast.success('Transfer submitted! Waiting for confirmation...', {
            action: {
              label: 'View on Explorer',
              onClick: () => window.open(getExplorerTxLink(avalanche.id, sendHash!), '_blank'),
            },
          });

          // Wait for confirmation
          await new Promise(resolve => setTimeout(resolve, 3000));
          const receipt = await waitForTransactionReceipt(config, { hash: sendHash as Hex });

          if (receipt.status === 'success') {
            toast.success(`Successfully sent ${amount} USDC to ${recipientAddress.slice(0, 6)}...${recipientAddress.slice(-4)}`);
            queryClient.invalidateQueries({ queryKey: ['balance'] });
            setAmount('');
            setRecipientAddress('');
            setIsProcessing(false);
            onClose();
          } else {
            throw new Error('Transfer failed on-chain');
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
      case 'send':
        return { title: 'Send USDC', token: 'USDC', description: 'Send USDC to any wallet address' };
    }
  };

  const actionInfo = getActionInfo();

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-sm p-4 bg-background border border-border max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-3 text-foreground">{actionInfo.title}</h2>

        <div className="space-y-2.5">
          {/* Balance Display for Supply */}
          {action === 'supply' && usdcBalance && (
            <div className="bg-blue-500/10 p-2 rounded border border-blue-500/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Available Balance</div>
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

          {/* Balance Display for Repay */}
          {action === 'repay' && (
            <>
              {wavaxBalance && (
                <div className="bg-orange-500/10 p-2 rounded border border-orange-500/30">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground">WAVAX Balance</div>
                      <div className="text-base font-semibold text-orange-700">
                        {parseFloat(wavaxBalance.formatted).toFixed(4)} WAVAX
                      </div>
                    </div>
                    {avaxBalance && parseFloat(avaxBalance.formatted) > 0.01 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            setIsProcessing(true);
                            const wrapAmount = parseFloat(avaxBalance.formatted) - 0.01; // Leave 0.01 for gas
                            const wrapAmountWei = parseUnits(wrapAmount.toFixed(4), 18);

                            const wrapHash = await writeContractAsync({
                              address: CONTRACTS.WAVAX as `0x${string}`,
                              abi: WAVAX_ABI,
                              functionName: 'deposit',
                              value: wrapAmountWei,
                              gas: 100000n,
                              gasPrice: BigInt(Math.ceil(27 * 1e9)),
                            });

                            toast.success('Wrapping AVAX to WAVAX...', {
                              action: {
                                label: 'View on Explorer',
                                onClick: () => window.open(getExplorerTxLink(avalanche.id, wrapHash), '_blank'),
                              },
                            });

                            await waitForTransactionReceipt(config, {
                              hash: wrapHash as `0x${string}`,
                              timeout: 120_000,
                              pollingInterval: 2_000,
                            });

                            toast.success('AVAX wrapped to WAVAX successfully!');
                            await refetchWavaxBalance();
                          } catch (error) {
                            toast.error(`Wrap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                          } finally {
                            setIsProcessing(false);
                          }
                        }}
                        disabled={isProcessing}
                        className="text-xs"
                      >
                        Wrap AVAX
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {positions.avaxBorrowed && parseFloat(positions.avaxBorrowed) > 0 && (
                <div className="bg-red-500/10 p-2 rounded border border-red-500/30">
                  <div className="text-xs text-muted-foreground">Current Debt</div>
                  <div className="text-base font-semibold text-red-700">
                    {parseFloat(positions.avaxBorrowed).toFixed(4)} AVAX
                  </div>
                </div>
              )}
              {/* Repay Mode Toggle */}
              <div className="flex items-center gap-2 p-2 bg-muted rounded border border-border">
                <Label className="text-xs flex-1">Repay Mode:</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant={repayMode === 'full' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setRepayMode('full')}
                    disabled={isProcessing}
                    className="text-xs h-7"
                  >
                    Full Debt
                  </Button>
                  <Button
                    type="button"
                    variant={repayMode === 'partial' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setRepayMode('partial')}
                    disabled={isProcessing}
                    className="text-xs h-7"
                  >
                    Partial
                  </Button>
                </div>
              </div>
              {repayMode === 'full' && (
                <Alert className="py-2 bg-yellow-500/10 border-yellow-500/30">
                  <AlertDescription className="text-xs">
                    Full debt repayment (recommended) - repays entire debt to avoid interest accrual issues
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          {/* Recipient Input for Send */}
          {action === 'send' && (
            <div className="space-y-1.5">
              <Label htmlFor="recipient" className="text-sm">Recipient Address</Label>
              <Input
                id="recipient"
                placeholder="0x..."
                value={recipientAddress}
                onChange={(e) => setRecipientAddress(e.target.value)}
                disabled={isProcessing}
                className="text-xs"
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label htmlFor="amount" className="text-sm">{actionInfo.token} Amount</Label>
              {action === 'supply' && usdcBalance && (
                <span className="text-xs text-muted-foreground">
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
            {action === 'supply' && amount && usdcBalance && usdcBalance.value > 0n && (() => {
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

          <Alert className="py-2 bg-muted border-border">
            <AlertDescription className="text-xs text-muted-foreground">
              {actionInfo.description}
            </AlertDescription>
          </Alert>

          {/* Transaction Hash Display */}
          {hash && (
            <Alert className="py-2 bg-muted border-border">
              <AlertDescription className="text-xs text-foreground">
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
            <Alert className="bg-green-500/10 border-green-500/30 py-2">
              <AlertDescription className="text-xs text-foreground">
                <div className="font-semibold text-green-600">Current Aave Position</div>
                <div className="mt-0.5 text-foreground">Supplied: {parseFloat(positions.usdcSupply).toFixed(2)} USDC</div>
                {positions.usdcSupplyApy && (
                  <div>APY: {positions.usdcSupplyApy.toFixed(2)}%</div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Step Indicator for Supply */}
          {action === 'supply' && (
            <Alert className={`${step === 'approve' ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-blue-500/10 border-blue-500/30'} py-2`}>
              <AlertDescription className="text-xs text-foreground">
                <div className="font-semibold">
                  {step === 'approve' ? '📝 Step 1: Approve USDC' : '💰 Step 2: Supply to Aave V3'}
                </div>
                {step === 'supply' && (
                  <div className="text-xs mt-0.5 text-green-600">✅ Approval complete! Ready to supply.</div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Debug Info for Supply */}
          {action === 'supply' && poolAddress && (
            <Alert className="bg-muted border-border py-2">
              <AlertDescription className="text-xs text-foreground">
                <div>Pool: {poolAddress.slice(0, 8)}...{poolAddress.slice(-6)}</div>
                <div>Token: {CONTRACTS.USDC.slice(0, 8)}...{CONTRACTS.USDC.slice(-6)} (Native USDC)</div>
                {allowance !== undefined && (
                  <div>Allowance: {formatUnits(allowance, 6)} USDC</div>
                )}
                <div className="mt-0.5 text-muted-foreground">Current Step: {step}</div>
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
