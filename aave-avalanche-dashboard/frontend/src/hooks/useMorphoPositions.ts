import { useAccount, useReadContract } from 'wagmi';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useMemo, useState, useEffect } from 'react';
import { formatUnits } from 'viem';
import { arbitrum } from 'wagmi/chains';
import { CONTRACTS, ERC4626_VAULT_ABI } from '@/config/contracts';
import { useMorphoRates } from './useMorphoRates';

type PrivyWallet = {
  address?: `0x${string}` | string | null;
  walletClientType?: string;
  chainId?: number;
};

export interface MorphoPosition {
  eurcShares: string;
  eurcAssets: string;
  eurcUsdValue: string;
  eurcApy: number;
  daiShares: string;
  daiAssets: string;
  daiUsdValue: string;
  daiApy: number;
  totalUsdValue: string;
  blendedApy: number;
  isLoading: boolean;
  error?: string;
}

// Morpho Vault addresses on Arbitrum (ERC-4626)
// Reference: Morpho V2 Contracts on Arbitrum
// - VaultV2Factory: 0x6b46fa3cc9EBF8aB230aBAc664E37F2966Bf7971
// - MorphoRegistry: 0xc00eb3c7aD1aE986A7f05F5A9d71aCa39c763C65
// - MORPHO Token: 0x40BD670A58238e6E230c430BBb5cE6ec0d40df48 (18 decimals)
const MORPHO_GAUNTLET_USDC_VAULT = '0x7e97fa6893871A2751B5fE961978DCCb2c201E65' as const; // Morpho GauntletUSDC Core Vault on Arbitrum - VERIFIED
const MORPHO_HYPERITHM_USDC_VAULT = '0x4B6F1C9E5d470b97181786b26da0d0945A7cf027' as const; // Morpho HyperithmUSDC Vault on Arbitrum - VERIFIED

// Fallback APY values (only used if API fails)
const FALLBACK_GAUNTLET_APY = 5.73;
const FALLBACK_HYPERITHM_APY = 6.42;
const FALLBACK_BLENDED_APY = (FALLBACK_GAUNTLET_APY + FALLBACK_HYPERITHM_APY) / 2;

// Default EUR/USD rate (fallback if API fails)
// EUR typically trades around 1.05-1.10 USD
const DEFAULT_EUR_USD_RATE = 1.08;

