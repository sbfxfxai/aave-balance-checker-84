import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, formatUnits } from 'viem';

// TiltVaultManager contract address on Avalanche mainnet
export const TILTVAULT_MANAGER_ADDRESS = '0x58d5D205C1b88E763FE2Dca297401a365191b7eA' as const;

// Contract ABIs
const TILTVAULT_MANAGER_ABI = [
  // Authorization functions
  {
    name: 'authorizeManager',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'revokeAccess',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'isAuthorized',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'checkAuthorization',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'getUserAllowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getUserATokenAllowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  // AAVE functions (called by backend)
  {
    name: 'depositToAave',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'withdrawFromAave',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  // GMX functions (called by backend)
  {
    name: 'addGmxCollateral',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'executionFee', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'removeGmxCollateral',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'executionFee', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'closeGmxPosition',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'sizeDeltaUsd', type: 'uint256' },
      { name: 'executionFee', type: 'uint256' },
    ],
    outputs: [],
  },
  // Events
  {
    name: 'UserAuthorized',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'UserRevoked',
    type: 'event',
    inputs: [
      { name: 'user', type: 'address', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
] as const;

const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// Token addresses on Avalanche
const USDC_ADDRESS = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' as const;
const aUSDC_ADDRESS = '0x625E7708f30cA75bfd92586e17077590C60eb4cD' as const;

export interface TiltVaultManagerState {
  isAuthorized: boolean;
  usdcAllowance: bigint;
  aUsdcAllowance: bigint;
  isLoading: boolean;
  error: string | null;
}

export function useTiltVaultManager() {
  const { address, isConnected } = useAccount();
  const [pendingTxHash, setPendingTxHash] = useState<`0x${string}` | undefined>();

  // Read authorization status
  const { data: isAuthorized, refetch: refetchAuth } = useReadContract({
    address: TILTVAULT_MANAGER_ADDRESS,
    abi: TILTVAULT_MANAGER_ABI,
    functionName: 'isAuthorized',
    args: address ? [address] : undefined,
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Read USDC allowance
  const { data: usdcAllowance, refetch: refetchUsdcAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, TILTVAULT_MANAGER_ADDRESS] : undefined,
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Read aUSDC allowance (for withdrawals)
  const { data: aUsdcAllowance, refetch: refetchAUsdcAllowance } = useReadContract({
    address: aUSDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address ? [address, TILTVAULT_MANAGER_ADDRESS] : undefined,
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Write contract hooks
  const { writeContract, isPending: isWritePending } = useWriteContract();

  // Wait for transaction
  const { isLoading: isWaitingForTx } = useWaitForTransactionReceipt({
    hash: pendingTxHash,
  });

  // Authorize TiltVault Manager
  const authorize = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected');

    return new Promise<`0x${string}`>((resolve, reject) => {
      writeContract(
        {
          address: TILTVAULT_MANAGER_ADDRESS,
          abi: TILTVAULT_MANAGER_ABI,
          functionName: 'authorizeManager',
        },
        {
          onSuccess: (hash) => {
            setPendingTxHash(hash);
            resolve(hash);
          },
          onError: (error) => {
            reject(error);
          },
        }
      );
    });
  }, [address, writeContract]);

  // Revoke TiltVault Manager access
  const revoke = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected');

    return new Promise<`0x${string}`>((resolve, reject) => {
      writeContract(
        {
          address: TILTVAULT_MANAGER_ADDRESS,
          abi: TILTVAULT_MANAGER_ABI,
          functionName: 'revokeAccess',
        },
        {
          onSuccess: (hash) => {
            setPendingTxHash(hash);
            resolve(hash);
          },
          onError: (error) => {
            reject(error);
          },
        }
      );
    });
  }, [address, writeContract]);

  // Approve USDC to TiltVault Manager
  const approveUsdc = useCallback(async (amount: string) => {
    if (!address) throw new Error('Wallet not connected');

    const amountWei = parseUnits(amount, 6); // USDC has 6 decimals

    return new Promise<`0x${string}`>((resolve, reject) => {
      writeContract(
        {
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [TILTVAULT_MANAGER_ADDRESS, amountWei],
        },
        {
          onSuccess: (hash) => {
            setPendingTxHash(hash);
            resolve(hash);
          },
          onError: (error) => {
            reject(error);
          },
        }
      );
    });
  }, [address, writeContract]);

  // Approve aUSDC to TiltVault Manager (for withdrawals)
  const approveAUsdc = useCallback(async (amount: string) => {
    if (!address) throw new Error('Wallet not connected');

    const amountWei = parseUnits(amount, 6); // aUSDC has 6 decimals

    return new Promise<`0x${string}`>((resolve, reject) => {
      writeContract(
        {
          address: aUSDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [TILTVAULT_MANAGER_ADDRESS, amountWei],
        },
        {
          onSuccess: (hash) => {
            setPendingTxHash(hash);
            resolve(hash);
          },
          onError: (error) => {
            reject(error);
          },
        }
      );
    });
  }, [address, writeContract]);

  // Approve unlimited USDC
  const approveUnlimitedUsdc = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected');

    const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

    return new Promise<`0x${string}`>((resolve, reject) => {
      writeContract(
        {
          address: USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [TILTVAULT_MANAGER_ADDRESS, maxUint256],
        },
        {
          onSuccess: (hash) => {
            setPendingTxHash(hash);
            resolve(hash);
          },
          onError: (error) => {
            reject(error);
          },
        }
      );
    });
  }, [address, writeContract]);

  // Approve unlimited aUSDC
  const approveUnlimitedAUsdc = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected');

    const maxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

    return new Promise<`0x${string}`>((resolve, reject) => {
      writeContract(
        {
          address: aUSDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [TILTVAULT_MANAGER_ADDRESS, maxUint256],
        },
        {
          onSuccess: (hash) => {
            setPendingTxHash(hash);
            resolve(hash);
          },
          onError: (error) => {
            reject(error);
          },
        }
      );
    });
  }, [address, writeContract]);

  // Refetch all data
  const refetch = useCallback(async () => {
    await Promise.all([
      refetchAuth(),
      refetchUsdcAllowance(),
      refetchAUsdcAllowance(),
    ]);
  }, [refetchAuth, refetchUsdcAllowance, refetchAUsdcAllowance]);

  return {
    // State
    isAuthorized: isAuthorized ?? false,
    usdcAllowance: usdcAllowance ?? BigInt(0),
    aUsdcAllowance: aUsdcAllowance ?? BigInt(0),
    isLoading: isWritePending || isWaitingForTx,
    pendingTxHash,
    
    // Actions
    authorize,
    revoke,
    approveUsdc,
    approveAUsdc,
    approveUnlimitedUsdc,
    approveUnlimitedAUsdc,
    refetch,
    
    // Helpers
    formatUsdcAllowance: () => usdcAllowance ? formatUnits(usdcAllowance, 6) : '0',
    formatAUsdcAllowance: () => aUsdcAllowance ? formatUnits(aUsdcAllowance, 6) : '0',
    hasUnlimitedUsdcApproval: () => usdcAllowance ? usdcAllowance > parseUnits('1000000000', 6) : false,
    hasUnlimitedAUsdcApproval: () => aUsdcAllowance ? aUsdcAllowance > parseUnits('1000000000', 6) : false,
  };
}

export default useTiltVaultManager;
