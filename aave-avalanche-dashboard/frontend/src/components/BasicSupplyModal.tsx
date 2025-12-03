import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAccount, useBalance } from 'wagmi';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';
import { CONTRACTS } from '@/config/contracts';
import { toast } from 'sonner';
import { ArrowDownUp } from 'lucide-react';

// Simple ERC20 ABI for USDC
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: []
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

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
  }
] as const;

interface BasicSupplyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BasicSupplyModal({ isOpen, onClose }: BasicSupplyModalProps) {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });
  
  // Get USDC balance
  const { data: usdcBalance } = useBalance({
    address: address,
    token: CONTRACTS.USDC as `0x${string}`,
    query: {
      enabled: !!address,
    },
  });

  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSupply = async () => {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    const usdcBalanceNum = parseFloat(usdcBalance?.formatted || '0');
    if (parseFloat(amount) > usdcBalanceNum) {
      toast.error('Insufficient USDC balance');
      return;
    }

    try {
      setIsProcessing(true);
      
      const amountWei = parseUnits(amount, 6);
      
      console.log('Supplying USDC to Aave...');
      console.log('Amount:', amount);
      console.log('Amount Wei:', amountWei.toString());
      console.log('USDC Balance:', usdcBalance?.formatted);
      
      // Step 1: Approve USDC to Aave Pool
      console.log('Step 1: Approving USDC for Aave Pool...');
      await writeContract({
        address: CONTRACTS.USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.AAVE_POOL as `0x${string}`, amountWei],
      });

      console.log('USDC approved for Aave Pool');
      toast.success('USDC approved! Now supplying to Aave...');

      // Wait a moment for approval
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 2: Supply to Aave
      console.log('Step 2: Supplying USDC to Aave...');
      await writeContract({
        address: CONTRACTS.AAVE_POOL as `0x${string}`,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [
          CONTRACTS.USDC as `0x${string}`,
          amountWei,
          address,
          0 // referral code
        ],
      });

      console.log('USDC supplied to Aave');
      
    } catch (error) {
      console.error('Supply failed:', error);
      toast.error(`Supply failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsProcessing(false);
    }
  };

  React.useEffect(() => {
    if (isConfirmed && hash) {
      toast.success(`Successfully supplied ${amount} USDC to Aave!`);
      setAmount('');
      setIsProcessing(false);
      onClose();
    }
  }, [isConfirmed, hash]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md p-6 bg-white">
        <h2 className="text-xl font-bold mb-4">Supply USDC to Aave</h2>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="usdc-balance">Your USDC Balance</Label>
            <Input
              id="usdc-balance"
              value={usdcBalance?.formatted || '0.00'}
              readOnly
              className="bg-gray-50"
            />
          </div>

          <div>
            <Label htmlFor="supply-amount">Amount to Supply</Label>
            <Input
              id="supply-amount"
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              max={usdcBalance?.formatted || '0'}
            />
          </div>

          <Alert>
            <AlertDescription>
              Supply your USDC to Aave to earn interest. Current APY: ~3.14%
            </AlertDescription>
          </Alert>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isProcessing}>
              Cancel
            </Button>
            <Button 
              onClick={handleSupply} 
              disabled={isProcessing || isPending || isConfirming}
              className="flex-1"
            >
              {isProcessing ? 'Processing...' : isPending ? 'Submitting...' : isConfirming ? 'Confirming...' : 'Supply USDC'}
            </Button>
          </div>

          <div className="text-xs text-gray-500 text-center">
            Note: Make sure you have USDC in your wallet first. 
            You can swap AVAX for USDC on Trader Joe DEX separately.
          </div>
        </div>
      </Card>
    </div>
  );
}
