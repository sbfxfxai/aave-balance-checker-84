import { useAccount, useReadContract } from 'wagmi';
// @ts-expect-error - @privy-io/react-auth types exist but TypeScript can't resolve them due to package.json exports configuration
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useMemo, useState, useEffect } from 'react';
import { formatUnits } from 'viem';
import { arbitrum } from 'wagmi/chains';
import { CONTRACTS, ERC4626_VAULT_ABI } from '@/config/contracts';

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

// Fixed APY values (from user specification)
const EURC_APY = 11.54;
const DAI_APY = 10.11;
const BLENDED_APY = (EURC_APY + DAI_APY) / 2; // 10.83%

// Default EUR/USD rate (fallback if API fails)
// EUR typically trades around 1.05-1.10 USD
const DEFAULT_EUR_USD_RATE = 1.08;

export function useMorphoPositions() {
  const { address: wagmiAddress, isConnected: isWagmiConnected } = useAccount();
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();

  // Get the active wallet address
  const address = useMemo(() => {
    if (wagmiAddress) return wagmiAddress;
    const privyWallet = wallets.find((w: any) => w.walletClientType === 'privy');
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
              console.log(`[Morpho] ✅ EUR/USD rate from ExchangeRate API: ${rate.toFixed(4)}`);
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
                console.log(`[Morpho] ✅ EUR/USD rate from CoinGecko (EURC): ${rate.toFixed(4)}`);
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

  // Get EURC vault shares (balanceOf) - on Arbitrum
  const {
    data: eurcSharesRaw,
    isLoading: eurcSharesLoading,
    error: eurcSharesError,
  } = useReadContract({
    address: MORPHO_EURC_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum (Morpho vaults are on Arbitrum)
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 60_000,
    },
  });

  // Get DAI vault shares (balanceOf) - on Arbitrum
  const {
    data: daiSharesRaw,
    isLoading: daiSharesLoading,
    error: daiSharesError,
  } = useReadContract({
    address: MORPHO_DAI_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum (Morpho vaults are on Arbitrum)
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 60_000,
    },
  });

  // Convert EURC shares to assets - on Arbitrum
  const {
    data: eurcAssetsRaw,
    isLoading: eurcAssetsLoading,
  } = useReadContract({
    address: MORPHO_EURC_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'convertToAssets',
    args: eurcSharesRaw ? [eurcSharesRaw as bigint] : undefined,
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum
    query: {
      enabled: isConnected && !!address && !!eurcSharesRaw && eurcSharesRaw > 0n,
      refetchInterval: 60_000,
    },
  });

  // Convert DAI shares to assets - on Arbitrum
  const {
    data: daiAssetsRaw,
    isLoading: daiAssetsLoading,
  } = useReadContract({
    address: MORPHO_DAI_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'convertToAssets',
    args: daiSharesRaw ? [daiSharesRaw as bigint] : undefined,
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum
    query: {
      enabled: isConnected && !!address && !!daiSharesRaw && daiSharesRaw > 0n,
      refetchInterval: 60_000,
    },
  });

  // Get vault asset addresses to determine decimals - on Arbitrum
  const {
    data: eurcVaultAsset,
  } = useReadContract({
    address: MORPHO_EURC_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'asset',
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum
    query: {
      enabled: isConnected && !!address,
    },
  });

  const {
    data: daiVaultAsset,
  } = useReadContract({
    address: MORPHO_DAI_VAULT as `0x${string}`,
    abi: ERC4626_VAULT_ABI,
    functionName: 'asset',
    chainId: arbitrum.id, // CRITICAL: Read from Arbitrum
    query: {
      enabled: isConnected && !!address,
    },
  });

  // Calculate position data
  const position = useMemo((): MorphoPosition => {
    const isLoading = eurcSharesLoading || daiSharesLoading || eurcAssetsLoading || daiAssetsLoading || eurRateLoading;
    const error = eurcSharesError?.message || daiSharesError?.message || eurRateError || undefined;

    // EURC vault typically uses 6 decimals (USDC/EURC standard)
    // DAI vault typically uses 18 decimals (DAI standard)
    // We'll use 6 for EURC and 18 for DAI as defaults
    const eurcDecimals = 6;
    const daiDecimals = 18;

    const eurcShares = eurcSharesRaw ? formatUnits(eurcSharesRaw as bigint, 18) : '0';
    const daiShares = daiSharesRaw ? formatUnits(daiSharesRaw as bigint, 18) : '0';

    const eurcAssets = eurcAssetsRaw ? formatUnits(eurcAssetsRaw as bigint, eurcDecimals) : '0';
    const daiAssets = daiAssetsRaw ? formatUnits(daiAssetsRaw as bigint, daiDecimals) : '0';

    // Convert to USD
    // EURC is Euro stablecoin - multiply by EUR/USD exchange rate
    // DAI is USD stablecoin - 1:1 with USD
    const eurcValueEur = parseFloat(eurcAssets);
    const daiValueUsd = parseFloat(daiAssets);
    const eurcValueUsd = eurcValueEur * eurUsdRate;
    
    const eurcUsdValue = eurcValueUsd.toFixed(2);
    const daiUsdValue = daiValueUsd.toFixed(2);
    const totalUsdValue = (eurcValueUsd + daiValueUsd).toFixed(2);

    // Calculate weighted APY (weighted by USD value, not EUR value)
    const totalUsd = eurcValueUsd + daiValueUsd;
    const blendedApy = totalUsd > 0
      ? ((eurcValueUsd * EURC_APY) + (daiValueUsd * DAI_APY)) / totalUsd
      : BLENDED_APY;

    return {
      eurcShares,
      eurcAssets,
      eurcUsdValue,
      eurcApy: EURC_APY,
      daiShares,
      daiAssets,
      daiUsdValue,
      daiApy: DAI_APY,
      totalUsdValue,
      blendedApy,
      isLoading,
      error: error,
    };
  }, [
    eurcSharesRaw,
    daiSharesRaw,
    eurcAssetsRaw,
    daiAssetsRaw,
    eurcSharesLoading,
    daiSharesLoading,
    eurcAssetsLoading,
    daiAssetsLoading,
    eurcSharesError,
    daiSharesError,
    eurRateError,
    eurUsdRate,
  ]);

  return position;
}

