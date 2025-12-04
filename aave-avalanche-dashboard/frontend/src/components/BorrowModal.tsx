import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAaveBorrow } from '@/hooks/useAaveBorrow';
import { useAavePositions } from '@/hooks/useAavePositions';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { toast } from 'sonner';

interface BorrowModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BorrowModal({ isOpen, onClose }: BorrowModalProps) {
  const {
    usdcBorrowed,
    avaxBorrowed,
    borrowUSDC,
    borrowAVAX,
    repayUSDC,
    repayAVAX,
    isPending,
    isConfirming,
    hash
  } = useAaveBorrow();

  const positions = useAavePositions();
  const { usdcBalance, avaxBalance } = useWalletBalances();

  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState<'USDC' | 'AVAX'>('USDC');
  const [mode, setMode] = useState<'borrow' | 'repay'>('borrow');

  const handleBorrow = async () => {
    if (!amount || Number(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    // Check if user has sufficient available to borrow
    const availableBorrow = asset === 'USDC' ? 
      positions.usdcAvailableToBorrow || 0 : 
      positions.avaxAvailableToBorrow || 0;

    if (Number(amount) > availableBorrow) {
      toast.error(`Insufficient available ${asset}. Maximum: ${availableBorrow.toFixed(6)} ${asset}`);
      return;
    }

    try {
      if (asset === 'USDC') {
        await borrowUSDC(amount);
      } else {
        await borrowAVAX(amount);
      }
      toast.success(`${asset} borrow transaction submitted!`);
      setAmount('');
      onClose();
    } catch (error) {
      toast.error(`Borrow failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleRepay = async () => {
    if (!amount || Number(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    // Check if user has sufficient borrowed amount
    const borrowedAmount = asset === 'USDC' ? 
      Number(usdcBorrowed) : 
      Number(avaxBorrowed);

    if (Number(amount) > borrowedAmount) {
      toast.error(`Insufficient borrowed ${asset}. Current debt: ${borrowedAmount.toFixed(6)} ${asset}`);
      return;
    }

    // Check if user has sufficient balance for repayment
    const userBalance = asset === 'USDC' ? 
      Number(usdcBalance || '0') : 
      Number(avaxBalance || '0');
    
    if (Number(amount) > userBalance) {
      toast.error(`Insufficient ${asset} balance for repayment. Available: ${userBalance.toFixed(6)} ${asset}`);
      return;
    }

    try {
      if (asset === 'USDC') {
        await repayUSDC(amount);
      } else {
        await repayAVAX(amount);
      }
      toast.success(`${asset} repay transaction submitted!`);
      setAmount('');
      onClose();
    } catch (error) {
      toast.error(`Repay failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  if (!isOpen) return null;

  const borrowApy = asset === 'USDC' ? positions.usdcBorrowApy : positions.avaxBorrowApy;
  const availableBorrow = asset === 'USDC' ? 
    positions.usdcAvailableToBorrow || 0 : 
    positions.avaxAvailableToBorrow || 0;
  const currentBorrowed = asset === 'USDC' ? 
    Number(usdcBorrowed) : 
    Number(avaxBorrowed);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md p-6 bg-white">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">
            {mode === 'borrow' ? 'Borrow' : 'Repay'} {asset}
          </h2>
          <Button variant="ghost" onClick={onClose}>
            ×
          </Button>
        </div>

        <div className="space-y-4">
          {/* Asset Selection */}
          <div className="flex gap-2">
            <Button
              variant={asset === 'USDC' ? 'default' : 'outline'}
              onClick={() => setAsset('USDC')}
              className="flex-1"
            >
              USDC
            </Button>
            <Button
              variant={asset === 'AVAX' ? 'default' : 'outline'}
              onClick={() => setAsset('AVAX')}
              className="flex-1"
            >
              AVAX
            </Button>
          </div>

          {/* Mode Toggle */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'borrow' ? 'default' : 'outline'}
              onClick={() => setMode('borrow')}
              className="flex-1"
            >
              Borrow
            </Button>
            <Button
              variant={mode === 'repay' ? 'default' : 'outline'}
              onClick={() => setMode('repay')}
              className="flex-1"
            >
              Repay
            </Button>
          </div>

          {/* Info Display */}
          <div className="bg-gray-50 p-3 rounded space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Borrow APY:</span>
              <span className="font-semibold">{borrowApy}%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">
                {mode === 'borrow' ? 'Available to Borrow' : 'Current Debt'}:
              </span>
              <span className="font-semibold">
                {mode === 'borrow' ? 
                  `${availableBorrow.toFixed(6)} ${asset}` : 
                  `${currentBorrowed.toFixed(6)} ${asset}`
                }
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Health Factor:</span>
              <span className={`font-semibold ${positions.healthFactor && positions.healthFactor < 1.5 ? 'text-red-500' : 'text-green-500'}`}>
                {positions.healthFactor ? positions.healthFactor.toFixed(2) : 'N/A'}
              </span>
            </div>
            {mode === 'repay' && (
              <div className="text-xs text-green-600 mt-2">
                Repaying will improve your health factor and reduce liquidation risk
              </div>
            )}
          </div>

          {/* Amount Input */}
          <div>
            <Label htmlFor="amount">Amount ({asset})</Label>
            <div className="flex gap-2">
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.000001"
                min="0"
                className="flex-1"
              />
              {mode === 'repay' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAmount(currentBorrowed.toString())}
                >
                  Max
                </Button>
              )}
            </div>
          </div>

          {/* Health Factor Warning */}
          {mode === 'borrow' && positions.healthFactor && positions.healthFactor < 2 && (
            <Alert>
              <AlertDescription className="text-yellow-700">
                <strong>Warning:</strong> Your health factor is low ({positions.healthFactor.toFixed(2)}). 
                Borrowing more may put your position at risk of liquidation.
              </AlertDescription>
            </Alert>
          )}

          {/* Repay Success Message */}
          {mode === 'repay' && positions.healthFactor && positions.healthFactor < 1.5 && (
            <Alert>
              <AlertDescription className="text-green-700">
                <strong>Good Move:</strong> Your health factor is low ({positions.healthFactor.toFixed(2)}). 
                Repaying will significantly improve your position safety.
              </AlertDescription>
            </Alert>
          )}

          {/* Action Button */}
          <Button
            onClick={mode === 'borrow' ? handleBorrow : handleRepay}
            disabled={!amount || Number(amount) <= 0 || isPending || isConfirming}
            className="w-full"
            variant={mode === 'borrow' ? 'default' : 'destructive'}
          >
            {isPending || isConfirming
              ? 'Processing...'
              : mode === 'borrow'
              ? `Borrow ${asset}`
              : `Repay ${asset}`
            }
          </Button>

          {/* Transaction Hash */}
          {hash && (
            <Alert>
              <AlertDescription>
                Transaction submitted: {hash.slice(0, 10)}...{hash.slice(-8)}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </Card>
    </div>
  );
}
