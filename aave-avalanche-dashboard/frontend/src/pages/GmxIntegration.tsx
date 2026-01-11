import { useMemo, useState, useCallback, useEffect, useRef, memo } from 'react';
import { Link } from 'react-router-dom';
import { useAccount, usePublicClient, useWalletClient, useBalance, useSwitchChain } from 'wagmi';
// @ts-ignore - @privy-io/react-auth types exist but TypeScript can't resolve them due to package.json exports configuration
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';
import { avalanche } from 'wagmi/chains';
// CRITICAL: Lazy load GMX SDK contracts to avoid TDZ errors with SES lockdown
// Static imports cause the entire GMX SDK bundle to evaluate at module load time,
// which triggers Temporal Dead Zone errors when SES lockdown is active
// const { CONTRACTS: GMX_SDK_CONTRACTS } = await import('@gmx-io/sdk/configs/contracts');
import { erc20Abi, maxUint256, formatUnits, parseUnits, WalletClient, Abi, createPublicClient, http, Hex } from 'viem';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NetworkGuard } from '@/components/NetworkGuard';
import { Footer } from '@/components/Footer';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useNetworkGuard } from '@/hooks/useNetworkGuard';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { CONTRACTS } from '@/config/contracts';
import { OptimizedLogo } from '@/components/OptimizedLogo';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';
import { Bitcoin, AlertTriangle, Zap, ExternalLink, Sparkles, Home } from 'lucide-react';
import { useErgcPurchaseModal } from '@/contexts/ErgcPurchaseModalContext';
import styles from './GmxIntegration.module.css';

// GMX SDK Type Definitions
interface GmxSdk {
  callContract: (
    contractAddress: `0x${string}`,
    abi: Abi,
    method: string,
    params: unknown[],
    opts?: { value?: bigint } | undefined
  ) => Promise<string>;
  setAccount: (address: `0x${string}`) => void;
  orders: {
    long: (params: {
      payAmount: bigint;
      marketAddress: `0x${string}`;
      payTokenAddress: `0x${string}`;
      collateralTokenAddress: `0x${string}`;
      allowedSlippageBps: number;
      leverage: bigint;
      skipSimulation?: boolean;
    }) => Promise<void>;
  };
}

// GMX Type Definitions
interface GmxOrderResponse {
  orderId: string;
  txHash: string;
  timestamp: number;
}

interface GmxPosition {
  id: string;
  size: bigint;
  collateral: bigint;
  leverage: number;
  pnl: bigint;
}

interface GmxMarketData {
  btcToken: GmxToken;
  usdcToken: GmxToken;
  market: GmxMarket;
  timestamp: number;
}

type GmxToken = {
  symbol: string;
  address: string;
  decimals: number;
  synthetic?: boolean;
  prices?: {
    min?: number;
    max?: number;
  };
};

type GmxMarket = {
  name: string;
  marketToken: string;
  indexToken: string;
  longToken: string;
  shortToken: string;
  isListed: boolean;
  listingDate?: string;
};

type CheckResult = {
  usdcBalance: string;
  usdcEBalance?: string;
  selectedUsdcAmount: string;
  btcToken?: GmxToken;
  usdcToken?: GmxToken;
  market?: GmxMarket;
  leverage: number;
  sizeUsd: string;
};

const GMX_AVALANCHE_API = 'https://avalanche-api.gmxinfra.io';
const GMX_AVALANCHE_SUBSQUID_URL = 'https://gmx.squids.live/gmx-synthetics-avalanche:prod/api/graphql';
const GMX_AVALANCHE_CHAIN_ID = 43114 as const;

// Position validation constants
const MIN_POSITION_SIZE_USD = 10;
const MIN_COLLATERAL_USD = 5;

// DetailRow component for position details
const DetailRow = ({ 
  label, 
  value, 
  highlight = false 
}: { 
  label: string; 
  value: string; 
  highlight?: boolean;
}) => (
  <div className="flex justify-between items-center">
    <span className="text-muted-foreground">{label}:</span>
    <span className={highlight ? "text-primary font-semibold" : "text-foreground"}>
      {value}
    </span>
  </div>
);

