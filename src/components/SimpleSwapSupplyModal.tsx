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
import { ArrowDownUp } from 'lucide-react';

// Trader Joe Router ABI
const TRADER_JOE_ROUTER_ABI = [
  {
    name: 'swapExactAVAXForTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' }
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }]
  }
] as const;

// ERC20 ABI for approve
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

interface SimpleSwapSupplyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SimpleSwapSupplyModal({ isOpen, onClose }: SimpleSwapSupplyModalProps) {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash });

  const [avaxAmount, setAvaxAmount] = useState('');
  const [usdcAmount, setUsdcAmount] = useState('');
  const [step, setStep] = useState<'swap' | 'supply'>('swap');
  const [isProcessing, setIsProcessing] = useState(false);

  // Simple exchange rate (1 AVAX ≈ $30, so 1 AVAX ≈ 30 USDC)
  const avaxToUsdcRate = 30;
  
  const handleAvaxChange = (value: string) => {
    setAvaxAmount(value);
    const usdc = parseFloat(value || '0') * avaxToUsdcRate;
    setUsdcAmount(usdc.toFixed(2));
  };

  const handleSwap = async () => {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!avaxAmount || parseFloat(avaxAmount) <= 0) {
      toast.error('Please enter a valid AVAX amount');
      return;
    }

    try {
      setIsProcessing(true);
      
      const avaxAmountWei = parseUnits(avaxAmount, 18);
      const usdcAmountWei = parseUnits(usdcAmount, 6);
      
      // Swap path: WAVAX → USDC
      const swapPath = [CONTRACTS.WAVAX, CONTRACTS.USDC];
      
      console.log('Swapping AVAX for USDC...');
      console.log('AVAX Amount:', avaxAmountWei.toString());
      console.log('Expected USDC:', usdcAmountWei.toString());
      
      await writeContract({
        address: CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`,
        abi: TRADER_JOE_ROUTER_ABI,
        functionName: 'swapExactAVAXForTokens',
        args: [
          usdcAmountWei, // minimum USDC to receive (allow 2% slippage)
          swapPath,
          address,
          BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour deadline
        ],
        value: avaxAmountWei,
      });

      toast.success('Swap transaction submitted!');
      
    } catch (error) {
      console.error('Swap failed:', error);
      toast.error(`Swap failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      
      const usdcAmountWei = parseUnits(usdcAmount, 6);
      
      console.log('Supplying USDC to Aave...');
      console.log('USDC Amount:', usdcAmountWei.toString());
      
      // First approve USDC to Aave Pool
      console.log('Approving USDC for Aave Pool...');
      await writeContract({
        address: CONTRACTS.USDC as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.AAVE_POOL as `0x${string}`, usdcAmountWei],
      });

      console.log('USDC approved for Aave Pool');

      // Then supply to Aave
      console.log('Calling Aave supply function...');
      await writeContract({
        address: CONTRACTS.AAVE_POOL as `0x${string}`,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [
          CONTRACTS.USDC as `0x${string}`,
          usdcAmountWei,
          address,
          0 // referral code
        ],
      });

      console.log('USDC supplied to Aave');

      toast.success(`Successfully supplied ${usdcAmount} USDC to Aave!`);
      setAvaxAmount('');
      setUsdcAmount('');
      setIsProcessing(false);
      setStep('swap');
      onClose();
    } catch (error) {
      console.error('Supply failed:', error);
      toast.error(`Supply failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsProcessing(false);
    }
  };

  React.useEffect(() => {
    if (isConfirmed && hash && step === 'swap') {
      console.log('Swap confirmed! You can now supply the USDC to Aave.');
      toast.success('Swap completed! You can now supply the USDC to Aave.');
      setStep('supply');
      setIsProcessing(false);
    }
  }, [isConfirmed, hash, step]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md p-6 bg-white">
        <h2 className="text-xl font-bold mb-4">
          {step === 'swap' ? 'Swap AVAX → USDC' : 'Supply USDC to Aave'}
        </h2>
        
        <div className="space-y-4">
          {step === 'swap' ? (
            <>
              <div>
                <Label htmlFor="avax-amount">AVAX Amount</Label>
                <Input
                  id="avax-amount"
                  type="number"
                  placeholder="0.00"
                  value={avaxAmount}
                  onChange={(e) => handleAvaxChange(e.target.value)}
                  step="0.001"
                />
              </div>

              <div className="flex justify-center">
                <ArrowDownUp className="h-5 w-5 text-gray-400" />
              </div>

              <div>
                <Label htmlFor="usdc-amount">USDC You'll Receive (≈)</Label>
                <Input
                  id="usdc-amount"
                  type="number"
                  placeholder="0.00"
                  value={usdcAmount}
                  readOnly
                  className="bg-gray-50"
                />
              </div>

              <Alert>
                <AlertDescription>
                  This will swap your AVAX for USDC on Trader Joe DEX.
                </AlertDescription>
              </Alert>

              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose} disabled={isProcessing}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSwap} 
                  disabled={isProcessing || isPending || isConfirming}
                  className="flex-1"
                >
                  {isProcessing ? 'Swapping...' : isPending ? 'Submitting...' : isConfirming ? 'Confirming...' : 'Swap AVAX'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-center py-4">
                <div className="text-lg font-semibold mb-2">Swap Completed!</div>
                <div className="text-gray-600 mb-4">
                  You received approximately {usdcAmount} USDC
                </div>
                <div className="text-sm text-gray-500">
                  Now supply it to Aave to earn interest.
                </div>
              </div>

              <Alert>
                <AlertDescription>
                  Supply your USDC to Aave to earn {avaxToUsdcRate}% APY.
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
                  {isProcessing ? 'Supplying...' : isPending ? 'Submitting...' : isConfirming ? 'Confirming...' : 'Supply USDC to Aave'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
