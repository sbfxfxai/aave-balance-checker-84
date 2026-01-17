import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Loader2, 
  TrendingUp, 
  AlertTriangle, 
  ExternalLink, 
  ArrowRight,
  Wallet,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { MorphoPosition } from '@/hooks/useMorphoPositions';
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi';
import { withdrawAllFromMorpho, WithdrawalResult, getVaultPositions, VaultPosition } from '@/lib/morphoDirect';
import { BrowserProvider, ethers, JsonRpcProvider } from 'ethers';
import { arbitrum } from 'wagmi/chains';

// ERC-4626 Vault ABI
const ERC4626_VAULT_ABI = [
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)',
  'function balanceOf(address account) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function asset() view returns (address)',
] as const;

interface MorphoWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: MorphoPosition;
}

export const MorphoWithdrawModal: React.FC<MorphoWithdrawModalProps> = ({
  isOpen,
  onClose,
  position,
}) => {
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawalResult, setWithdrawalResult] = useState<WithdrawalResult | undefined>();
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [pendingTxHash, setPendingTxHash] = useState<string | undefined>();
  const [withdrawalPhase, setWithdrawalPhase] = useState<'initial' | 'first-vault' | 'second-vault' | 'complete'>('initial');
  const [networkCongestion, setNetworkCongestion] = useState<{ isCongested: boolean; waitTime: string } | null>(null);
  const [gasWarning, setGasWarning] = useState<{
    type: 'insufficient';
    currentBalance: string;
    neededBalance: string;
    estimatedCost: string;
  } | null>(null);
  const [isRequestingEth, setIsRequestingEth] = useState(false);
  const [ethRequestResult, setEthRequestResult] = useState<{ success: boolean; message?: string; txHash?: string } | null>(null);
  const { isConnected, chain } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain, isPending: isSwitchingNetwork } = useSwitchChain();

  // Check if user is on correct network (Arbitrum)
  const isCorrectNetwork = chain?.id === arbitrum.id;

  // Check network conditions when modal opens
  useEffect(() => {
    if (isOpen && isConnected && walletClient) {
      const checkNetworkConditions = async () => {
        try {
          const provider = new BrowserProvider(walletClient.transport) as unknown as JsonRpcProvider;
          const signer = await provider.getSigner();
          
          // Check network congestion
          const congestion = await checkNetworkCongestion(provider);
          setNetworkCongestion(congestion);
          
          // Check gas for positions that actually exist
          const hasEurcPosition = parseFloat(position.eurcUsdValue) > 0;
          const hasDaiPosition = parseFloat(position.daiUsdValue) > 0;
          
          if (hasEurcPosition) {
            const gasCheck = await checkGasEstimate(signer, '0x7e97fa6893871A2751B5fE961978DCCb2c201E65', position.eurcShares);
            if (!gasCheck.hasEnoughGas) {
              setGasWarning({
                type: 'insufficient',
                currentBalance: gasCheck.currentBalance,
                neededBalance: gasCheck.neededBalance,
                estimatedCost: gasCheck.estimatedGas
              });
              return; // Stop checking other vaults if first one already fails
            }
          }
          
          if (hasDaiPosition) {
            const gasCheck = await checkGasEstimate(signer, '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027', position.daiShares);
            if (!gasCheck.hasEnoughGas) {
              setGasWarning({
                type: 'insufficient',
                currentBalance: gasCheck.currentBalance,
                neededBalance: gasCheck.neededBalance,
                estimatedCost: gasCheck.estimatedGas
              });
            }
          }
        } catch (error) {
          console.error('[checkNetworkConditions] Error:', error);
        }
      };
      
      checkNetworkConditions();
    }
  }, [isOpen, isConnected, walletClient, position]);

  const formatUSD = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  const formatAPY = (apy: number) => {
    return `${apy.toFixed(2)}%`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const getTimeAgo = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  const requestEthForGas = async (walletAddress: string): Promise<{ success: boolean; message?: string; txHash?: string }> => {
    try {
      setIsRequestingEth(true);
      setEthRequestResult(null);

      const response = await fetch('/api/morpho/send-eth-gas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to request ETH');
      }

      setEthRequestResult({
        success: true,
        message: data.message,
        txHash: data.txHash,
      });

      return { success: true, message: data.message, txHash: data.txHash };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setEthRequestResult({
        success: false,
        message: errorMessage,
      });
      return { success: false, message: errorMessage };
    } finally {
      setIsRequestingEth(false);
    }
  };

  const checkGasEstimate = async (signer: ethers.JsonRpcSigner, vaultAddress: string, shares: string): Promise<{ hasEnoughGas: boolean; estimatedGas: string; currentBalance: string; neededBalance: string }> => {
    try {
      const vault = new ethers.Contract(vaultAddress, ERC4626_VAULT_ABI, signer);
      const sharesBigInt = ethers.parseUnits(shares, 18);
      const userAddress = await signer.getAddress();
      
      const gasEstimate = await vault.redeem.estimateGas(
        sharesBigInt,
        userAddress,
        userAddress
      );
      
      const provider = signer.provider as JsonRpcProvider;
      const balance = await provider.getBalance(userAddress);
      const gasPrice = await provider.getFeeData();
      
      const estimatedCost = gasEstimate * (gasPrice.gasPrice || 0n);
      const hasEnoughGas = balance > estimatedCost * 2n; // 2x buffer
      
      return {
        hasEnoughGas,
        estimatedGas: ethers.formatUnits(estimatedCost, 18),
        currentBalance: ethers.formatUnits(balance, 18),
        neededBalance: ethers.formatUnits(estimatedCost * 2n, 18) // Show 2x buffer
      };
    } catch (error) {
      console.error('[checkGasEstimate] Error:', error);
      return { hasEnoughGas: false, estimatedGas: '0', currentBalance: '0', neededBalance: '0' };
    }
  };

  const checkNetworkCongestion = async (provider: JsonRpcProvider): Promise<{ isCongested: boolean; waitTime: string }> => {
    try {
      const feeData = await provider.getFeeData();
      const gasPrice = feeData.gasPrice || 0n;
      
      // Arbitrum typical gas price ranges (in Gwei)
      const normalGasPrice = ethers.parseUnits('0.1', 'gwei'); // 0.1 Gwei
      const highGasPrice = ethers.parseUnits('0.5', 'gwei'); // 0.5 Gwei
      
      if (gasPrice > highGasPrice) {
        return { isCongested: true, waitTime: '2-5 minutes' };
      } else if (gasPrice > normalGasPrice) {
        return { isCongested: true, waitTime: '1-2 minutes' };
      }
      
      return { isCongested: false, waitTime: '30 seconds' };
    } catch (error) {
      console.error('[checkNetworkCongestion] Error:', error);
      return { isCongested: false, waitTime: '30 seconds' };
    }
  };

  const handleWithdraw = async () => {
    if (!isConnected || !walletClient || !isConfirmed) {
      setWithdrawalResult({
        success: false,
        error: 'Please connect your wallet and confirm the withdrawal',
      });
      return;
    }

    // Check if there are actually positions to withdraw
    const hasEurcPosition = parseFloat(position.eurcUsdValue) > 0;
    const hasDaiPosition = parseFloat(position.daiUsdValue) > 0;
    
    if (!hasEurcPosition && !hasDaiPosition) {
      setWithdrawalResult({
        success: false,
        error: 'No vault positions found to withdraw',
      });
      return;
    }

    setIsWithdrawing(true);
    setWithdrawalResult(undefined);
    setWithdrawalPhase('initial');
    setGasWarning(null);

    try {
      // Auto-switch to Arbitrum if not already on it
      if (!isCorrectNetwork) {
        setWithdrawalPhase('initial');
        console.log(`[handleWithdraw] Switching to Arbitrum from ${chain?.name || 'unknown network'}...`);
        
        await switchChain({ chainId: arbitrum.id });
        
        // Wait a moment for the network switch to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Convert wagmi wallet client to ethers signer
      const provider = new BrowserProvider(walletClient.transport) as unknown as JsonRpcProvider;
      const signer = await provider.getSigner();
      
      // Verify we're on Arbitrum
      const network = await provider.getNetwork();
      if (Number(network.chainId) !== arbitrum.id) {
        throw new Error(`Failed to switch to Arbitrum. Current network: ${network.chainId}`);
      }
      
      // Check network congestion
      const congestion = await checkNetworkCongestion(provider);
      setNetworkCongestion(congestion);
      if (congestion.isCongested) {
        console.log(`[handleWithdraw] Network congestion detected. Expected wait time: ${congestion.waitTime}`);
      }

      const vaultResults: VaultPosition[] = [];
      const txHashes: string[] = [];
      let successfulVaults = 0;
      let failedVaults = 0;

      // Process EURC/Gauntlet vault if has position
      if (hasEurcPosition) {
        setWithdrawalPhase('first-vault');
        
        try {
          // Check gas estimate
          const gasCheck = await checkGasEstimate(signer, '0x7e97fa6893871A2751B5fE961978DCCb2c201E65', position.eurcShares);
          if (!gasCheck.hasEnoughGas) {
            throw new Error(`Insufficient ETH for gas. Estimated cost: ${gasCheck.estimatedGas} ETH`);
          }

          const vaultContract = new ethers.Contract('0x7e97fa6893871A2751B5fE961978DCCb2c201E65', ERC4626_VAULT_ABI, signer);
          const sharesBigInt = ethers.parseUnits(position.eurcShares, 18);
          
          console.log(`[handleWithdraw] Processing Gauntlet USDC Vault: ${position.eurcShares} shares`);
          
          // Send transaction
          const tx = await vaultContract.redeem(
            sharesBigInt,
            await signer.getAddress(),
            await signer.getAddress(),
            { gasLimit: 500000 }
          );
          
          // Show transaction hash immediately
          setPendingTxHash(tx.hash);
          console.log(`[handleWithdraw] Transaction sent for Gauntlet vault:`, tx.hash);
          
          // Wait for confirmation
          const receipt = await tx.wait(1);
          
          if (receipt.status === 1) {
            vaultResults.push({
              vault: 'Gauntlet USDC',
              vaultAddress: '0x7e97fa6893871A2751B5fE961978DCCb2c201E65',
              shares: position.eurcShares,
              assets: position.eurcAssets,
              success: true,
            });
            txHashes.push(tx.hash);
            successfulVaults++;
          } else {
            vaultResults.push({
              vault: 'Gauntlet USDC',
              vaultAddress: '0x7e97fa6893871A2751B5fE961978DCCb2c201E65',
              shares: position.eurcShares,
              assets: position.eurcAssets,
              success: false,
            });
            failedVaults++;
          }
        } catch (error) {
          console.error(`[handleWithdraw] Error processing Gauntlet vault:`, error);
          vaultResults.push({
            vault: 'Gauntlet USDC',
            vaultAddress: '0x7e97fa6893871A2751B5fE961978DCCb2c201E65',
            shares: position.eurcShares,
            assets: position.eurcAssets,
            success: false,
          });
          failedVaults++;
        }
      }

      // Process DAI/Hyperithm vault if has position
      if (hasDaiPosition) {
        setWithdrawalPhase('second-vault');
        
        try {
          // Check gas estimate
          const gasCheck = await checkGasEstimate(signer, '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027', position.daiShares);
          if (!gasCheck.hasEnoughGas) {
            // Try to automatically request ETH for gas
            console.log('[handleWithdraw] Insufficient ETH, requesting ETH for gas...');
            const userAddress = await signer.getAddress();
            const ethRequest = await requestEthForGas(userAddress);
            
            if (ethRequest.success && ethRequest.txHash) {
              console.log('[handleWithdraw] ETH requested, waiting for transaction...');
              // Wait a few seconds for the ETH to arrive
              await new Promise(resolve => setTimeout(resolve, 5000));
              
              // Re-check gas after ETH arrives
              const gasCheckRetry = await checkGasEstimate(signer, '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027', position.daiShares);
              if (!gasCheckRetry.hasEnoughGas) {
                throw new Error(`Insufficient ETH for gas. Please wait a moment for the ETH transfer to complete, then try again.`);
              }
            } else {
              throw new Error(`Insufficient ETH for gas. Estimated cost: ${gasCheck.estimatedGas} ETH. ${ethRequest.message || 'Please add ETH to your wallet.'}`);
            }
          }

          const vaultContract = new ethers.Contract('0x4B6F1C9E5d470b97181786b26da0d0945A7cf027', ERC4626_VAULT_ABI, signer);
          const sharesBigInt = ethers.parseUnits(position.daiShares, 18);
          
          console.log(`[handleWithdraw] Processing Hyperithm USDC Vault: ${position.daiShares} shares`);
          
          // Send transaction
          const tx = await vaultContract.redeem(
            sharesBigInt,
            await signer.getAddress(),
            await signer.getAddress(),
            { gasLimit: 500000 }
          );
          
          // Show transaction hash immediately (only set if not already set)
          if (!pendingTxHash) {
            setPendingTxHash(tx.hash);
          }
          console.log(`[handleWithdraw] Transaction sent for Hyperithm vault:`, tx.hash);
          
          // Wait for confirmation
          const receipt = await tx.wait(1);
          
          if (receipt.status === 1) {
            vaultResults.push({
              vault: 'Hyperithm USDC',
              vaultAddress: '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027',
              shares: position.daiShares,
              assets: position.daiAssets,
              success: true,
            });
            if (!txHashes.includes(tx.hash)) {
              txHashes.push(tx.hash);
            }
            successfulVaults++;
          } else {
            vaultResults.push({
              vault: 'Hyperithm USDC',
              vaultAddress: '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027',
              shares: position.daiShares,
              assets: position.daiAssets,
              success: false,
            });
            failedVaults++;
          }
        } catch (error) {
          console.error(`[handleWithdraw] Error processing Hyperithm vault:`, error);
          vaultResults.push({
            vault: 'Hyperithm USDC',
            vaultAddress: '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027',
            shares: position.daiShares,
            assets: position.daiAssets,
            success: false,
          });
          failedVaults++;
        }
      }

      setWithdrawalPhase('complete');

      // Determine overall success
      const hasAnySuccess = successfulVaults > 0;
      const partialSuccess = successfulVaults > 0 && failedVaults > 0;

      setWithdrawalResult({
        success: hasAnySuccess,
        txHash: txHashes[0],
        explorerUrl: txHashes[0] ? `https://arbiscan.io/tx/${txHashes[0]}` : undefined,
        vaultResults,
        error: !hasAnySuccess ? 'All withdrawals failed' : 
               partialSuccess ? `${failedVaults} vault(s) failed to withdraw` : undefined,
      });

    } catch (error) {
      console.error('[handleWithdraw] Unexpected error:', error);
      setWithdrawalResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unexpected error occurred',
      });
    } finally {
      setIsWithdrawing(false);
    }
  };

  const hasResult = withdrawalResult !== undefined;
  const isSuccess = withdrawalResult?.success;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        setIsConfirmed(false);
        setPendingTxHash(undefined);
      }
      onClose();
    }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-red-500" />
            Withdraw from Morpho Vault
          </DialogTitle>
          <DialogDescription>
            {isWithdrawing && pendingTxHash && !hasResult 
              ? 'Transaction submitted! Waiting for confirmation...'
              : hasResult 
              ? (isSuccess ? 'Withdrawal completed successfully!' : 'Withdrawal failed')
              : 'Review your position details before withdrawing all funds.'
            }
          </DialogDescription>
        </DialogHeader>

        {!hasResult && (
          <div className="space-y-4">
            {/* Position Summary */}
            <Card className="border-border">
              <CardContent className="p-4">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-purple-500" />
                  Current Position
                </h4>
                
                {/* Position Timeline */}
                {position.firstPositionOpened && (
                  <div className="mb-3 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">Position opened:</span>
                      <div className="text-right">
                        <div className="font-medium text-gray-800 dark:text-gray-200">
                          {getTimeAgo(String(position.firstPositionOpened))}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDate(String(position.firstPositionOpened))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                
                <div className="space-y-3">
                  {/* Total Value */}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Value</span>
                    <div className="text-right">
                      <div className="font-semibold">{formatUSD(position.totalUsdValue)}</div>
                    </div>
                  </div>

                  {/* Asset Breakdown */}
                  {parseFloat(position.eurcUsdValue) > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                        <div>
                          <span>Gauntlet USDC Vault</span>
                          {position.firstPositionOpened && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Opened {getTimeAgo(String(position.firstPositionOpened))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{formatUSD(position.eurcUsdValue)}</div>
                      </div>
                    </div>
                  )}

                  {parseFloat(position.daiUsdValue) > 0 && (
                    <div className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                        <div>
                          <span>Hyperithm USDC Vault</span>
                          {position.firstPositionOpened && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              Opened {getTimeAgo(String(position.firstPositionOpened))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{formatUSD(position.daiUsdValue)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Warning */}
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-800 dark:text-yellow-200">Important Information</p>
                  <ul className="text-yellow-700 dark:text-yellow-300 mt-1 space-y-1">
                    <li>• Withdrawal will close both USDC vault positions</li>
                    <li>• You must sign the transaction with your wallet</li>
                    <li>• Transaction typically completes within 1-2 minutes</li>
                    <li>• You will stop earning interest on withdrawn amounts</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* What you'll receive */}
            <Card className="border-green-500/50 bg-green-50 dark:bg-green-900/20">
              <CardContent className="p-4">
                <h4 className="font-semibold mb-2 text-green-800 dark:text-green-200">What You'll Receive</h4>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-green-700 dark:text-green-300">USDC from Gauntlet Vault</span>
                    <span className="font-medium text-green-800 dark:text-green-200">
                      {formatUSD(position.eurcUsdValue)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-green-700 dark:text-green-300">USDC from Hyperithm Vault</span>
                    <span className="font-medium text-green-800 dark:text-green-200">
                      {formatUSD(position.daiUsdValue)}
                    </span>
                  </div>
                  <div className="border-t border-green-200 dark:border-green-700 pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="font-medium text-green-800 dark:text-green-200">Total USDC</span>
                      <span className="font-bold text-green-800 dark:text-green-200">
                        {formatUSD(position.totalUsdValue)}
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-green-200 dark:border-green-700 pt-2 mt-2">
                    <div className="text-sm">
                      <span className="text-green-700 dark:text-green-300">Destination: </span>
                      <span className="font-mono text-xs text-green-800 dark:text-green-200">
                        {isConnected ? (walletClient?.account.address || 'Connected wallet') : 'Connect wallet to see address'}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Network Congestion Warning */}
        {networkCongestion?.isCongested && !hasResult && (
          <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-orange-800 dark:text-orange-200">Network Congestion Detected</p>
                <p className="text-orange-700 dark:text-orange-300 mt-1">
                  Transactions may take {networkCongestion.waitTime} to confirm due to high network activity.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Network Switching Progress */}
        {!isCorrectNetwork && isWithdrawing && withdrawalPhase === 'initial' && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <Loader2 className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 animate-spin" />
              <div className="text-sm">
                <p className="font-medium text-blue-800 dark:text-blue-200">Switching to Arbitrum</p>
                <p className="text-blue-700 dark:text-blue-300 mt-1">
                  Automatically switching network to process your withdrawal...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Gas Warning */}
        {gasWarning && !hasResult && isCorrectNetwork && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
              <div className="text-sm flex-1">
                <p className="font-medium text-red-800 dark:text-red-200">Insufficient ETH for Gas</p>
                <div className="text-red-700 dark:text-red-300 mt-1 space-y-1">
                  <p>Current balance: {parseFloat(gasWarning.currentBalance).toFixed(6)} ETH</p>
                  <p>Needed for withdrawal: {parseFloat(gasWarning.neededBalance).toFixed(6)} ETH</p>
                  <p>Estimated transaction cost: {parseFloat(gasWarning.estimatedCost).toFixed(6)} ETH</p>
                </div>
                {ethRequestResult && (
                  <div className={`mt-2 p-2 rounded ${ethRequestResult.success ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                    <p className={`text-sm ${ethRequestResult.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}`}>
                      {ethRequestResult.message}
                    </p>
                    {ethRequestResult.txHash && (
                      <a 
                        href={`https://arbiscan.io/tx/${ethRequestResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-flex items-center gap-1"
                      >
                        View transaction <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}
                <div className="mt-3">
                  <Button
                    onClick={async () => {
                      if (walletClient?.account.address) {
                        await requestEthForGas(walletClient.account.address);
                        // Re-check gas after requesting
                        setTimeout(async () => {
                          if (walletClient && isConnected) {
                            try {
                              const provider = new BrowserProvider(walletClient.transport) as unknown as JsonRpcProvider;
                              const signer = await provider.getSigner();
                              const hasEurcPosition = parseFloat(position.eurcUsdValue) > 0;
                              const hasDaiPosition = parseFloat(position.daiUsdValue) > 0;
                              
                              if (hasEurcPosition) {
                                const gasCheck = await checkGasEstimate(signer, '0x7e97fa6893871A2751B5fE961978DCCb2c201E65', position.eurcShares);
                                if (gasCheck.hasEnoughGas) {
                                  setGasWarning(null);
                                }
                              } else if (hasDaiPosition) {
                                const gasCheck = await checkGasEstimate(signer, '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027', position.daiShares);
                                if (gasCheck.hasEnoughGas) {
                                  setGasWarning(null);
                                }
                              }
                            } catch (error) {
                              console.error('[MorphoWithdrawModal] Error re-checking gas:', error);
                            }
                          }
                        }, 5000);
                      }
                    }}
                    disabled={isRequestingEth || !isConnected}
                    size="sm"
                    variant="outline"
                    className="w-full"
                  >
                    {isRequestingEth ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Requesting ETH...
                      </>
                    ) : (
                      'Request ETH for Gas (Free)'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation Checkbox */}
        {!hasResult && (
          <div className="space-y-3">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="withdrawal-confirmation"
                checked={isConfirmed}
                onCheckedChange={(checked) => setIsConfirmed(checked as boolean)}
              />
              <div className="space-y-1 leading-none">
                <label
                  htmlFor="withdrawal-confirmation"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  I understand I'm withdrawing all funds from both vaults
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Pending Transaction State */}
        {isWithdrawing && pendingTxHash && !hasResult && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Loader2 className="h-6 w-6 text-blue-600 dark:text-blue-400 animate-spin" />
                <div>
                  <p className="font-semibold text-blue-800 dark:text-blue-200">
                    {withdrawalPhase === 'first-vault' ? 'Processing First Vault...' :
                     withdrawalPhase === 'second-vault' ? 'Processing Second Vault...' :
                     'Transaction Submitted!'}
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {withdrawalPhase === 'first-vault' || withdrawalPhase === 'second-vault' 
                      ? 'Withdrawing funds from vault...'
                      : 'Your withdrawal transaction has been sent to the network.'
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Prominent Block Explorer Link */}
            <Card className="border-blue-500/50 bg-blue-50 dark:bg-blue-900/20">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-blue-800 dark:text-blue-200">Track Transaction</h4>
                    <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                      {pendingTxHash.slice(0, 10)}...{pendingTxHash.slice(-8)}
                    </p>
                  </div>
                  <Button
                    variant="default"
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={() => window.open(`https://arbiscan.io/tx/${pendingTxHash}`, '_blank')}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View on Block Explorer
                  </Button>
                </div>
              </CardContent>
            </Card>

            {networkCongestion?.isCongested && (
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-orange-800 dark:text-orange-200">Network Congestion</p>
                    <p className="text-orange-700 dark:text-orange-300 mt-1">
                      Expected confirmation time: {networkCongestion.waitTime}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <Card className="border-border">
              <CardContent className="p-4">
                <h4 className="font-semibold mb-2">Transaction Details</h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Transaction Hash</span>
                    <span className="font-mono text-xs">
                      {pendingTxHash.slice(0, 10)}...{pendingTxHash.slice(-8)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground text-center">
                    {withdrawalPhase === 'first-vault' || withdrawalPhase === 'second-vault' 
                      ? 'Processing withdrawal...'
                      : 'Waiting for confirmation...'
                    }
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Success State */}
        {hasResult && isSuccess && (
          <div className="space-y-4">
            {/* Check if this is partial success */}
            {withdrawalResult?.vaultResults && withdrawalResult.vaultResults.some(r => !r.success) ? (
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-6 w-6 text-orange-600 dark:text-orange-400" />
                  <div>
                    <p className="font-semibold text-orange-800 dark:text-orange-200">Partial Withdrawal Completed</p>
                    <p className="text-sm text-orange-700 dark:text-orange-300">
                      {withdrawalResult.error || 'Some vaults could not be withdrawn. Please check the details below.'}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                  <div>
                    <p className="font-semibold text-green-800 dark:text-green-200">Withdrawal Successful!</p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Your USDC has been transferred to your wallet.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Vault Results Summary */}
            {withdrawalResult?.vaultResults && withdrawalResult.vaultResults.length > 1 && (
              <Card className="border-border">
                <CardContent className="p-4">
                  <h4 className="font-semibold mb-2">Vault Withdrawal Summary</h4>
                  <div className="space-y-2">
                    {withdrawalResult.vaultResults.map((result, index) => (
                      <div key={index} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          {result.success ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-500" />
                          )}
                          <span className={result.success ? 'text-green-700' : 'text-red-700'}>
                            {result.vault}
                          </span>
                        </div>
                        <span className={`font-medium ${result.success ? 'text-green-800' : 'text-red-800'}`}>
                          {result.success ? formatUSD(result.assets) : 'Failed'}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {withdrawalResult?.txHash && (
              <>
                {/* Prominent Block Explorer Link */}
                <Card className="border-green-500/50 bg-green-50 dark:bg-green-900/20">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-semibold text-green-800 dark:text-green-200">View Transaction</h4>
                        <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                          {withdrawalResult.txHash.slice(0, 10)}...{withdrawalResult.txHash.slice(-8)}
                        </p>
                      </div>
                      <Button
                        variant="default"
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => window.open(withdrawalResult.explorerUrl, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View on Block Explorer
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-border">
                  <CardContent className="p-4">
                    <h4 className="font-semibold mb-2">Transaction Details</h4>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Transaction Hash</span>
                        <span className="font-mono text-xs">
                          {withdrawalResult.txHash.slice(0, 10)}...{withdrawalResult.txHash.slice(-8)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        )}

        {/* Error State */}
        {hasResult && !isSuccess && (
          <div className="space-y-4">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                <div>
                  <p className="font-semibold text-red-800 dark:text-red-200">Withdrawal Failed</p>
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {withdrawalResult?.error || 'An unexpected error occurred'}
                  </p>
                </div>
              </div>
            </div>

            {withdrawalResult?.txHash && (
              <Card className="border-red-500/50 bg-red-50 dark:bg-red-900/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-red-800 dark:text-red-200">Debug Transaction</h4>
                      <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                        {withdrawalResult.txHash.slice(0, 10)}...{withdrawalResult.txHash.slice(-8)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-600 text-red-600 hover:bg-red-600 hover:text-white"
                      onClick={() => window.open(withdrawalResult.explorerUrl, '_blank')}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View on Block Explorer
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <DialogFooter>
          {!hasResult && (
            <>
              <Button
                variant="outline"
                onClick={onClose}
                disabled={isWithdrawing}
                className="border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 font-medium"
              >
                Cancel Withdrawal
              </Button>
              <Button
                onClick={handleWithdraw}
                disabled={isWithdrawing || !isConnected || !isConfirmed || !!gasWarning}
                className="bg-red-500 hover:bg-red-600 text-white font-semibold"
              >
                {isWithdrawing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {!isCorrectNetwork && withdrawalPhase === 'initial' ? 'Switching Network...' : 'Withdrawing...'}
                  </>
                ) : (
                  'Withdraw All Funds'
                )}
              </Button>
            </>
          )}
          
          {hasResult && (
            <Button
              onClick={onClose}
              className="w-full"
            >
              {isSuccess ? 'Done' : 'Close'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
