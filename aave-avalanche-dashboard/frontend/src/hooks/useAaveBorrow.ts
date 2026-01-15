import { useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { CONTRACTS, AAVE_POOL_ABI, ERC20_ABI } from '@/config/contracts';
import { config } from '@/config/wagmi';

export function useAaveBorrow() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending, data: hash } = useWriteContract();
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
    args: address ? [CONTRACTS.USDC as `0x${string}`, address] : undefined,
  });

  // Get AVAX borrowed amount
  const { data: avaxBorrowed, refetch: refetchAvaxBorrowed } = useReadContract({
    address: CONTRACTS.AAVE_POOL_DATA_PROVIDER as `0x${string}`,
    abi: [{ name: 'getUserReserveData', type: 'function', stateMutability: 'view', inputs: [{ name: 'asset', type: 'address' }, { name: 'user', type: 'address' }], outputs: [{ name: 'currentATokenBalance', type: 'uint256' }, { name: 'currentStableDebt', type: 'uint256' }, { name: 'currentVariableDebt', type: 'uint256' }] }] as const,
    functionName: 'getUserReserveData',
    args: address ? [CONTRACTS.WAVAX as `0x${string}`, address] : undefined,
  });

  // Get USDC allowance for repay
  const { data: usdcAllowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.USDC as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && poolAddress ? [address, poolAddress] : undefined,
  });

  // Refetch borrowed amounts after transaction confirmation
  useEffect(() => {
    if (isConfirmed && hash) {
      setTimeout(() => {
        refetchBorrowed();
        refetchAvaxBorrowed();
        refetchAllowance();
      }, 2000); // Wait 2 seconds for blockchain to index
    }
  }, [isConfirmed, hash, refetchBorrowed, refetchAvaxBorrowed, refetchAllowance]);

  // Borrow USDC from Aave
  const borrowUSDC = async (amount: string) => {
    if (!isConnected || !address || !poolAddress) {
      throw new Error('Wallet not connected');
    }

    const amountInWei = parseUnits(amount, 6);

    const txHash = await writeContractAsync({
      address: poolAddress as `0x${string}`,
      abi: AAVE_POOL_ABI,
      functionName: 'borrow',
      args: [CONTRACTS.USDC as `0x${string}`, amountInWei, 2n, 0, address as `0x${string}`],
    });

    return txHash;
  };

  // Borrow AVAX from Aave  
  const borrowAVAX = async (amount: string) => {
    if (!isConnected || !address || !poolAddress) {
      throw new Error('Wallet not connected');
    }

    const amountInWei = parseUnits(amount, 18);

    const txHash = await writeContractAsync({
      address: poolAddress as `0x${string}`,
      abi: AAVE_POOL_ABI,
      functionName: 'borrow',
      args: [CONTRACTS.WAVAX as `0x${string}`, amountInWei, 2n, 0, address as `0x${string}`],
    });

    return txHash;
  };

  // Repay USDC to Aave (requires approval first)
  const repayUSDC = async (amount: string) => {
    if (!isConnected || !address || !poolAddress) {
      throw new Error('Wallet not connected');
    }

    const amountInWei = parseUnits(amount, 6);

    // Refetch allowance to get latest value
    const { data: latestAllowance } = await refetchAllowance();
    const currentAllowance = latestAllowance || 0n;

    // Check and handle approval for USDC
    if (currentAllowance < amountInWei) {
      // Approve USDC for repayment
      const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
      const approveHash = await writeContractAsync({
        address: CONTRACTS.USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [poolAddress as `0x${string}`, maxApproval],
      });

      // Refetch and verify allowance after approval
      const { data: newAllowance } = await refetchAllowance();
      const verifiedAllowance = newAllowance || 0n;
      if (verifiedAllowance < amountInWei) {
        throw new Error('Approval succeeded but allowance is still insufficient');
      }
    }

    // Execute repay
    const repayHash = await writeContractAsync({
      address: poolAddress as `0x${string}`,
      abi: AAVE_POOL_ABI,
      functionName: 'repay',
      args: [CONTRACTS.USDC as `0x${string}`, amountInWei, 2n, address as `0x${string}`],
    });

    return repayHash;
  };

  // Repay AVAX to Aave
  const repayAVAX = async (amount: string) => {
    if (!isConnected || !address || !poolAddress) {
      throw new Error('Wallet not connected');
    }

    const amountInWei = parseUnits(amount, 18);

    const txHash = await writeContractAsync({
      address: poolAddress as `0x${string}`,
      abi: AAVE_POOL_ABI,
      functionName: 'repay',
      args: [CONTRACTS.WAVAX as `0x${string}`, amountInWei, 2n, address as `0x${string}`],
      value: amountInWei,
    });

    return txHash;
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
