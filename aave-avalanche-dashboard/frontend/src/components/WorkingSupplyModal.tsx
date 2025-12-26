import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAccount } from 'wagmi';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';
import { CONTRACTS } from '@/config/contracts';
import { toast } from 'sonner';
import { useAaveRates } from '@/hooks/useAaveRates';

// Minimal Aave Pool ABI
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

// Minimal ERC20 ABI
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
  }
] as const;

interface WorkingSupplyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WorkingSupplyModal({ isOpen, onClose }: WorkingSupplyModalProps) {
  const { address, isConnected } = useAccount();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { supplyAPY } = useAaveRates();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ 
    hash,
    confirmations: 1
  });
  
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'approve' | 'supply'>('approve');
  const [isProcessing, setIsProcessing] = useState(false);

  React.useEffect(() => {
    if (isConfirmed && hash) {
      console.log('Transaction confirmed:', hash);
      if (step === 'approve') {
        toast.success('USDC approved! Now you can supply to Aave.');
        setStep('supply');
        setIsProcessing(false);
      } else if (step === 'supply') {
        toast.success(`Successfully supplied ${amount} USDC to Aave!`);
        setAmount('');
        setStep('approve');
        setIsProcessing(false);
        onClose();
      }
    }
  }, [isConfirmed, hash, step, amount, onClose]);

  const handleApprove = async () => {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      setIsProcessing(true);
      
      const amountWei = parseUnits(amount, 6);
      
      console.log('Approving USDC for Aave...');
      console.log('Amount:', amount);
      console.log('Amount Wei:', amountWei.toString());
      console.log('Aave Pool:', CONTRACTS.AAVE_POOL);
      
      await writeContract({
        address: CONTRACTS.USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.AAVE_POOL as `0x${string}`, amountWei],
      });

      toast.success('Approval transaction submitted!');
      
    } catch (error) {
      console.error('Approval failed:', error);
      toast.error(`Approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsProcessing(false);
    }
  };

  const handleSupply = async () => {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    try {
      setIsProcessing(true);
      
      const amountWei = parseUnits(amount, 6);
      
      console.log('Supplying USDC to Aave...');
      console.log('Amount Wei:', amountWei.toString());
      
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

      toast.success('Supply transaction submitted!');
      
    } catch (error) {
      console.error('Supply failed:', error);
      toast.error(`Supply failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md p-6 bg-white">
        <h2 className="text-xl font-bold mb-4">
          {step === 'approve' ? 'Approve USDC' : 'Supply USDC to Aave'}
        </h2>
        
        <div className="space-y-4">
          <div>
            <Label htmlFor="amount">USDC Amount</Label>
            <Input
              id="amount"
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              disabled={step === 'supply'}
            />
          </div>

          {step === 'approve' ? (
            <Alert>
              <AlertDescription>
                First, approve USDC to be used by Aave Pool. This is a one-time approval for this amount.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>
                Now supply your USDC to Aave to earn interest at {supplyAPY.toFixed(2)}% APY.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isProcessing}>
              Cancel
            </Button>
            <Button 
              onClick={step === 'approve' ? handleApprove : handleSupply}
              disabled={isProcessing || isPending || isConfirming}
              className="flex-1"
            >
              {isProcessing || isPending ? 'Submitting...' : isConfirming ? 'Confirming...' : step === 'approve' ? 'Approve USDC' : 'Supply to Aave'}
            </Button>
          </div>

          {step === 'supply' && (
            <div className="text-xs text-gray-500 text-center">
              USDC approved! Click "Supply to Aave" to complete the deposit.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
