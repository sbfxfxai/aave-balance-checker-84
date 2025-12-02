import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits } from 'viem';
import { avalanche } from 'wagmi/chains';
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
import { ArrowDown, Loader2, ArrowDownToLine } from 'lucide-react';
import { toast } from 'sonner';
import { CONTRACTS, AAVE_POOL_ABI, ROUTER_ABI, ERC20_ABI } from '@/config/contracts';

export function WithdrawModal() {
  const [amount, setAmount] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<'withdraw' | 'approve' | 'swap'>('withdraw');
  const { address } = useAccount();
  const { write: writeWithdraw, data: withdrawHash, isLoading: isWithdrawLoading } = useWriteContract();
  
  const { write: writeApprove, data: approveHash, isLoading: isApproveLoading } = useWriteContract();
  
  const { write: writeSwap, data: swapHash, isLoading: isSwapLoading } = useWriteContract();
  
  const hash = withdrawHash || approveHash || swapHash;
  
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash,
  });

  const isLoading = isWithdrawLoading || isApproveLoading || isSwapLoading || isConfirming;

  const handleWithdraw = () => {
    if (!amount || !address) return;

    try {
      const amountInWei = parseUnits(amount, 6); // USDC has 6 decimals

      writeWithdraw({
        address: CONTRACTS.AAVE_POOL as `0x${string}`,
        abi: AAVE_POOL_ABI,
        functionName: 'withdraw',
        args: [CONTRACTS.USDC_E as `0x${string}`, amountInWei, address],
      });

      toast.success('Withdrawal initiated!');
      setStep('approve');
    } catch (error) {
      toast.error('Withdrawal failed');
      console.error(error);
    }
  };

  const handleApprove = () => {
    if (!amount) return;

    try {
      const amountInWei = parseUnits(amount, 6);

      writeApprove({
        address: CONTRACTS.USDC_E as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`, amountInWei],
      });

      toast.success('Approval successful!');
      setStep('swap');
    } catch (error) {
      toast.error('Approval failed');
      console.error(error);
    }
  };

  const handleSwap = () => {
    if (!amount || !address) return;

    try {
      const amountInWei = parseUnits(amount, 6);
      const path = [CONTRACTS.USDC_E, CONTRACTS.WAVAX];
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

      writeSwap({
        address: CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`,
        abi: ROUTER_ABI,
        functionName: 'swapExactTokensForAVAX',
        args: [amountInWei, 0n, path as `0x${string}`[], address, BigInt(deadline)],
      });

      toast.success('Swapped to AVAX successfully!');
      setIsOpen(false);
      setAmount('');
      setStep('withdraw');
    } catch (error) {
      toast.error('Swap failed');
      console.error(error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="lg" variant="outline" className="border-primary text-primary hover:bg-primary/10">
          <ArrowDownToLine className="mr-2 h-5 w-5" />
          Withdraw to AVAX
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw from Aave</DialogTitle>
          <DialogDescription>
            Your USDC will be withdrawn and swapped back to AVAX
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="withdraw-amount">Amount (USDC)</Label>
            <Input
              id="withdraw-amount"
              type="number"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={step !== 'withdraw' || isLoading}
              className="text-lg"
            />
          </div>

          {/* Visual Flow */}
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex items-center justify-between w-full">
              <div className="flex-1 text-center p-3 rounded-lg bg-accent/10">
                <p className="text-sm text-muted-foreground">From</p>
                <p className="text-lg font-bold text-accent">USDC</p>
              </div>
              <ArrowDown className="mx-4 h-5 w-5 text-muted-foreground" />
              <div className="flex-1 text-center p-3 rounded-lg bg-primary/10">
                <p className="text-sm text-muted-foreground">To</p>
                <p className="text-lg font-bold text-primary">AVAX</p>
              </div>
            </div>

            {/* Progress Steps */}
            <div className="flex items-center justify-between w-full text-xs">
              <div className={`text-center ${step === 'withdraw' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                1. Withdraw
              </div>
              <div className={`text-center ${step === 'approve' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                2. Approve
              </div>
              <div className={`text-center ${step === 'swap' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                3. Swap
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          {step === 'withdraw' && (
            <Button
              onClick={handleWithdraw}
              disabled={!amount || isLoading}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Withdrawing...
                </>
              ) : (
                'Withdraw from Aave'
              )}
            </Button>
          )}

          {step === 'approve' && (
            <Button
              onClick={handleApprove}
              disabled={isLoading}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Approving...
                </>
              ) : (
                'Approve USDC'
              )}
            </Button>
          )}

          {step === 'swap' && (
            <Button
              onClick={handleSwap}
              disabled={isLoading}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Swapping...
                </>
              ) : (
                'Swap to AVAX'
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
