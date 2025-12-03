import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { CONTRACTS, AAVE_POOL_ABI } from '@/config/contracts';

export function useAaveBorrow() {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  // Get current Pool address
  const { data: poolAddress } = useReadContract({
    address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
    abi: [{ name: 'getPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }] as const,
    functionName: 'getPool',
  });

  // Get user's borrowed amounts
  const { data: usdcBorrowed, refetch: refetchBorrowed } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: [{ name: 'getUserReserveData', type: 'function', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }, { name: 'user', type: 'address' }], outputs: [{ name: 'currentATokenBalance', type: 'uint256' }, { name: 'currentStableDebt', type: 'uint256' }, { name: 'currentVariableDebt', type: 'uint256' }] }] as const,
    functionName: 'getUserReserveData',
    args: address ? [CONTRACTS.USDC as `0x${string}`, address] : undefined, // Native USDC for Aave V3
  });

  // Get AVAX borrowed amount
  const { data: avaxBorrowed, refetch: refetchAvaxBorrowed } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: [{ name: 'getUserReserveData', type: 'function', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }, { name: 'user', type: 'address' }], outputs: [{ name: 'currentATokenBalance', type: 'uint256' }, { name: 'currentStableDebt', type: 'uint256' }, { name: 'currentVariableDebt', type: 'uint256' }] }] as const,
    functionName: 'getUserReserveData',
    args: address ? [CONTRACTS.WAVAX as `0x${string}`, address] : undefined,
  });

  // Borrow USDC from Aave
  const borrowUSDC = async (amount: string) => {
    if (!isConnected || !address || !poolAddress) {
      throw new Error('Wallet not connected');
    }

    // Convert amount to wei (USDC has 6 decimals)
    const amountInWei = parseUnits(amount, 6);

    await writeContract({
      address: poolAddress as `0x${string}`,
      abi: AAVE_POOL_ABI,
      functionName: 'borrow',
      args: [CONTRACTS.USDC as `0x${string}`, amountInWei, 2n, 0, address as `0x${string}`], // Native USDC for Aave V3, variable rate
    });

    // Refetch borrowed amounts after successful transaction
    if (isConfirmed) {
      refetchBorrowed();
    }
  };

  // Borrow AVAX from Aave  
  const borrowAVAX = async (amount: string) => {
    if (!isConnected || !address || !poolAddress) {
      throw new Error('Wallet not connected');
    }

    // Convert amount to wei (AVAX has 18 decimals)
    const amountInWei = parseUnits(amount, 18);

    await writeContract({
      address: poolAddress as `0x${string}`,
      abi: AAVE_POOL_ABI,
      functionName: 'borrow',
      args: [CONTRACTS.WAVAX as `0x${string}`, amountInWei, 2n, 0, address as `0x${string}`], // 2 = variable rate, referralCode = 0
    });

    // Refetch borrowed amounts after successful transaction
    if (isConfirmed) {
      refetchAvaxBorrowed();
    }
  };

  // Repay USDC to Aave
  const repayUSDC = async (amount: string) => {
    if (!isConnected || !address || !poolAddress) {
      throw new Error('Wallet not connected');
    }

    const amountInWei = parseUnits(amount, 6);

    await writeContract({
      address: poolAddress as `0x${string}`,
      abi: AAVE_POOL_ABI,
      functionName: 'repay',
      args: [CONTRACTS.USDC as `0x${string}`, amountInWei, 2n, address as `0x${string}`], // Native USDC for Aave V3, variable rate
    });

    // Refetch borrowed amounts after successful transaction
    if (isConfirmed) {
      refetchBorrowed();
    }
  };

  // Repay AVAX to Aave
  const repayAVAX = async (amount: string) => {
    if (!isConnected || !address || !poolAddress) {
      throw new Error('Wallet not connected');
    }

    const amountInWei = parseUnits(amount, 18);

    await writeContract({
      address: poolAddress as `0x${string}`,
      abi: AAVE_POOL_ABI,
      functionName: 'repay',
      args: [CONTRACTS.WAVAX as `0x${string}`, amountInWei, 2n, address as `0x${string}`], // 2 = variable rate
      value: amountInWei, // AVAX repayments require native value
    });

    // Refetch borrowed amounts after successful transaction
    if (isConfirmed) {
      refetchAvaxBorrowed();
    }
  };

  // Calculate borrowed amounts
  const usdcBorrowedAmount = usdcBorrowed ? 
    formatUnits((usdcBorrowed[1] || 0n) + (usdcBorrowed[2] || 0n), 6) : '0';
  
  const avaxBorrowedAmount = avaxBorrowed ? 
    formatUnits((avaxBorrowed[1] || 0n) + (avaxBorrowed[2] || 0n), 18) : '0';

  return {
    // Data
    usdcBorrowed: usdcBorrowedAmount,
    avaxBorrowed: avaxBorrowedAmount,
    poolAddress,
    
    // Actions
    borrowUSDC,
    borrowAVAX,
    repayUSDC,
    repayAVAX,
    
    // Loading states
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    
    // Refetch functions
    refetchBorrowed,
    refetchAvaxBorrowed,
  };
}