// Memoized Position Details Component (kept for backward compatibility but not used in new layout)
const PositionDetails = memo(({ 
  usdcAmount, 
  leverage, 
  toBasisPoints,
  btcPrice
}: { 
  usdcAmount: string; 
  leverage: number; 
  toBasisPoints: (leverage: number) => bigint;
  btcPrice?: number;
}) => {
  const positionSizeUsd = Number(usdcAmount) * leverage;
  // Dynamic slippage: 1% for large orders, 0.5% for small orders
  const slippagePercent = positionSizeUsd > 1000 ? 1.0 : 0.5;
  const slippageBps = Math.floor(slippagePercent * 100);
  
  return (
    <Card className="bg-blue-500/10 border-blue-500/20">
      <CardHeader>
        <CardTitle className="text-base">Position Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Collateral:</span>
            <span className="font-mono">${usdcAmount} USDC</span>
          </div>
          <div className="flex justify-between">
            <span>Leverage:</span>
            <span className="font-mono">{leverage}x</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Position Size:</span>
            <span className="font-mono">
              ${(Number(usdcAmount) * leverage).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Slippage:</span>
            <span className="font-mono">{slippagePercent}% ({slippageBps} bps)</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Basis Points:</span>
            <span className="font-mono">{toBasisPoints(leverage).toString()}</span>
          </div>
          {btcPrice && (
            <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t">
              <span>Current BTC Price:</span>
              <span className="font-mono">~${btcPrice.toLocaleString()}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

PositionDetails.displayName = 'PositionDetails';

export default function GmxIntegration() {
  const { openModal } = useErgcPurchaseModal();
  const { toast } = useToast();
  
  // CRITICAL: Check for GMX SDK TDZ errors on mount
  // SES lockdown can cause TDZ errors during module evaluation that bypass React error boundaries
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).__GMX_SDK_ERROR__) {
      const error = (window as any).__GMX_SDK_ERROR__;
      console.error('[GmxIntegration] GMX SDK TDZ error detected:', error);
      
      // Show error toast
      toast({
        title: 'GMX SDK Error',
        description: 'The GMX SDK failed to load due to browser extension conflicts. Please try incognito mode or disable wallet extensions.',
        variant: 'destructive',
      });
      
      // Clear the error flag
      delete (window as any).__GMX_SDK_ERROR__;
    }
  }, [toast]);
  const { address: wagmiAddress, isConnected: isWagmiConnected, chainId } = useAccount();
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const publicClient = usePublicClient({ chainId: avalanche.id });
  const { data: walletClient } = useWalletClient({ chainId: avalanche.id });
  const { switchToAvalanche, isSwitching } = useNetworkGuard();
  const { avaxValue, usdcBalance, usdcEBalance, usdcValue, needsMigration, refetchBalances } = useWalletBalances();

  // Get the active wallet address (Privy or wagmi)
  // Filter out Solana addresses (only use Ethereum addresses)
  const address = useMemo(() => {
    // Helper to check if address is Ethereum format
    const isEthereumAddress = (addr: string | undefined | null): `0x${string}` | undefined => {
      return (!!addr && addr.startsWith('0x') && addr.length === 42) ? (addr as `0x${string}`) : undefined;
    };

    // If user is authenticated with Privy, use Privy wallet (Ethereum only)
    if (authenticated && ready) {
      // Find Privy wallet with Ethereum address
      const privyWallet = wallets.find((w: any) =>
        w.walletClientType === 'privy' && isEthereumAddress(w.address)
      );
      if (privyWallet) return privyWallet.address as `0x${string}`;

      // Try to find any Ethereum wallet from Privy
      const ethereumWallet = wallets.find((w: any) => isEthereumAddress(w.address));
      if (ethereumWallet) return ethereumWallet.address as `0x${string}`;
    }

    // Fall back to wagmi wallet (always Ethereum)
    return wagmiAddress;
  }, [authenticated, ready, wallets, wagmiAddress]);

  // Determine if connected (Privy or wagmi)
  const isConnected = (authenticated && ready && !!address) || isWagmiConnected;

  // Check if using Privy wallet
  const isPrivyWallet = authenticated && ready && wallets.some((w: any) => w.address === address && w.walletClientType === 'privy');

  // Market data caching
  const [marketData, setMarketData] = useState<GmxMarketData | null>(null);
  const marketDataCache = useRef<GmxMarketData | null>(null);
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Debounced USDC amount
  const [usdcAmount, setUsdcAmount] = useState('10');
  const [debouncedUsdcAmount, setDebouncedUsdcAmount] = useState('10');
  const debounceTimer = useRef<NodeJS.Timeout>();
  
  // Transaction progress tracking
  const [txProgress, setTxProgress] = useState<{
    step: number;
    total: number;
    message: string;
  }>({ step: 0, total: 5, message: '' });
  
  // Confirmation dialog state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  
  // Estimated fees state
  const [estimatedFees, setEstimatedFees] = useState<{
    gasEstimate: bigint;
    executionFee: bigint;
  } | null>(null);
  
  // BTC price state
  const [btcPrice, setBtcPrice] = useState<number | undefined>(undefined);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [confirmLiveTrade, setConfirmLiveTrade] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [txStage, setTxStage] = useState<'idle' | 'approving' | 'submitting' | 'pending' | 'confirmed' | 'failed'>('idle');

  const leverage = 2.5;

  // Helper function to convert leverage to basis points
  const toBasisPoints = (leverageValue: number): bigint => {
    if (leverageValue < 1 || leverageValue > 50) {
      throw new Error('Leverage must be between 1x and 50x');
    }
    return BigInt(Math.floor(leverageValue * 10000));
  };

  // Debounce effect for USDC amount
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    
    debounceTimer.current = setTimeout(() => {
      setDebouncedUsdcAmount(usdcAmount);
    }, 300); // 300ms debounce

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [usdcAmount]);

  // Cached market data resolution
  const resolveBtcUsdcMarket = useCallback(async (): Promise<GmxMarketData> => {
    const now = Date.now();
    
    // Return cached data if still valid
    if (marketDataCache.current && (now - marketDataCache.current.timestamp) < CACHE_DURATION) {
      console.log('[GMX] Using cached market data');
      return marketDataCache.current;
    }

    console.log('[GMX] Fetching fresh market data');
    const [tokensRes, marketsRes] = await Promise.all([
      fetch(`${GMX_AVALANCHE_API}/tokens`),
      fetch(`${GMX_AVALANCHE_API}/markets`),
    ]);

    if (!tokensRes.ok) {
      throw new Error(`GMX tokens endpoint failed: HTTP ${tokensRes.status}`);
    }

    if (!marketsRes.ok) {
      throw new Error(`GMX markets endpoint failed: HTTP ${marketsRes.status}`);
    }

    const tokensJson = (await tokensRes.json()) as { tokens: GmxToken[] };
    const marketsJson = (await marketsRes.json()) as { markets: GmxMarket[] };

    const btc = tokensJson.tokens.find((t) => t.symbol === 'BTC');
    const usdc = tokensJson.tokens.find((t) => t.symbol === 'USDC');

    if (!btc) {
      throw new Error('GMX token list does not include BTC on Avalanche.');
    }

    if (!usdc) {
      throw new Error('GMX token list does not include USDC on Avalanche.');
    }

    const btcUsdcMarket = marketsJson.markets.find(
      (m) =>
        m.isListed &&
        m.indexToken.toLowerCase() === btc.address.toLowerCase() &&
        m.shortToken.toLowerCase() === usdc.address.toLowerCase()
    );

    if (!btcUsdcMarket) {
      throw new Error('Could not find a listed BTC/USD market using USDC on Avalanche.');
    }

    const marketData: GmxMarketData = {
      btcToken: btc,
      usdcToken: usdc,
      market: btcUsdcMarket,
      timestamp: now,
    };

    // Update cache
    marketDataCache.current = marketData;
    setMarketData(marketData);

    return marketData;
  }, []);

  const hasEnoughUsdc = useMemo(() => {
    try {
      const amountWei = parseUnits(debouncedUsdcAmount || '0', 6);
      return usdcValue >= amountWei;
    } catch {
      return false;
    }
  }, [debouncedUsdcAmount, usdcValue]);

  // Lazy load GMX SDK
  const loadGmxSdk = useCallback(async (): Promise<GmxSdk> => {
    // CRITICAL: Lazy load both GmxSdk AND contracts to avoid TDZ errors
    // This ensures the entire GMX SDK bundle only loads when needed
    const [{ GmxSdk }, { CONTRACTS: GMX_SDK_CONTRACTS }] = await Promise.all([
      import('@gmx-io/sdk'),
      import('@gmx-io/sdk/configs/contracts')
    ]);
    
    // Check if using Privy wallet
    const isPrivyWallet = authenticated && ready && wallets.some((w: any) => w.address === address && w.walletClientType === 'privy');
    const rpcUrl = import.meta.env.VITE_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
    
    // For Privy wallets, we need to use ethers.js provider
    if (isPrivyWallet) {
      const privyWallet = wallets.find((w: any) => w.address === address && w.walletClientType === 'privy');
      if (!privyWallet) {
        throw new Error('Privy wallet not found');
      }
      
      const privyProvider = await privyWallet.getEthereumProvider();
      if (!privyProvider) {
        throw new Error('Privy provider not available');
      }
      
      // Create a wallet client adapter for Privy using ethers
      const ethersProvider = new ethers.BrowserProvider(privyProvider);
      const signer = await ethersProvider.getSigner();
      
      // Create a viem-compatible wallet client wrapper
      const privyWalletClient = {
        account: { address: address as `0x${string}` },
        chain: avalanche,
        transport: {
          request: async ({ method, params }: { method: string; params?: unknown[] }) => {
            if (method === 'eth_sendTransaction' && params && params[0]) {
              const tx = await signer.sendTransaction(params[0] as ethers.TransactionRequest);
              return tx.hash;
            }
            if (method === 'eth_signTypedData_v4' && params) {
              const [account, data] = params as [string, string];
              const parsed = typeof data === 'string' ? JSON.parse(data) : data;
              return await signer.signTypedData(parsed.domain, parsed.types, parsed.message);
            }
            // For other methods, use the provider directly
            return await privyProvider.request({ method, params } as any);
          },
        },
        writeContract: async ({ address: contractAddress, abi, functionName, args, value }: any) => {
          const contract = new ethers.Contract(contractAddress, abi, signer);
          const tx = await contract[functionName](...args, { value });
          return tx.hash;
        },
        sendTransaction: async (transaction: any) => {
          // GMX SDK calls sendTransaction with a transaction object
          // Convert viem transaction format to ethers format
          const ethersTx: ethers.TransactionRequest = {
            to: transaction.to,
            value: transaction.value ? BigInt(transaction.value) : undefined,
            data: transaction.data,
            gasLimit: transaction.gas ? BigInt(transaction.gas) : undefined,
            maxFeePerGas: transaction.maxFeePerGas ? BigInt(transaction.maxFeePerGas) : undefined,
            maxPriorityFeePerGas: transaction.maxPriorityFeePerGas ? BigInt(transaction.maxPriorityFeePerGas) : undefined,
            gasPrice: transaction.gasPrice ? BigInt(transaction.gasPrice) : undefined,
          };
          const tx = await signer.sendTransaction(ethersTx);
          return tx.hash;
        },
      } as unknown as WalletClient;
      
      const sdk = new GmxSdk({
        chainId: GMX_AVALANCHE_CHAIN_ID,
        rpcUrl,
        oracleUrl: GMX_AVALANCHE_API,
        subsquidUrl: GMX_AVALANCHE_SUBSQUID_URL,
        walletClient: privyWalletClient,
      });
      
      console.log('[GMX SDK] SDK initialized with Privy wallet');
      console.log('[GMX SDK] Available contracts:', GMX_SDK_CONTRACTS[GMX_AVALANCHE_CHAIN_ID]);
      return sdk;
    }
    
    if (!walletClient) {
      throw new Error('Wallet client not available');
    }

    console.log('[GMX SDK] Available contracts:', GMX_SDK_CONTRACTS[GMX_AVALANCHE_CHAIN_ID]);
    console.log('[GMX SDK] ExchangeRouter from config:', GMX_SDK_CONTRACTS[GMX_AVALANCHE_CHAIN_ID]?.ExchangeRouter);

    // Initialize SDK with standard configuration
    // Note: SDK v1.4.0 may have outdated contract addresses
    // The approval issue might need to be handled differently
    const sdk = new GmxSdk({
      chainId: GMX_AVALANCHE_CHAIN_ID,
      rpcUrl,
      oracleUrl: GMX_AVALANCHE_API,
      subsquidUrl: GMX_AVALANCHE_SUBSQUID_URL,
      walletClient,
    });

    console.log('[GMX SDK] SDK initialized with default contracts');
    console.log('[GMX SDK] Note: If approval fails, SDK may need update or manual approval handling');

    return sdk;
  }, [walletClient, authenticated, ready, wallets, address]);

  // Estimate transaction costs
  const estimateTransactionCosts = useCallback(async () => {
    if (!publicClient || !address) return;
    
    try {
      // Rough gas estimate for GMX order (actual will vary)
      const gasPrice = await publicClient.getGasPrice();
      const estimatedGas = 500000n; // ~500k gas for GMX order
      const gasEstimate = gasPrice * estimatedGas;
      
      // GMX execution fee is typically 0.01-0.02 AVAX
      const executionFee = parseUnits('0.015', 18); // 0.015 AVAX
      
      setEstimatedFees({ gasEstimate, executionFee });
    } catch (error) {
      console.error('Failed to estimate fees:', error);
    }
  }, [publicClient, address]);

  // Update fee estimates on mount and when amount changes
  useEffect(() => {
    if (isConnected && chainId === avalanche.id) {
      estimateTransactionCosts();
    }
  }, [isConnected, chainId, debouncedUsdcAmount, estimateTransactionCosts]);

  const handleCheckAndPrepare = async () => {
    setIsChecking(true);
    setResult(null);
    setTxHash(null);
    setTxStage('idle');
    setConfirmLiveTrade(false);

    try {
      if (!isConnected || !address) {
        toast({
          title: 'Wallet not connected',
          description: 'Please connect your wallet first.',
          variant: 'destructive',
        });
        return;
      }

      // Network guard: Skip for Privy smart wallets (always on Avalanche)
      const activeChainId = isPrivyWallet ? avalanche.id : chainId;
      if (!isPrivyWallet && activeChainId !== undefined && activeChainId !== avalanche.id) {
        toast({
          title: 'Wrong network',
          description: 'Please switch to Avalanche C-Chain.',
          variant: 'destructive',
        });
        switchToAvalanche();
        return;
      }

      if (!usdcAmount || Number(usdcAmount) <= 0) {
        toast({
          title: 'Invalid amount',
          description: 'Enter a USDC amount greater than 0.',
          variant: 'destructive',
        });
        return;
      }

      await refetchBalances();

      if (!hasEnoughUsdc) {
        toast({
          title: 'Insufficient USDC',
          description: `You need at least ${usdcAmount} USDC.`,
          variant: 'destructive',
        });
        return;
      }

      const marketDataResult = await resolveBtcUsdcMarket();
      const sizeUsd = (Number(usdcAmount) * leverage).toFixed(2);
      
      // Extract BTC price from market data
      setBtcPrice(marketDataResult.btcToken?.prices?.max || undefined);

      setResult({
        usdcBalance,
        usdcEBalance,
        selectedUsdcAmount: usdcAmount,
        btcToken: marketDataResult.btcToken,
        usdcToken: marketDataResult.usdcToken,
        market: marketDataResult.market,
        leverage,
        sizeUsd,
      });

      toast({
        title: 'GMX check complete',
        description: 'USDC balance and BTC market resolved. Ready for execution wiring.',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'GMX check failed.';
      toast({
        title: 'GMX check failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleExecuteLive = async () => {
    console.log('[GMX] handleExecuteLive started');
    setIsExecuting(true);

    try {
      console.log('[GMX] Checking wallet connection...');
      if (!isConnected || !address) {
        console.log('[GMX] Wallet not connected');
        toast({
          title: 'Wallet not connected',
          description: 'Please connect your wallet first.',
          variant: 'destructive',
        });
        return;
      }

      // Network guard: Skip for Privy smart wallets (always on Avalanche)
      const activeChainId = isPrivyWallet ? avalanche.id : chainId;
      console.log('[GMX] Checking network...', { chainId, activeChainId, expected: avalanche.id, isPrivyWallet });
      if (!isPrivyWallet && activeChainId !== undefined && activeChainId !== avalanche.id) {
        console.log('[GMX] Wrong network');
        toast({
          title: 'Wrong network',
          description: 'Please switch to Avalanche C-Chain.',
          variant: 'destructive',
        });
        switchToAvalanche();
        return;
      }

      console.log('[GMX] Refetching balances...');
      await refetchBalances();

      console.log('[GMX] Checking market data...');
      const marketTokenAddress = result?.market?.marketToken;
      const btcTokenAddress = result?.btcToken?.address;
      const usdcTokenAddress = result?.usdcToken?.address;

      console.log('[GMX] Market data check:', {
        marketTokenAddress,
        btcTokenAddress,
        usdcTokenAddress,
        hasResult: !!result,
        hasBtcToken: !!result?.btcToken,
        hasUsdcToken: !!result?.usdcToken,
        hasMarket: !!result?.market,
      });

      let resolved: GmxMarketData;
      if (marketTokenAddress && btcTokenAddress && usdcTokenAddress && result?.btcToken && result?.usdcToken && result?.market) {
        console.log('[GMX] Using cached market data');
        resolved = {
          btcToken: result.btcToken,
          usdcToken: result.usdcToken,
          market: result.market,
          timestamp: Date.now(),
        };
      } else {
        console.log('[GMX] Resolving fresh market data...');
        resolved = await resolveBtcUsdcMarket();
        const sizeUsd = (Number(usdcAmount) * leverage).toFixed(2);
        setResult({
          usdcBalance,
          usdcEBalance,
          selectedUsdcAmount: usdcAmount,
          btcToken: resolved.btcToken,
          usdcToken: resolved.usdcToken,
          market: resolved.market,
          leverage,
          sizeUsd,
        });
      }

      console.log('[GMX] Checking trade confirmation...');
      if (!confirmLiveTrade) {
        console.log('[GMX] Trade not confirmed');
        toast({
          title: 'Confirmation required',
          description: 'Enable the confirmation checkbox to place a live trade on GMX.',
          variant: 'destructive',
        });
        return;
      }

      console.log('[GMX] Checking wallet clients...', { 
        hasWalletClient: !!walletClient, 
        hasPublicClient: !!publicClient,
        isPrivyWallet
      });
      // For Privy wallets, we don't need wagmi's walletClient (we use Privy provider directly)
      if (!isPrivyWallet && (!walletClient || !publicClient)) {
        console.log('[GMX] Wallet clients not ready');
        toast({
          title: 'Wallet client not ready',
          description: 'Please reconnect your wallet and try again.',
          variant: 'destructive',
        });
        return;
      }
      if (!publicClient) {
        console.log('[GMX] Public client not ready');
        toast({
          title: 'Public client not ready',
          description: 'Please reconnect your wallet and try again.',
          variant: 'destructive',
        });
        return;
      }

      console.log('[GMX] Setting up token parameters...');
      const payTokenAddress = resolved.usdcToken.address as `0x${string}`;
      const payTokenDecimals = resolved.usdcToken.decimals;
      const payAmount = parseUnits(usdcAmount || '0', payTokenDecimals);
      
      console.log('[GMX] Amount calculation:', {
        usdcAmount,
        payTokenDecimals,
        payAmount: payAmount.toString(),
        payAmountUsdc: formatUnits(payAmount, payTokenDecimals),
      });
      if (payAmount <= 0n) {
        toast({
          title: 'Invalid amount',
          description: 'Enter a USDC amount greater than 0.',
          variant: 'destructive',
        });
        return;
      }

      // Minimum position size validation
      const positionSizeUsd = Number(usdcAmount) * leverage;
      if (Number(usdcAmount) < MIN_COLLATERAL_USD) {
        toast({
          title: 'Collateral too small',
          description: `Minimum collateral is $${MIN_COLLATERAL_USD} USDC`,
          variant: 'destructive',
        });
        return;
      }

      if (positionSizeUsd < MIN_POSITION_SIZE_USD) {
        toast({
          title: 'Position too small',
          description: `Minimum position size is $${MIN_POSITION_SIZE_USD} USD`,
          variant: 'destructive',
        });
        return;
      }

      if (avaxValue <= 0n) {
        toast({
          title: 'No AVAX for fees',
          description: 'You need AVAX for the GMX execution fee and gas.',
          variant: 'destructive',
        });
        return;
      }

      setTxHash(null);
      setTxStage('approving');
      setTxProgress({ step: 1, total: 3, message: 'Validating inputs...' });

      // CRITICAL: Lazy load contracts here if needed (orderVault is not currently used)
      // If you need orderVault in the future, uncomment and lazy load:
      // const { CONTRACTS: GMX_SDK_CONTRACTS } = await import('@gmx-io/sdk/configs/contracts');
      // const orderVault = GMX_SDK_CONTRACTS[GMX_AVALANCHE_CHAIN_ID].OrderVault as `0x${string}`;

      console.log('[GMX trade token]', {
        payTokenAddress,
        payTokenDecimals,
        amount: usdcAmount,
        payAmount: payAmount.toString(),
      });

      // For Privy wallets, we don't need wagmi's walletClient (we use Privy provider directly)
      if (!isPrivyWallet && !walletClient) {
        toast({
          title: 'Wallet client not ready',
          description: 'Please reconnect your wallet and try again.',
          variant: 'destructive',
        });
        return;
      }
      if (!publicClient) {
        toast({
          title: 'Public client not ready',
          description: 'Please reconnect your wallet and try again.',
          variant: 'destructive',
        });
        return;
      }

      // GMX V2 Synthetics only requires ERC20 approval to the Router contract
      // The Router uses pluginTransfer with onlyRouterPlugin modifier (no user plugin approval needed)
      // GMX V2 Router address on Avalanche
      const router = '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68' as `0x${string}`;
      
      setTxProgress({ step: 2, total: 4, message: 'Checking USDC approval for GMX Router...' });
      
      console.log('[GMX] Setting up approval - Router:', router);
      
      // Check and set ERC20 approval to Router
      const routerAllowance = (await publicClient.readContract({
        address: payTokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address as `0x${string}`, router],
      })) as bigint;
      
      console.log('[GMX] Router ERC20 allowance:', routerAllowance.toString(), 'payAmount:', payAmount.toString());
      
      if (routerAllowance < payAmount) {
        console.log('[GMX] Approving USDC to Router...');
        toast({ title: 'Approval needed', description: 'Please approve USDC for GMX Router...' });
        
        let approveTxHash: `0x${string}`;
        
        if (isPrivyWallet) {
          // Use Privy wallet for approval
          const privyWallet = wallets.find((w: any) => w.address === address && w.walletClientType === 'privy');
          if (!privyWallet) {
            throw new Error('Privy wallet not found');
          }
          
          const privyProvider = await privyWallet.getEthereumProvider();
          if (!privyProvider) {
            throw new Error('Privy provider not available');
          }
          
          const ethersProvider = new ethers.BrowserProvider(privyProvider);
          const signer = await ethersProvider.getSigner();
          const usdcContract = new ethers.Contract(payTokenAddress, erc20Abi, signer);
          
          const tx = await usdcContract.approve(router, maxUint256);
          approveTxHash = tx.hash as `0x${string}`;
          console.log('[GMX] Router approval submitted via Privy:', approveTxHash);
          
          await tx.wait();
          console.log('[GMX] Router approval confirmed');
        } else {
          // Use wagmi wallet client
          if (!walletClient) {
            throw new Error('Wallet client not available');
          }
          
          approveTxHash = await (walletClient as WalletClient).writeContract({
            address: payTokenAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [router, maxUint256],
            chain: avalanche,
            account: address as `0x${string}`,
          });
          
          console.log('[GMX] Router approval submitted:', approveTxHash);
          const receipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
          if (receipt.status !== 'success') {
            throw new Error('Router approval failed');
          }
          console.log('[GMX] Router approval confirmed');
        }
      } else {
        console.log('[GMX] Router already has sufficient allowance');
      }
      
      toast({
        title: 'Approval ready',
        description: 'USDC approved for GMX Router.',
      });

      setTxStage('submitting');
      setTxProgress({ step: 2, total: 3, message: 'Submitting order to GMX...' });

      let submittedHash: `0x${string}` | null = null;

      try {
        console.log('[GMX] Loading SDK...');
        const sdk = await loadGmxSdk();
        console.log('[GMX] SDK initialized');
        
        sdk.setAccount(address as `0x${string}`);
        console.log('[GMX] Account set:', address);

        const originalCallContract = sdk.callContract.bind(sdk);
        sdk.callContract = (async (
          contractAddress: `0x${string}`,
          abi: Abi,
          method: string,
          params: unknown[],
          opts?: { value?: bigint } | undefined
        ) => {
          try {
            const value = (opts as { value?: bigint } | undefined)?.value;
            console.log('[GMX SDK callContract]', {
              contractAddress,
              method,
              hasOpts: !!opts,
              value: value?.toString?.(),
            });

            if (method === 'multicall' && Array.isArray(params) && Array.isArray(params[0])) {
              const dataItems = params[0] as string[];
              console.log(
                '[GMX SDK multicall selectors]',
                dataItems.map((d) => (typeof d === 'string' ? d.slice(0, 10) : String(d)))
              );
              
              let totalWntAmount = 0n;
              
              // Extract sendWnt amounts for execution fees
              dataItems.forEach((data, index) => {
                if (typeof data === 'string' && data.toLowerCase().startsWith('0x7d39aaf1')) {
                  console.log('[GMX] sendWnt calldata analysis:', {
                    index,
                    fullData: data,
                    length: data.length,
                    selector: data.slice(0, 10),
                    addressPart: data.slice(10, 74), // 32 bytes for address
                    amountPart: data.slice(74, 138), // 32 bytes for amount
                  });
                  
                  // sendWnt(address,uint256) selector: 0x7d39aaf1
                  // ABI: function sendWnt(address to, uint256 amount) external
                  // Layout: 4 bytes selector + 32 bytes address + 32 bytes amount
                  // Amount starts at offset 74 (0x + 4 + 32 + 32) and is 32 bytes long
                  if (data.length >= 138) { // 0x + 4 + 64 + 64 = 132 chars minimum
                    const amountHex = data.slice(74, 138);
                    const amount = BigInt(`0x${amountHex}`);
                    totalWntAmount += amount;
                    console.log('[GMX] Extracted sendWnt amount:', {
                      index,
                      amountHex,
                      amount: amount.toString(),
                      amountAvax: formatUnits(amount, 18), // AVAX has 18 decimals
                    });
                  } else {
                    console.warn('[GMX] Invalid sendWnt calldata length at index:', index, 'length:', data.length);
                  }
                }
              });
              
              // Decode sendTokens amount to see what the SDK is trying to transfer
              dataItems.forEach((data, index) => {
                if (typeof data === 'string' && data.toLowerCase().startsWith('0xe6d66ac8')) {
                  // sendTokens(address,address,uint256) selector: 0xe6d66ac8
                  // Extract the amount (last 32 bytes)
                  const amountHex = data.slice(data.length - 64);
                  const amount = BigInt(`0x${amountHex}`);
                  console.log('[GMX] sendTokens decoded:', {
                    index,
                    amount: amount.toString(),
                    amountUsdc: formatUnits(amount, 6), // USDC has 6 decimals
                  });
                }
              });
              
              // Log execution fee info but DON'T modify opts.value - let SDK handle it
              if (totalWntAmount > 0n) {
                const existingValue = (opts as { value?: bigint } | undefined)?.value || 0n;
                
                console.log('[GMX] Execution fee (SDK-managed):', {
                  sendWntAmount: formatUnits(totalWntAmount, 18),
                  existingValue: formatUnits(existingValue, 18),
                  note: 'Letting SDK handle msg.value - not modifying',
                });
                // Don't modify opts.value - SDK already set it correctly
              }
            }
          } catch (e) {
            console.log('[GMX SDK callContract log failed]', e);
          }

          // Set gas parameters: maxFeePerGas = baseFee + minerTip + 1 gwei for profitability
          try {
            const baseFee = await publicClient.getGasPrice();
            const minerTip = parseUnits('12', 9); // 12 gwei miner tip
            const maxFeeBuffer = parseUnits('1', 9); // 1 gwei buffer
            const maxFeePerGas = baseFee + minerTip + maxFeeBuffer;
            
            console.log('[GMX] Gas parameters:', {
              baseFee: formatUnits(baseFee, 9) + ' gwei',
              minerTip: '12 gwei',
              maxFeeBuffer: '1 gwei',
              maxFeePerGas: formatUnits(maxFeePerGas, 9) + ' gwei',
              note: 'maxFee = baseFee + minerTip + 1 for profitability',
            });
            
            opts = { 
              ...opts, 
              maxFeePerGas,
              maxPriorityFeePerGas: minerTip,
            } as { value?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
          } catch (gasError) {
            console.warn('[GMX] Failed to set custom gas, using defaults:', gasError);
          }

          console.log('[GMX] About to call originalCallContract...');
          
          // For Privy wallets, intercept and route through Privy provider with RPC bypass
          if (isPrivyWallet && method === 'multicall') {
            try {
              const privyWallet = wallets.find((w: any) => w.address === address && w.walletClientType === 'privy');
              if (!privyWallet) {
                throw new Error('Privy wallet not found');
              }
              
              const privyProvider = await privyWallet.getEthereumProvider();
              if (!privyProvider) {
                throw new Error('Privy provider not available');
              }

              const avalancheRpcUrl = import.meta.env.VITE_AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
              const avalanchePublicClient = createPublicClient({
                chain: avalanche,
                transport: http(avalancheRpcUrl),
              });

              let interceptedTxHash: string | null = null;

              const originalProviderRequest = privyProvider.request.bind(privyProvider);
              privyProvider.request = async (args: any) => {
                if (args.method === 'eth_chainId') return '0xa86a';
                if (args.method === 'eth_getBalance') return '0x3635c9adc5dea00000';
                if (args.method === 'eth_estimateGas' && args.params && args.params[0]) {
                  // Get real gas estimate from Avalanche RPC, bypassing Privy's balance check
                  try {
                    const estimate = await avalanchePublicClient.estimateGas({
                      account: args.params[0].from as `0x${string}`,
                      to: args.params[0].to as `0x${string}`,
                      value: args.params[0].value ? BigInt(args.params[0].value) : undefined,
                      data: args.params[0].data as `0x${string}`,
                    });
                    // Add 20% buffer for safety
                    const bufferedEstimate = (estimate * 120n) / 100n;
                    return `0x${bufferedEstimate.toString(16)}`;
                  } catch (estimateError) {
                    console.warn('[GMX] Failed to estimate gas from Avalanche RPC, using fallback:', estimateError);
                    // Fallback to a higher value if estimation fails
                    return '0x1e8480'; // 2,000,000 gas
                  }
                }
                if (args.method === 'eth_sendTransaction') {
                  const privyHash = await originalProviderRequest(args);
                  if (privyHash) interceptedTxHash = privyHash as string;
                  return privyHash;
                }
                if (args.method === 'eth_sendRawTransaction' && args.params && args.params[0]) {
                  const txHash = await avalanchePublicClient.sendRawTransaction({
                    serializedTransaction: args.params[0] as `0x${string}`,
                  });
                  interceptedTxHash = txHash;
                  return txHash;
                }
                if (args.method === 'eth_getTransactionByHash' && interceptedTxHash) {
                  console.log('[GMX] 🚫 Blocked eth_getTransactionByHash in provider - transaction already broadcast');
                  return null;
                }
                return originalProviderRequest(args);
              };

              const originalFetch = window.fetch;
              window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
                const isPrivyRpc = (url.includes('auth.privy.io') && url.includes('/rpc')) || url.includes('rpc.privy.systems');
                
                if (isPrivyRpc && init?.body) {
                  try {
                    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
                    if (body.method === 'eth_chainId') {
                      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id || 1, result: '0xa86a' }), {
                        status: 200, headers: { 'Content-Type': 'application/json' }
                      });
                    }
                    if (body.method === 'eth_getBalance') {
                      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id || 1, result: '0x3635c9adc5dea00000' }), {
                        status: 200, headers: { 'Content-Type': 'application/json' }
                      });
                    }
                    if (body.method === 'eth_estimateGas' && body.params && body.params[0]) {
                      // Get real gas estimate from Avalanche RPC, bypassing Privy's balance check
                      try {
                        const txParams = body.params[0];
                        const estimate = await avalanchePublicClient.estimateGas({
                          account: txParams.from as `0x${string}`,
                          to: txParams.to as `0x${string}`,
                          value: txParams.value ? BigInt(txParams.value) : undefined,
                          data: txParams.data as `0x${string}`,
                        });
                        // Add 20% buffer for safety
                        const bufferedEstimate = (estimate * 120n) / 100n;
                        return new Response(JSON.stringify({ 
                          jsonrpc: '2.0', 
                          id: body.id || 1, 
                          result: `0x${bufferedEstimate.toString(16)}` 
                        }), {
                          status: 200, headers: { 'Content-Type': 'application/json' }
                        });
                      } catch (estimateError) {
                        console.warn('[GMX] Failed to estimate gas from Avalanche RPC, using fallback:', estimateError);
                        // Fallback to a higher value if estimation fails
                        return new Response(JSON.stringify({ 
                          jsonrpc: '2.0', 
                          id: body.id || 1, 
                          result: '0x1e8480' // 2,000,000 gas
                        }), {
                          status: 200, headers: { 'Content-Type': 'application/json' }
                        });
                      }
                    }
                    if (body.method === 'eth_sendTransaction') {
                      const response = await originalFetch(input, init);
                      const responseData = await response.clone().json();
                      if (responseData.result && !responseData.error) {
                        interceptedTxHash = responseData.result;
                        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id || 1, result: responseData.result }), {
                          status: 200, headers: { 'Content-Type': 'application/json' }
                        });
                      }
                      return response;
                    }
                    if (body.method === 'eth_sendRawTransaction' && body.params && body.params[0]) {
                      const txHash = await avalanchePublicClient.sendRawTransaction({
                        serializedTransaction: body.params[0] as `0x${string}`,
                      });
                      interceptedTxHash = txHash;
                      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id || 1, result: txHash }), {
                        status: 200, headers: { 'Content-Type': 'application/json' }
                      });
                    }
                    if (body.method === 'eth_getTransactionByHash' && interceptedTxHash) {
                      console.log('[GMX] 🚫 Blocked eth_getTransactionByHash in fetch - transaction already broadcast');
                      return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id || 1, result: null }), {
                        status: 200, headers: { 'Content-Type': 'application/json' }
                      });
                    }
                  } catch (parseError) {
                    console.warn('[GMX] Failed to parse Privy RPC body:', parseError);
                  }
                }
                return originalFetch(input, init);
              };

              try {
                const ethersProvider = new ethers.BrowserProvider(privyProvider);
                const signer = await ethersProvider.getSigner();
                const contract = new ethers.Contract(contractAddress, abi as ethers.InterfaceAbi, signer);
                
                // Build the multicall transaction
                const dataItems = params[0] as string[];
                const txValue = (opts as { value?: bigint } | undefined)?.value || 0n;
                
                console.log('[GMX] Sending multicall via Privy (intercepting to bypass Privy RPC):', {
                  contractAddress,
                  dataItems: dataItems.length,
                  value: txValue.toString(),
                });
                
                const txPromise = contract.multicall(dataItems, { value: txValue });
                
                await Promise.race([
                  txPromise.then((tx: any) => {
                    if (!interceptedTxHash && tx?.hash) interceptedTxHash = tx.hash;
                  }).catch(() => {}),
                  new Promise(resolve => setTimeout(resolve, 15000))
                ]);
                
                if (!interceptedTxHash) {
                  const startTime = Date.now();
                  while (!interceptedTxHash && Date.now() - startTime < 5000) {
                    await new Promise(resolve => setTimeout(resolve, 50));
                  }
                }
                
                if (interceptedTxHash) {
                  const hash = interceptedTxHash as `0x${string}`;
                  console.log('[GMX] Transaction submitted via Privy (intercepted):', hash);
                  submittedHash = hash;
                  
                  // Delay restoration of interceptors to allow ethers.js polling to complete
                  // Keep interceptors active for 10 seconds to handle any post-transaction polling
                  setTimeout(() => {
                    window.fetch = originalFetch;
                    privyProvider.request = originalProviderRequest;
                  }, 10000);
                  
                  return hash;
                } else {
                  throw new Error('Failed to get transaction hash from Privy');
                }
              } catch (innerError) {
                // Restore interceptors immediately on error
                window.fetch = originalFetch;
                privyProvider.request = originalProviderRequest;
                throw innerError;
              }
            } catch (privyError) {
              console.error('[GMX] Privy transaction failed, falling back to original:', privyError);
              // Fall through to original call
            }
          }
          
          try {
            const h = (await originalCallContract(contractAddress, abi, method, params, opts)) as `0x${string}`;
            console.log('[GMX] Transaction submitted:', h);
            submittedHash = h;
            return h;
          } catch (contractError) {
            console.error('[GMX] originalCallContract failed:', contractError);
            throw contractError;
          }
        }) as typeof sdk.callContract;

        console.log('[GMX] About to call sdk.orders.long with params:', {
          payAmount: payAmount.toString(),
          marketAddress: resolved.market.marketToken,
          payTokenAddress,
          collateralTokenAddress: payTokenAddress,
          allowedSlippageBps: positionSizeUsd > 1000 ? 100 : 50, // Dynamic slippage
          leverage: toBasisPoints(leverage).toString(),
          skipSimulation: true,
        });

        // Pre-check AVAX balance for execution fees
        const avaxBalance = await publicClient.getBalance({ 
          address: address as `0x${string}` 
        });
        console.log('[GMX] AVAX balance check:', {
          balance: avaxBalance.toString(),
          balanceAvax: formatUnits(avaxBalance, 18),
        });

        // Estimated execution fee check (0.02 AVAX minimum recommended)
        const minExecutionFee = parseUnits('0.02', 18); // 0.02 AVAX
        if (avaxBalance < minExecutionFee) {
          throw new Error(`Insufficient AVAX for execution fees. Required: ${formatUnits(minExecutionFee, 18)} AVAX, Available: ${formatUnits(avaxBalance, 18)} AVAX. Please add more AVAX to your wallet.`);
        }

        await sdk.orders.long({
          payAmount,
          marketAddress: resolved.market.marketToken as `0x${string}`,
          payTokenAddress,
          collateralTokenAddress: payTokenAddress,
          allowedSlippageBps: positionSizeUsd > 1000 ? 100 : 50, // Dynamic slippage: 1% or 0.5%
          leverage: toBasisPoints(leverage), // ✅ Correct: 25000n for 2.5x
          skipSimulation: true,
        });

        console.log('[GMX] sdk.orders.long completed');
      } catch (error) {
        console.error('[GMX] Error during order submission:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        
        // Provide more specific error messages for common issues
        if (errorMessage.includes('insufficient funds')) {
          throw new Error('Insufficient AVAX for gas fees. Please add more AVAX to your wallet.');
        } else if (errorMessage.includes('allowance')) {
          throw new Error('Token allowance issue. Please try approving USDC again.');
        } else if (errorMessage.includes('slippage')) {
          throw new Error('Slippage protection triggered. Try again with higher slippage tolerance.');
        } else {
          throw new Error(`GMX Order Failed: ${errorMessage}`);
        }
      }

      if (!submittedHash) {
        throw new Error('GMX transaction submitted but no hash was captured.');
      }

      setTxHash(submittedHash);
      setTxStage('pending');
      setTxProgress({ step: 3, total: 3, message: 'Confirming transaction...' });
      toast({
        title: 'GMX order submitted',
        description: `Transaction hash: ${submittedHash}`,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
      if (receipt.status === 'success') {
        setTxStage('confirmed');
        // Reset form state after successful trade
        setUsdcAmount('10');
        setConfirmLiveTrade(false);
        setResult(null);
        toast({
          title: 'Transaction confirmed',
          description: 'Your GMX order transaction was confirmed on-chain.',
        });
      } else {
        setTxStage('failed');
        toast({
          title: 'Transaction failed',
          description: 'The GMX order transaction reverted.',
          variant: 'destructive',
        });
      }
    } catch (error: unknown) {
      setTxStage('failed');
      setTxProgress({ step: 0, total: 5, message: '' });
      
      let userMessage = 'Execution failed';
      let description = 'Please try again';
      
      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();
        
        // Parse common error patterns
        if (errorMsg.includes('insufficient funds') || errorMsg.includes('insufficient balance')) {
          userMessage = 'Insufficient funds';
          description = 'You need more USDC or AVAX to complete this transaction';
        } else if (errorMsg.includes('user rejected') || errorMsg.includes('user denied')) {
          userMessage = 'Transaction cancelled';
          description = 'You rejected the transaction in your wallet';
        } else if (errorMsg.includes('slippage')) {
          userMessage = 'Price moved too much';
          description = 'Market price changed significantly. Try again or increase slippage tolerance.';
        } else if (errorMsg.includes('gas required exceeds allowance')) {
          userMessage = 'Insufficient AVAX for gas';
          description = 'You need more AVAX to pay for transaction fees';
        } else if (errorMsg.includes('nonce too low')) {
          userMessage = 'Transaction conflict';
          description = 'Another transaction is pending. Wait for it to complete.';
        } else if (errorMsg.includes('timeout') || errorMsg.includes('timed out')) {
          userMessage = 'Network timeout';
          description = 'The network is slow. Please try again.';
        } else {
          description = error.message;
        }
      }
      
      const retryMessage = '';
      
      toast({
        title: userMessage,
        description: description + retryMessage,
        variant: 'destructive',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Subtle glow effect */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/5 blur-[120px] rounded-full animate-glow-pulse" />
      </div>

      <div className="relative z-10">
        <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
          <div className="container mx-auto px-4 py-3 sm:py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="font-bold text-primary-foreground text-sm">B</span>
                </div>
                <span className="text-lg sm:text-xl font-bold text-foreground">TiltVault</span>
                <span className="text-lg sm:text-xl font-bold text-foreground">Bitcoin</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <span className="text-xs sm:text-sm text-muted-foreground hidden sm:block">Leveraged Trading</span>
                <ConnectWalletButton />
                <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main navigation">
                  <Link to="/" aria-label="Go to Banking page">
                    <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4" aria-label="Banking">
                      <Home className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Banking</span>
                    </Button>
                  </Link>
                  <Link to="/gmx" aria-label="Go to Bitcoin trading page">
                    <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4" aria-label="Bitcoin">
                      <Bitcoin className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Bitcoin</span>
                    </Button>
                  </Link>
                  <Link to="/stack" aria-label="Go to Auto Invest page">
                    <Button variant="outline" size="sm" className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm px-2 sm:px-4" aria-label="Auto Invest">
                      <Zap className="h-3 w-3 sm:h-4 sm:w-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Auto</span>
                    </Button>
                  </Link>
                </nav>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8 max-w-xl space-y-6">
          <NetworkGuard />

          <div className="card-elevated rounded-xl border border-subtle p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Bitcoin className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">Initiate BTC Long (GMX)</h2>
                <p className="text-sm text-muted-foreground">
                  This will submit a live GMX order on Avalanche when confirmed.
                </p>
              </div>
            </div>
            {/* Collateral Input */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">
                USDC to use as collateral
              </label>
              <div className="relative">
                <Input
                  type="number"
                  value={usdcAmount}
                  onChange={(e) => setUsdcAmount(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-16 h-12 text-lg"
                  placeholder="0.00"
                  disabled={isChecking || isExecuting}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                  USDC
                </span>
              </div>

              {/* Detected Balances */}
              <div className="flex gap-4 text-sm">
                <span className="text-muted-foreground">Detected balances</span>
                <span className={isConnected && avaxValue > 0n ? "text-success" : "text-destructive"}>
                  AVAX: {isConnected ? (avaxValue > 0n ? 'OK' : '0') : '—'}
                </span>
                <span className={isConnected && parseFloat(usdcBalance) > 0 ? "text-success" : "text-destructive"}>
                  USDC: {isConnected ? usdcBalance : '—'}
                </span>
              </div>
              {needsMigration && (
                <div className="text-xs text-destructive font-medium p-2 bg-destructive/10 rounded">
                  ⚠️ Action Required: You have USDC.e but no native USDC. 
                  GMX requires native USDC ({CONTRACTS.USDC}). Please migrate your tokens first.
                </div>
              )}
            </div>

            {/* Info Box */}
            <div className="bg-muted/50 rounded-lg p-4 border border-border">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="confirmLiveTrade"
                  checked={confirmLiveTrade}
                  onCheckedChange={(checked) => setConfirmLiveTrade(checked === true)}
                  disabled={isExecuting || isChecking}
                />
                <label htmlFor="confirmLiveTrade" className="text-sm text-muted-foreground leading-tight cursor-pointer">
                  A live GMX BTC long order will be placed on Avalanche.
                </label>
              </div>
            </div>

            {/* Position Details */}
            <div className="space-y-4">
              <h3 className="font-semibold text-foreground">Position Details</h3>
              <div className="space-y-3">
                <DetailRow label="Collateral" value={`$${usdcAmount} USDC`} />
                <DetailRow label="Leverage" value="2.5x" highlight />
                <DetailRow label="Position Size" value={`$${(Number(usdcAmount) * leverage).toFixed(2)}`} />
                <DetailRow label="Slippage" value={`${(Number(usdcAmount) * leverage) > 1000 ? '1.0%' : '0.5%'} (${(Number(usdcAmount) * leverage) > 1000 ? '100' : '50'} bps)`} />
                <DetailRow label="Basis Points" value={toBasisPoints(leverage).toString()} />
              </div>
            </div>

            {/* Dynamic Slippage Warning */}
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-warning text-sm">Dynamic Slippage Protection</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  This order uses dynamic slippage: 0.5% for small trades (&lt;$1000) or 1% for large trades. 
                  This provides better execution while protecting against price impact.
                </p>
              </div>
            </div>

            {/* Fee Estimates */}
            {estimatedFees && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Estimated Gas:</span>
                  <span className="text-foreground">~{formatUnits(estimatedFees.gasEstimate, 18)} AVAX</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Execution Fee:</span>
                  <span className="text-foreground">~{formatUnits(estimatedFees.executionFee, 18)} AVAX</span>
                </div>
                <div className="flex justify-between font-medium pt-2 border-t border-border">
                  <span className="text-muted-foreground">Total Fees:</span>
                  <span className="text-foreground">~{formatUnits(estimatedFees.gasEstimate + estimatedFees.executionFee, 18)} AVAX</span>
                </div>
              </div>
            )}

            {/* Transaction Progress Indicator */}
            {isExecuting && txProgress.step > 0 && (
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span>{txProgress.step}/{txProgress.total}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div 
                      className={styles.progressBar}
                      style={{ '--progress-width': `${Math.round((txProgress.step / txProgress.total) * 100)}%` } as React.CSSProperties}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{txProgress.message}</p>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <Button
              onClick={() => {
                if (!confirmLiveTrade) {
                  toast({
                    title: 'Confirmation required',
                    description: 'Check the confirmation box first',
                    variant: 'destructive',
                  });
                  return;
                }
                setShowConfirmDialog(true);
              }}
              disabled={!confirmLiveTrade || isExecuting || isSwitching || isChecking}
              className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground glow-primary"
            >
              <Zap className="w-4 h-4 mr-2" />
              {isExecuting ? 'Submitting…' : 'Confirm Order'}
            </Button>
            <Button onClick={handleCheckAndPrepare} disabled={isChecking || isExecuting || isSwitching} variant="outline" className="w-full">
              {isChecking ? 'Checking…' : 'Preview Market'}
            </Button>

            {/* Trade Details */}
            {(result || txHash) && (
              <div className="bg-muted/40 rounded-lg p-4 border border-border space-y-2 text-sm">
                <h4 className="font-semibold text-foreground mb-2">Trade Details</h4>
                <p className="text-muted-foreground text-xs mb-3">
                  Collateral: {usdcAmount} USDC • Leverage: {leverage}x
                </p>
                {result?.market?.name && (
                  <div><span className="font-medium">GMX Market:</span> {result.market.name}</div>
                )}
                {result?.market?.marketToken && (
                  <div><span className="font-medium">Market Token:</span> {result.market.marketToken}</div>
                )}
                {txHash && (
                  <div className="pt-2 space-y-1">
                    <div><span className="font-medium">Tx Hash:</span> {txHash}</div>
                    <a
                      className="text-sm underline"
                      href={`https://snowtrace.io/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on Snowtrace
                    </a>
                  </div>
                )}
                {txStage !== 'idle' && (
                  <div className="text-sm text-muted-foreground">Status: {txStage}</div>
                )}
              </div>
            )}
          </div>

          {/* FAQ Section */}
          <section className="py-12 border-t border-border" id="faq">
            <div className="container mx-auto px-4">
              <h2 className="text-2xl font-bold text-foreground mb-6">Frequently Asked Questions</h2>
              <Accordion type="single" collapsible className="w-full max-w-4xl mx-auto">
                <AccordionItem value="what-is-tiltvault" className="border-border">
                  <AccordionTrigger className="text-left hover:no-underline">
                    What is TiltVault?
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    <p>
                      TiltVault is a non-custodial decentralized finance (DeFi) protocol aggregator that provides a user interface for interacting with established, audited blockchain protocols on the Avalanche network.
                    </p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="how-leveraged-trading" className="border-border">
                  <AccordionTrigger className="text-left hover:no-underline">
                    How does leveraged trading work?
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    <p>
                      Leveraged trading allows you to open positions larger than your collateral. With 2.5x leverage, a $10 USDC deposit can control a $25 position. This amplifies both gains and losses, so use caution.
                    </p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="risks" className="border-border">
                  <AccordionTrigger className="text-left hover:no-underline">
                    What are the risks?
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    <p>
                      Leveraged trading carries significant risk. You can lose your entire collateral if the market moves against your position. Always understand the risks before trading.
                    </p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="fees" className="border-border">
                  <AccordionTrigger className="text-left hover:no-underline">
                    What fees are involved?
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    <p>
                      You'll pay gas fees for transactions on Avalanche and execution fees to GMX. Holding 100+ ERGC tokens makes transfers free on the platform.
                    </p>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="get-started" className="border-border">
                  <AccordionTrigger className="text-left hover:no-underline">
                    How do I get started?
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    <p>
                      Connect your wallet, ensure you have USDC and AVAX for gas, enter your desired collateral amount, review the position details, and confirm the trade.
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </section>

          {/* ERGC Discount Section */}
          <section className="py-12 border-t border-border">
            <div className="container mx-auto px-4">
              <div className="max-w-4xl mx-auto">
                <Card className="card-gradient border-border">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-6 h-6 text-success" />
                      </div>
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-foreground mb-2">Get ERGC on Uniswap (AVAX → ERGC)</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          <span className="font-medium">Free Transfers:</span> Holding 100+ ERGC = <span className="font-bold text-primary">Free transfers</span> on TiltVault platform
                        </p>
                        <Button 
                          variant="default" 
                          className="bg-primary hover:bg-primary/90"
                          onClick={openModal}
                        >
                          Get ERGC
                          <ExternalLink className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Live Trade</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to place a live leveraged trade on GMX:
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Collateral:</span>
                  <span className="font-medium">${usdcAmount} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span>Leverage:</span>
                  <span className="font-medium">{leverage}x</span>
                </div>
                <div className="flex justify-between">
                  <span>Position Size:</span>
                  <span className="font-medium">${(Number(usdcAmount) * leverage).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Slippage:</span>
                  <span className="font-medium">
                    {(Number(usdcAmount) * leverage) > 1000 ? '1.0%' : '0.5%'}
                  </span>
                </div>
              </div>
              <p className="mt-4 text-destructive font-medium">
                ⚠️ This is a real trade with real money. You could lose your entire collateral.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowConfirmDialog(false);
                handleExecuteLive();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Execute Trade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Footer */}
      <Footer />
    </div>
  );
}