export function useMorphoPositions() {
  // Get live APY rates from Morpho API
  const { gauntletAPY, hyperithmAPY, combinedAPY: liveBlendedAPY } = useMorphoRates();
  
  // Use live rates, fallback to defaults if API fails
  const GAUNTLET_USDC_CORE_APY = gauntletAPY || FALLBACK_GAUNTLET_APY;
  const HYPERITHM_USDC_APY = hyperithmAPY || FALLBACK_HYPERITHM_APY;
  const BLENDED_APY = liveBlendedAPY || FALLBACK_BLENDED_APY;
  
  // Legacy names for compatibility (mapped to new names)
  const EURC_APY = GAUNTLET_USDC_CORE_APY;
  const DAI_APY = HYPERITHM_USDC_APY;
  const { address: wagmiAddress, isConnected: isWagmiConnected } = useAccount();
  const { authenticated } = usePrivy();
  const { wallets } = useWallets() as unknown as { wallets: PrivyWallet[] };

  // Get the active wallet address
  const address = useMemo(() => {
    if (wagmiAddress) return wagmiAddress;
    const privyWallet = wallets.find((w: PrivyWallet) => w.walletClientType === 'privy');
    return privyWallet?.address || null;
  }, [wagmiAddress, wallets]);

  const isConnected = isWagmiConnected || (authenticated && !!address);

  // Fetch EUR/USD exchange rate (EURC is Euro stablecoin, not 1:1 USD)
  const [eurUsdRate, setEurUsdRate] = useState<number>(DEFAULT_EUR_USD_RATE);
  const [eurRateLoading, setEurRateLoading] = useState(false);
  const [eurRateError, setEurRateError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEurRate = async () => {
      setEurRateLoading(true);
      setEurRateError(null);
      try {
        // Try multiple sources for EUR/USD rate
        const apiKey = import.meta.env.VITE_COINGECKO_API_KEY || 'CG-SrpkXrpSyKeYv9KwyCuMZ62g';
        
        let rate: number | undefined;
        
        // First try: Direct EUR/USD exchange rate API (most reliable, no API key needed)
        try {
          const exchangeResponse = await fetch(
            'https://api.exchangerate-api.com/v4/latest/EUR',
            { signal: AbortSignal.timeout(5000) }
          );
          
          if (exchangeResponse.ok) {
            const exchangeData = await exchangeResponse.json();
            console.log('[Morpho] ExchangeRate API response:', exchangeData);
            
            if (exchangeData.rates?.USD && typeof exchangeData.rates.USD === 'number') {
              rate = exchangeData.rates.USD;
              console.log(`[Morpho] ✅ EUR/USD rate from ExchangeRate API: ${rate!.toFixed(4)}`);
            }
          }
        } catch (exchangeError) {
          console.warn('[Morpho] ExchangeRate API failed, trying CoinGecko:', exchangeError);
        }
        
        // Fallback: EURC token (Circle Euro Coin) via CoinGecko
        if (!rate || typeof rate !== 'number' || isNaN(rate) || rate <= 0) {
          try {
            // Try with API key in header (more reliable than query param)
            const eurcResponse = await fetch(
              'https://api.coingecko.com/api/v3/simple/price?ids=eurc&vs_currencies=usd',
              { 
                signal: AbortSignal.timeout(5000),
                headers: {
                  'x-cg-demo-api-key': apiKey
                }
              }
            );
            
            if (eurcResponse.ok) {
              const eurcData = await eurcResponse.json();
              console.log('[Morpho] CoinGecko EURC response:', eurcData);
              
              if (eurcData.eurc?.usd && typeof eurcData.eurc.usd === 'number') {
                rate = eurcData.eurc.usd;
                console.log(`[Morpho] ✅ EUR/USD rate from CoinGecko (EURC): ${rate!.toFixed(4)}`);
              }
            } else {
              console.warn(`[Morpho] CoinGecko API returned status ${eurcResponse.status}`);
            }
          } catch (eurcError) {
            console.warn('[Morpho] CoinGecko EURC fetch failed:', eurcError);
          }
        }

        if (!rate || typeof rate !== 'number' || isNaN(rate) || rate <= 0) {
          console.error('[Morpho] All EUR/USD rate sources failed, using default 1.08');
          throw new Error('All EUR/USD rate sources failed');
        }

        setEurUsdRate(rate);
        console.log(`[Morpho] EUR/USD rate (from EURC): ${rate.toFixed(4)}`);
      } catch (error) {
        console.error('[Morpho] Failed to fetch EUR/USD rate, using default:', error);
        setEurRateError(error instanceof Error ? error.message : 'Failed to fetch EUR rate');
        // Keep default rate on error (1.08)
      } finally {
        setEurRateLoading(false);
      }
    };

    // Fetch on mount and refresh every 5 minutes (exchange rates change slowly)
    fetchEurRate();
    const interval = setInterval(fetchEurRate, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // Get GauntletUSDC Core vault shares (balanceOf) - on Arbitrum
  const {
    data: gauntletSharesRaw,
    isLoading: gauntletSharesLoading,
    error: gauntletSharesError,
  } = useReadContract({
    address: MORPHO_GAUNTLET_USDC_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum (Morpho vaults are on Arbitrum)
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 60_000,
    },
  });

  // Get HyperithmUSDC vault shares (balanceOf) - on Arbitrum
  const {
    data: hyperithmSharesRaw,
    isLoading: hyperithmSharesLoading,
    error: hyperithmSharesError,
  } = useReadContract({
    address: MORPHO_HYPERITHM_USDC_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum (Morpho vaults are on Arbitrum)
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 60_000,
    },
  });

  // Convert GauntletUSDC shares to assets - on Arbitrum
  const {
    data: gauntletAssetsRaw,
    isLoading: gauntletAssetsLoading,
  } = useReadContract({
    address: MORPHO_GAUNTLET_USDC_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'convertToAssets',
    args: gauntletSharesRaw ? [gauntletSharesRaw as bigint] : undefined,
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum
    query: {
      enabled: isConnected && !!address && !!gauntletSharesRaw && gauntletSharesRaw > 0n,
      refetchInterval: 60_000,
    },
  });

  // Convert HyperithmUSDC shares to assets - on Arbitrum
  const {
    data: hyperithmAssetsRaw,
    isLoading: hyperithmAssetsLoading,
  } = useReadContract({
    address: MORPHO_HYPERITHM_USDC_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'convertToAssets',
    args: hyperithmSharesRaw ? [hyperithmSharesRaw as bigint] : undefined,
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum
    query: {
      enabled: isConnected && !!address && !!hyperithmSharesRaw && hyperithmSharesRaw > 0n,
      refetchInterval: 60_000,
    },
  });

  // Get vault asset addresses to determine decimals - on Arbitrum
  const {
    data: gauntletVaultAsset,
  } = useReadContract({
    address: MORPHO_GAUNTLET_USDC_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'asset',
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum
    query: {
      enabled: isConnected && !!address,
    },
  });

  const {
    data: hyperithmVaultAsset,
  } = useReadContract({
    address: MORPHO_HYPERITHM_USDC_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'asset',
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Calculate position data
  const position = useMemo((): MorphoPosition => {
    const isLoading = gauntletSharesLoading || hyperithmSharesLoading || gauntletAssetsLoading || hyperithmAssetsLoading;
    const error = gauntletSharesError?.message || hyperithmSharesError?.message || undefined;

    // Both vaults use USDC (6 decimals) as underlying asset
    const usdcDecimals = 6;

    const gauntletShares = gauntletSharesRaw ? formatUnits(gauntletSharesRaw as bigint, 18) : '0';
    const hyperithmShares = hyperithmSharesRaw ? formatUnits(hyperithmSharesRaw as bigint, 18) : '0';

    const gauntletAssets = gauntletAssetsRaw ? formatUnits(gauntletAssetsRaw as bigint, usdcDecimals) : '0';
    const hyperithmAssets = hyperithmAssetsRaw ? formatUnits(hyperithmAssetsRaw as bigint, usdcDecimals) : '0';

    // Both vaults use USDC, so 1:1 with USD
    const gauntletValueUsd = parseFloat(gauntletAssets);
    const hyperithmValueUsd = parseFloat(hyperithmAssets);
    
    const gauntletUsdValue = gauntletValueUsd.toFixed(2);
    const hyperithmUsdValue = hyperithmValueUsd.toFixed(2);
    const totalUsdValue = (gauntletValueUsd + hyperithmValueUsd).toFixed(2);

    // Calculate weighted APY (weighted by USD value)
    const totalUsd = gauntletValueUsd + hyperithmValueUsd;
    const blendedApy = totalUsd > 0
      ? ((gauntletValueUsd * EURC_APY) + (hyperithmValueUsd * DAI_APY)) / totalUsd
      : BLENDED_APY;

    return {
      eurcShares: gauntletShares, // Keep interface names for compatibility
      eurcAssets: gauntletAssets,
      eurcUsdValue: gauntletUsdValue,
      eurcApy: EURC_APY,
      daiShares: hyperithmShares, // Keep interface names for compatibility
      daiAssets: hyperithmAssets,
      daiUsdValue: hyperithmUsdValue,
      daiApy: DAI_APY,
      totalUsdValue,
      blendedApy,
      isLoading,
      error: error,
    };
  }, [
    gauntletSharesRaw,
    hyperithmSharesRaw,
    gauntletAssetsRaw,
    hyperithmAssetsRaw,
    gauntletSharesLoading,
    hyperithmSharesLoading,
    gauntletAssetsLoading,
    hyperithmAssetsLoading,
    gauntletSharesError,
    hyperithmSharesError,
    BLENDED_APY,
    DAI_APY,
    EURC_APY,
  ]);

  return position;
}

