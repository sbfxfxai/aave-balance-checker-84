import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAaveSupply } from '@/hooks/useAaveSupply';
import { useAavePositions } from '@/hooks/useAavePositions';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface SupplyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SupplyModal({ isOpen, onClose }: SupplyModalProps) {
  const queryClient = useQueryClient();
  const {
    usdcBalance,
    usdcAllowance,
    supplyUSDC,
    withdrawUSDC,
    setCollateral,
    isPending,
    isConfirming,
    hash
  } = useAaveSupply();
  
  const positions = useAavePositions();

  const [amount, setAmount] = useState('');
  const [isCollateralEnabled, setIsCollateralEnabled] = useState(true);
  const [mode, setMode] = useState<'supply' | 'withdraw'>('supply');

  const handleSupply = async () => {
    if (!amount || Number(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (Number(amount) > Number(usdcBalance)) {
      toast.error('Insufficient USDC balance');
      return;
    }

    try {
      await supplyUSDC(amount);
      toast.success(`Successfully supplied ${amount} USDC to Aave!`);
      setAmount('');
      
      // Refetch all data to update UI
      queryClient.invalidateQueries();
      
      // Wait a moment for UI to update
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      toast.error(`Supply failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleWithdraw = async () => {
    if (!amount || Number(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    // Check if user has sufficient supplied amount
    const suppliedAmount = mode === 'withdraw' ? 
      parseFloat(positions.usdcSupply || '0') : 0;
    
    if (Number(amount) > suppliedAmount) {
      toast.error(`Insufficient supplied USDC. Current supply: ${suppliedAmount.toFixed(2)} USDC`);
      return;
    }

    // Health factor warning for withdraw
    if (positions.healthFactor && positions.healthFactor < 2) {
      toast.warning(`Warning: Your health factor is low (${positions.healthFactor.toFixed(2)}). Withdrawing may put your position at risk of liquidation.`);
    }

    try {
      await withdrawUSDC(amount);
      toast.success(`Successfully withdrew ${amount} USDC from Aave!`);
      setAmount('');
      
      // Refetch all data to update UI
      queryClient.invalidateQueries();
      
      // Wait a moment for UI to update
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (error) {
      toast.error(`Withdraw failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCollateralToggle = async () => {
    try {
      await setCollateral(!isCollateralEnabled);
      setIsCollateralEnabled(!isCollateralEnabled);
      toast.success(`Collateral ${!isCollateralEnabled ? 'enabled' : 'disabled'}!`);
    } catch (error) {
      toast.error(`Collateral toggle failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md p-6 bg-white">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">
            {mode === 'supply' ? 'Supply USDC' : 'Withdraw USDC'}
          </h2>
          <Button variant="ghost" onClick={onClose}>
            ×
          </Button>
        </div>

        <div className="space-y-4">
          {/* Mode Toggle */}
          <div className="flex gap-2">
            <Button
              variant={mode === 'supply' ? 'default' : 'outline'}
              onClick={() => setMode('supply')}
              className="flex-1"
            >
              Supply
            </Button>
            <Button
              variant={mode === 'withdraw' ? 'default' : 'outline'}
              onClick={() => setMode('withdraw')}
              className="flex-1"
            >
              Withdraw
            </Button>
          </div>

          {/* Balance Display */}
          <div className="bg-gray-50 p-3 rounded">
            <div className="text-sm text-gray-600">
              {mode === 'supply' ? 'Available Balance' : 'Supplied Balance'}
            </div>
            <div className="text-lg font-semibold">
              {mode === 'supply' ? usdcBalance : positions.usdcSupply || '0.00'} USDC
            </div>
            {mode === 'withdraw' && (
              <div className="text-xs text-gray-500 mt-1">
                Health Factor: {positions.healthFactor ? positions.healthFactor.toFixed(2) : 'N/A'}
              </div>
            )}
          </div>

          {/* Amount Input */}
          <div>
            <Label htmlFor="amount">Amount (USDC)</Label>
            <div className="flex gap-2">
              <Input
                id="amount"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.01"
                min="0"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(mode === 'supply' ? (usdcBalance || '0') : (positions.usdcSupply || '0'))}
              >
                Max
              </Button>
            </div>
          </div>

          {/* Collateral Toggle (only for supply mode) */}
          {mode === 'supply' && (
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="collateral">Use as Collateral</Label>
                <p className="text-sm text-gray-600">
                  Enable to use supplied USDC as collateral for borrowing
                </p>
              </div>
              <Switch
                id="collateral"
                checked={isCollateralEnabled}
                onCheckedChange={handleCollateralToggle}
              />
            </div>
          )}

          {/* Approval Alert */}
          {mode === 'supply' && Number(usdcAllowance) < Number(amount || '0') && (
            <Alert>
              <AlertDescription>
                You'll need to approve USDC spending before supplying. This will be done automatically.
              </AlertDescription>
            </Alert>
          )}

          {/* Health Factor Warning for Withdraw */}
          {mode === 'withdraw' && positions.healthFactor && positions.healthFactor < 2 && (
            <Alert>
              <AlertDescription className="text-yellow-700">
                <strong>Warning:</strong> Your health factor is low ({positions.healthFactor.toFixed(2)}). 
                Withdrawing may put your position at risk of liquidation.
              </AlertDescription>
            </Alert>
          )}

          {/* Action Button */}
          <Button
            onClick={mode === 'supply' ? handleSupply : handleWithdraw}
            disabled={!amount || Number(amount) <= 0 || isPending || isConfirming}
            className="w-full"
          >
            {isPending || isConfirming
              ? 'Processing...'
              : mode === 'supply'
              ? 'Supply USDC'
              : 'Withdraw USDC'
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
