import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';
import { CONTRACTS, AAVE_POOL_ABI } from '@/config/contracts';

export function useAaveSupply() {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  // Get current Pool address
  const { data: poolAddress } = useReadContract({
    address: CONTRACTS.AAVE_POOL_ADDRESSES_PROVIDER as `0x${string}`,
    abi: [{ name: 'getPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] }] as const,
    functionName: 'getPool',
  });

  console.log('Pool address:', poolAddress);

  // Get user's USDC balance
  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
    abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
  });

  // Get USDC allowance to Aave Pool
  const { data: usdcAllowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
    abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }] as const,
    functionName: 'allowance',
    args: address && poolAddress ? [address, poolAddress] : undefined,
  });

  // Supply USDC to Aave
  const supplyUSDC = async (amount: string) => {
    if (!isConnected || !address) {
      throw new Error('Wallet not connected');
    }

    if (!amount || Number(amount) <= 0) {
      throw new Error('Invalid amount');
    }

    console.log('Starting Aave V3 supply process with:', { amount, address });

    // Convert amount to wei (USDC has 6 decimals)
    const amountInWei = parseUnits(amount, 6);
    console.log('Amount in wei:', amountInWei.toString());

    // Use hardcoded pool address for Aave V3 on Avalanche
    const poolAddress = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';

    // Check current allowance
    const currentAllowance = usdcAllowance || 0n;
    console.log('Current allowance:', currentAllowance.toString(), 'Needed:', amountInWei.toString());

    // Step 1: Approve if needed
    if (currentAllowance < amountInWei) {
      console.log('Approving USDC for Aave Pool...');
      
      try {
        const approveHash = await writeContract({
          address: CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
          abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] }] as const,
          functionName: 'approve',
          args: [poolAddress as `0x${string}`, amountInWei],
        });
        
        console.log('Approval transaction hash:', approveHash);

        // Wait for approval confirmation
        const { waitForTransactionReceipt } = await import('@wagmi/core');
        const { config } = await import('@/config/wagmi');
        const approvalReceipt = await waitForTransactionReceipt(config, { 
          hash: approveHash,
          timeout: 30000
        });
        
        console.log('Approval confirmed:', approvalReceipt.status);
        
        if (approvalReceipt.status === 'reverted') {
          throw new Error('Approval transaction was reverted');
        }
        
        // Refetch allowance after approval
        console.log('Refetching allowance after approval...');
        const { data: newAllowanceData } = await refetchAllowance();
        
        // Check allowance again after refetch
        const newAllowance = newAllowanceData || 0n;
        console.log('New allowance after refetch:', newAllowance.toString());
        
        if (newAllowance < amountInWei) {
          console.error('Allowance still insufficient after approval!');
          throw new Error('Approval succeeded but allowance is still insufficient');
        }
      } catch (approvalError) {
        console.error('Approval failed:', approvalError);
        throw new Error(`Approval failed: ${approvalError instanceof Error ? approvalError.message : 'Unknown error'}`);
      }
    }

    // Step 2: Supply to Aave
    console.log('Supplying USDC to Aave Pool...');
    console.log('Supply parameters:', {
      poolAddress,
      usdcAddress: CONTRACTS.USDC, // Native USDC for Aave V3
      amountInWei,
      address,
      referralCode: 0
    });
    
    try {
      const supplyHash = await writeContract({
        address: poolAddress as `0x${string}`,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [
          CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
          amountInWei, // amount
          address, // onBehalfOf
          0 // referralCode
        ],
      });
      
      console.log('Supply transaction hash:', supplyHash);

      // Wait for supply confirmation
      const { waitForTransactionReceipt } = await import('@wagmi/core');
      const { config } = await import('@/config/wagmi');
      
      console.log('Waiting for supply confirmation...');
      const receipt = await waitForTransactionReceipt(config, { 
        hash: supplyHash,
        timeout: 30000
      });
      
      console.log('Supply transaction confirmed:', receipt);
      
      if (receipt.status === 'reverted') {
        console.error('Supply transaction was reverted');
        throw new Error('Supply transaction was reverted');
      }
    } catch (supplyError) {
      console.error('Supply transaction failed:', supplyError);
      throw new Error(`Supply failed: ${supplyError instanceof Error ? supplyError.message : 'Unknown error'}`);
    }

    // Refetch balances after successful transaction
    await refetchBalance();
    await refetchAllowance();
  };

  // Withdraw USDC from Aave
  const withdrawUSDC = async (amount: string) => {
    if (!isConnected || !address) {
      throw new Error('Wallet not connected');
    }

    const amountInWei = parseUnits(amount, 6);
    const poolAddress = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';

    console.log('Withdrawing USDC from Aave Pool:', { amount, amountInWei });

    const withdrawHash = await writeContract({
      address: poolAddress as `0x${string}`,
      abi: AAVE_POOL_ABI,
      functionName: 'withdraw',
      args: [
        CONTRACTS.USDC as `0x${string}`, // Native USDC for Aave V3
        amountInWei, // amount
        address // to
      ],
    });

    console.log('Withdraw transaction hash:', withdrawHash);

    // Wait for withdrawal confirmation
    const { waitForTransactionReceipt } = await import('@wagmi/core');
    const { config } = await import('@/config/wagmi');
    const receipt = await waitForTransactionReceipt(config, { 
      hash: withdrawHash,
      timeout: 30000
    });

    console.log('Withdraw transaction confirmed:', receipt);

    if (receipt.status === 'reverted') {
      throw new Error('Withdraw transaction was reverted');
    }

    // Refetch balances after successful transaction
    await refetchBalance();
  };

  // Enable/disable USDC as collateral
  const setCollateral = async (enable: boolean) => {
    if (!isConnected || !address || !poolAddress) {
      throw new Error('Wallet not connected');
    }

    await writeContract({
      address: poolAddress,
      abi: [
        {
          name: 'setUserUseReserveAsCollateral',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [{ name: 'asset', type: 'address' }, { name: 'useAsCollateral', type: 'bool' }],
          outputs: []
        }
      ] as const,
      functionName: 'setUserUseReserveAsCollateral',
      args: [CONTRACTS.USDC as `0x${string}`, enable], // Native USDC for Aave V3
    });
  };

  return {
    // Data
    usdcBalance: usdcBalance ? formatUnits(usdcBalance, 6) : '0',
    usdcAllowance: usdcAllowance ? formatUnits(usdcAllowance, 6) : '0',
    poolAddress,
    
    // Actions
    supplyUSDC,
    withdrawUSDC,
    setCollateral,
    
    // Loading states
    isPending,
    isConfirming,
    isConfirmed,
    hash,
    
    // Refetch functions
    refetchBalance,
    refetchAllowance,
  };
}
