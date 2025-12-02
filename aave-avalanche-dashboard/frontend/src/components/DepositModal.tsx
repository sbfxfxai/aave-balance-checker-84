import React, { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { readContract } from '@wagmi/core';
import { parseEther } from 'viem';
import { avalanche } from 'wagmi/chains';
import { CONTRACTS, ERC20_ABI, ROUTER_ABI, AAVE_POOL_ABI } from '@/config/contracts';
import { toast } from 'sonner';
import { Loader2, ArrowDown, Plus } from 'lucide-react';
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
import { config } from '@/config/wagmi';

export function DepositModal() {
  const [amount, setAmount] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<'swap' | 'approve' | 'supply'>('swap');
  const { address } = useAccount();
  const [usdcBalance, setUsdcBalance] = React.useState<bigint>(0n);
  const [allowance, setAllowance] = React.useState<bigint>(0n);

  // Contract write hooks
  const writeSwap = useWriteContract();
  const writeApprove = useWriteContract();
  const writeSupply = useWriteContract();

  const hash = writeSwap.data || writeApprove.data || writeSupply.data;
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash,
  });

  const isLoading = writeSwap.isPending || writeApprove.isPending || writeSupply.isPending || isConfirming;

  // Fetch USDC balance
  const fetchUsdcBalance = React.useCallback(async () => {
    if (!address) return;
    try {
      const { data: balance } = await readContract(config, {
        address: CONTRACTS.USDC_E as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      });
      setUsdcBalance(balance as bigint);
    } catch (error) {
      console.error('Error fetching USDC balance:', error);
    }
  }, [address]);

  // Fetch allowance
  const fetchAllowance = React.useCallback(async () => {
    if (!address) return;
    try {
      const { data: allowance } = await readContract(config, {
        address: CONTRACTS.USDC_E as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, CONTRACTS.AAVE_POOL as `0x${string}`],
      });
      setAllowance(allowance as bigint);
    } catch (error) {
      console.error('Error fetching allowance:', error);
    }
  }, [address]);

  // Set up polling for data
  React.useEffect(() => {
    fetchUsdcBalance();
    fetchAllowance();
    const interval = setInterval(() => {
      fetchUsdcBalance();
      fetchAllowance();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchUsdcBalance, fetchAllowance]);

  // Refresh data after successful transaction
  React.useEffect(() => {
    if (hash && !isConfirming) {
      fetchUsdcBalance();
      fetchAllowance();
    }
  }, [hash, isConfirming, fetchUsdcBalance, fetchAllowance]);

  const handleSwap = async () => {
    if (!amount || !address) return;

    try {
      const path = [CONTRACTS.WAVAX, CONTRACTS.USDC_E];
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes

      writeSwap({
        address: CONTRACTS.TRADER_JOE_ROUTER as `0x${string}`,
        abi: ROUTER_ABI,
        functionName: 'swapExactAVAXForTokens',
        args: [
          0, // amountOutMin (we should calculate this properly in production)
          path,
          address,
          deadline,
        ],
        value: parseEther(amount),
      });

      toast.success('Swap initiated!');
      setStep('approve');
    } catch (error) {
      toast.error('Swap failed');
      console.error(error);
    }
  };

  const handleApprove = async () => {
    if (!usdcBalance || !address) {
      toast.error('Missing balance or wallet connection');
      return;
    }

    try {
      writeApprove({
        address: CONTRACTS.USDC_E as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [CONTRACTS.AAVE_POOL as `0x${string}`, usdcBalance],
      });

      toast.success('Approval initiated!');
      setStep('supply');
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: string }).message)
        : 'Unknown error';
      toast.error(`Approval failed: ${message}`);
      console.error('Approval error:', err);
    }
  };

  const handleSupply = () => {
    if (!usdcBalance || !address) return;

    try {
      writeSupply({
        address: CONTRACTS.AAVE_POOL as `0x${string}`,
        abi: AAVE_POOL_ABI,
        functionName: 'supply',
        args: [CONTRACTS.USDC_E as `0x${string}`, usdcBalance as bigint, address, 0],
      });

      toast.success('Supply initiated!');
      setIsOpen(false);
      setAmount('');
      setStep('swap');
    } catch (error) {
      toast.error('Supply failed');
      console.error(error);
    }
  };

  const handleSpeedUp = async (txHash: `0x${string}`) => {
    toast.info('Speed up feature coming soon');
  };

  const handleCancel = async (txHash: `0x${string}`) => {
    toast.info('Cancel feature coming soon');
  };

  const needsApproval = allowance !== undefined && usdcBalance !== undefined && allowance < usdcBalance;
  const isTransactionLoading = isLoading || isConfirming;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="bg-gradient-primary hover:opacity-90 transition-opacity shadow-glow">
          <Plus className="mr-2 h-5 w-5" />
          Deposit AVAX
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deposit AVAX to Aave</DialogTitle>
          <DialogDescription>
            Your AVAX will be swapped to USDC and supplied to Aave V3
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Amount Input */}
          <div className="space-y-2">
            <Label htmlFor="amount">Amount (AVAX)</Label>
            <Input
              id="amount"
              type="number"
              placeholder="0.0"
              value={amount}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
              disabled={step !== 'swap' || isTransactionLoading}
              className="text-lg"
            />
          </div>

          {/* Visual Flow */}
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="flex items-center justify-between w-full">
              <div className="flex-1 text-center p-3 rounded-lg bg-primary/10">
                <p className="text-sm text-muted-foreground">From</p>
                <p className="text-lg font-bold text-primary">AVAX</p>
              </div>
              <ArrowDown className="mx-4 h-5 w-5 text-muted-foreground" />
              <div className="flex-1 text-center p-3 rounded-lg bg-accent/10">
                <p className="text-sm text-muted-foreground">To</p>
                <p className="text-lg font-bold text-accent">USDC</p>
              </div>
            </div>

            {/* Progress Steps */}
            <div className="flex items-center justify-between w-full text-xs">
              <div className={`text-center ${step === 'swap' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                1. Swap
              </div>
              <div className={`text-center ${step === 'approve' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                2. Approve
              </div>
              <div className={`text-center ${step === 'supply' ? 'text-primary font-semibold' : 'text-muted-foreground'}`}>
                3. Supply
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          {step === 'swap' && (
            <Button
              onClick={handleSwap}
              disabled={!amount || isTransactionLoading}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              {isTransactionLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Swapping...
                </>
              ) : (
                'Swap AVAX to USDC'
              )}
            </Button>
          )}

          {step === 'approve' && (
            <Button
              onClick={handleApprove}
              disabled={!needsApproval || isTransactionLoading}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              {isTransactionLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {allowance > 0n ? 'Resetting Approval...' : 'Approving...'}
                </>
              ) : (
                'Approve USDC'
              )}
            </Button>
          )}

          {step === 'supply' && (
            <Button
              onClick={handleSupply}
              disabled={isTransactionLoading}
              className="w-full bg-gradient-primary hover:opacity-90"
              size="lg"
            >
              {isTransactionLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Supplying...
                </>
              ) : (
                'Supply to Aave'
              )}
            </Button>
          )}
        </div>
        {hash && (
          <div className="flex gap-2 mt-2">
            <Button
              onClick={() => handleSpeedUp(hash)}
              variant="outline"
              size="sm"
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Speed Up
            </Button>
            <Button
              onClick={() => handleCancel(hash)}
              variant="outline"
              size="sm"
              className="text-red-500"
              disabled={isLoading}
            >
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Cancel
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
