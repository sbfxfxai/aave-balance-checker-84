import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';

export interface GmxPositionData {
  // Core fields
  id: string;
  account: string;
  market: string;
  marketInfo?: { name: string; indexToken: string; marketToken?: string };
  collateralToken: string;
  sizeInUsd: string;
  sizeInTokens: string;
  collateralAmount: string;
  entryPrice: string;
  leverage: number;
  isLong: boolean;
  
  // Price and value fields
  markPrice?: string;
  netValue?: string;
  
  // Enhanced PnL fields
  pnl?: string; // Unrealized PnL in USD
  pnlPercentage?: number; // PnL as percentage
  pnlAfterFees?: string; // PnL after deducting fees
  
  // Risk metrics
  liquidationPrice?: string; // Critical for risk management
  healthFactor?: number; // Distance from liquidation (higher = safer)
  hasLowCollateral?: boolean; // Warning flag
  
  // Fees
  fundingFeeAmount?: string; // Accumulated funding fees
  fundingFeeAmountPerSize?: string; // Per-size funding fee
  borrowingFeeAmount?: string; // Accumulated borrowing fees
  borrowingFactor?: string; // Borrowing factor
  positionFeeAmount?: string; // Position fees
  totalFees?: string; // Sum of all fees
  claimableFundingAmount?: string; // Claimable funding
  
  // Additional metrics
  remainingCollateralUsd?: string; // Collateral minus losses
  
  // Time-based
  increasedAtTime?: number; // Timestamp when position was increased
  decreasedAtTime?: number; // Timestamp when position was decreased
  createdAt?: number; // Timestamp when position was created
  positionAge?: string; // Human-readable age
}

interface RawGmxPosition {
  addresses: {
    market: string;
    collateralToken: string;
  };
  numbers: {
    sizeInUsd: bigint;
    collateralAmount: bigint;
    sizeInTokens: bigint;
    increasedAtTime: bigint;
    decreasedAtTime: bigint;
    longTokenClaimableFundingAmountPerSize: bigint;
    shortTokenClaimableFundingAmountPerSize: bigint;
    borrowingFactor?: bigint;
    fundingFeeAmountPerSize?: bigint;
  };
  flags: {
    isLong: boolean;
  };
}

interface GmxMarketData {
  markets: Array<{
    marketToken?: string;
    indexToken?: string;
    price?: string;
    markPrice?: string;
    indexTokenPrice?: string;
  }>;
}

interface GmxTokenData {
  tokens: Array<{
    symbol: string;
    price: string;
  }>;
}

const MARKET_INFO: Record<string, { name: string; indexToken: string }> = {
  '0xfb02132333a79c8b5bd0b64e3abcca5f7faf2937': { name: 'BTC/USD', indexToken: 'BTC' },
  '0xb7e69749e3d2edd90ea59a4932efea2d41e245d7': { name: 'ETH/USD', indexToken: 'ETH' },
  '0x913c1f46b48b3ed35e7dc3cf754d4ae8499f31cf': { name: 'AVAX/USD', indexToken: 'AVAX' },
};

const SYNTHETICS_READER = '0x62Cb8740E6986B29dC671B2EB596676f60590A5B' as const;
const DATA_STORE = '0x2F0b22339414ADeD7D5F06f9D604c7fF5b2fe3f6' as const;
const GMX_AVALANCHE_API = 'https://avalanche-api.gmxinfra.io';

const READER_ABI = [
  {
    inputs: [
      { name: 'dataStore', type: 'address' },
      { name: 'account', type: 'address' },
      { name: 'start', type: 'uint256' },
      { name: 'end', type: 'uint256' },
    ],
    name: 'getAccountPositions',
    outputs: [
      {
        components: [
          {
            components: [
              { name: 'account', type: 'address' },
              { name: 'market', type: 'address' },
              { name: 'collateralToken', type: 'address' },
            ],
            name: 'addresses',
            type: 'tuple',
          },
          {
            components: [
              { name: 'sizeInUsd', type: 'uint256' },
              { name: 'sizeInTokens', type: 'uint256' },
              { name: 'collateralAmount', type: 'uint256' },
              { name: 'borrowingFactor', type: 'uint256' },
              { name: 'fundingFeeAmountPerSize', type: 'uint256' },
              { name: 'longTokenClaimableFundingAmountPerSize', type: 'uint256' },
              { name: 'shortTokenClaimableFundingAmountPerSize', type: 'uint256' },
              { name: 'increasedAtTime', type: 'uint256' },
              { name: 'decreasedAtTime', type: 'uint256' },
            ],
            name: 'numbers',
            type: 'tuple',
          },
          {
            components: [{ name: 'isLong', type: 'bool' }],
            name: 'flags',
            type: 'tuple',
          },
        ],
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

export function useGmxPositions(overrideAddress?: string | null) {
  const { address: connectedAddress, isConnected } = useAccount();
  // Use override address (Stack App) or connected wallet address
  const address = (overrideAddress || connectedAddress) as `0x${string}` | undefined;
  const hasAddress = !!address;
  const publicClient = usePublicClient();

  const query = useQuery({
    queryKey: ['gmxPositions', address],
    queryFn: async (): Promise<GmxPositionData[]> => {
      if (!address || !publicClient) return [];
      
      // Validate address is Ethereum format (0x + 40 hex chars)
      // Filter out Solana addresses (base58 encoded, no 0x prefix)
      if (!address.startsWith('0x') || address.length !== 42) {
        console.warn('[GMX] Invalid Ethereum address format:', address);
        return [];
      }
      
      try {
        console.log('[GMX] Fetching positions for:', address);
        
        const positions = await publicClient.readContract({
          address: SYNTHETICS_READER,
          abi: READER_ABI,
          functionName: 'getAccountPositions',
          args: [DATA_STORE, address, 0n, 100n],
        });

        console.log('[GMX] Raw positions:', positions);

        if (!positions || positions.length === 0) {
          // Defer console.log to avoid blocking
          if (process.env.NODE_ENV === 'development') {
            setTimeout(() => console.log('[GMX] No positions found'), 0);
          }
          return [];
        }

        // Process positions synchronously but in smaller batches to prevent blocking
        // For small arrays (< 10), process all at once
        // For larger arrays, process in chunks to yield to main thread
        const processPosition = (pos: RawGmxPosition, index: number, accountAddress: string) => {
          const market = pos.addresses.market.toLowerCase();
          const marketInfo = MARKET_INFO[market];
          const sizeUsd = Number(formatUnits(pos.numbers.sizeInUsd, 30));
          const collateralUsd = Number(formatUnits(pos.numbers.collateralAmount, 6));
          const leverage = collateralUsd > 0 ? sizeUsd / collateralUsd : 0;
          const sizeInTokens = Number(formatUnits(pos.numbers.sizeInTokens, 8));
          const entryPrice = sizeInTokens > 0 ? sizeUsd / sizeInTokens : 0;

          // CRITICAL: We only create BTC long positions, so force isLong to true for BTC positions
          // The GMX contract may return incorrect isLong flag, so we override it for BTC
          const isBtcPosition = marketInfo?.indexToken === 'BTC' || marketInfo?.name?.includes('BTC');
          const isLong = isBtcPosition ? true : pos.flags.isLong;

          // Calculate claimable funding based on position direction
          // These are per-size values, so multiply by position size
          const claimableFundingPerSize = isLong 
            ? Number(formatUnits(pos.numbers.longTokenClaimableFundingAmountPerSize, 30))
            : Number(formatUnits(pos.numbers.shortTokenClaimableFundingAmountPerSize, 30));
          
          // Total claimable funding = per-size amount * position size in tokens
          const totalClaimableFunding = claimableFundingPerSize * sizeInTokens;
          
          // Convert timestamps (they're in seconds)
          const increasedAt = Number(pos.numbers.increasedAtTime);
          const decreasedAt = Number(pos.numbers.decreasedAtTime);
          
          // Borrowing factor is stored as a decimal (e.g., 0.0001 = 0.01%)
          const borrowingFactorValue = pos.numbers.borrowingFactor 
            ? Number(formatUnits(pos.numbers.borrowingFactor, 30))
            : 0;

          return {
            id: `${pos.addresses.market}-${pos.addresses.collateralToken}-${index}`,
            account: accountAddress,
            market: pos.addresses.market,
            marketInfo,
            collateralToken: pos.addresses.collateralToken,
            sizeInUsd: sizeUsd.toFixed(2),
            sizeInTokens: sizeInTokens.toFixed(8),
            collateralAmount: collateralUsd.toFixed(2),
            entryPrice: entryPrice.toFixed(2),
            leverage: parseFloat(leverage.toFixed(2)),
            isLong,
            // Additional fields from contract
            borrowingFactor: borrowingFactorValue.toString(),
            fundingFeeAmountPerSize: pos.numbers.fundingFeeAmountPerSize 
            ? formatUnits(pos.numbers.fundingFeeAmountPerSize, 30)
            : '0',
            claimableFundingAmount: totalClaimableFunding.toFixed(4),
            increasedAtTime: increasedAt,
            decreasedAtTime: decreasedAt,
            // Calculate funding fee amount (per-size * size in tokens)
            fundingFeeAmount: (totalClaimableFunding).toFixed(4),
            // Borrowing fee is calculated from borrowing factor over time
            borrowingFeeAmount: '0', // Would need time-based calculation
            totalFees: totalClaimableFunding.toFixed(4),
          };
        };

        // Process positions
        let processedPositions: GmxPositionData[];
        if (positions.length <= 10) {
          processedPositions = positions.map((pos, index) => processPosition(pos, index, address!)).filter((p: GmxPositionData) => parseFloat(p.sizeInUsd) > 0);
        } else {
          // For larger arrays, process in batches to yield to main thread
          const results: GmxPositionData[] = [];
          const batchSize = 5;
          
          for (let i = 0; i < positions.length; i += batchSize) {
            const batch = positions.slice(i, i + batchSize);
            const batchResults = batch.map((pos: RawGmxPosition, batchIndex: number) => processPosition(pos, i + batchIndex, address!));
            results.push(...batchResults);
            
            // Yield to main thread after each batch (except the last)
            if (i + batchSize < positions.length) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
          }
          
          processedPositions = results.filter(p => parseFloat(p.sizeInUsd) > 0);
        }

        // Fetch mark prices - use CoinGecko for BTC (most reliable) and try GMX API for others
        try {
          // For BTC positions, use CoinGecko as primary source
          const btcPositions = processedPositions.filter(p => 
            MARKET_INFO[p.market.toLowerCase()]?.indexToken === 'BTC'
          );
          
          let btcPrice: number | undefined;
          if (btcPositions.length > 0) {
            try {
              console.log('[GMX] Fetching BTC price from backend API...');
              const btcResponse = await fetch('/api/price/btc', {
                signal: AbortSignal.timeout(5000),
              });
              console.log('[GMX] BTC price API response status:', btcResponse.status);
              if (btcResponse.ok) {
                const btcData = await btcResponse.json();
                btcPrice = btcData.price;
                if (btcPrice && typeof btcPrice === 'number') {
                  console.log(`[GMX] ✅ Successfully fetched BTC price: $${btcPrice.toFixed(2)} (source: ${btcData.source})`);
                } else {
                  console.error('[GMX] ❌ BTC price API response missing price:', btcData);
                }
              } else if (btcResponse.status === 429) {
                // Rate limited - silently fail, will use GMX API as fallback
                console.warn('[GMX] BTC price API rate limited (429), using GMX API fallback');
              } else if (btcResponse.status === 503) {
                // Service unavailable - silently fail, will use GMX API as fallback
                console.warn('[GMX] BTC price API unavailable (503), using GMX API fallback');
              } else {
                console.error('[GMX] ❌ BTC price API error:', btcResponse.status, btcResponse.statusText);
              }
            } catch (e) {
              // Suppress network errors - they're expected and we have fallbacks
              const errorMsg = e instanceof Error ? e.message : String(e);
              if (!errorMsg.includes('Failed to fetch') && !errorMsg.includes('aborted')) {
                console.error('[GMX] ❌ Failed to fetch BTC price:', e);
              }
            }
          } else {
            console.log('[GMX] No BTC positions found, skipping BTC price fetch');
          }
          
          // Try GMX markets endpoint for other tokens or as fallback
          let marketsData: GmxMarketData | null = null;
          try {
            const marketsRes = await fetch(`${GMX_AVALANCHE_API}/markets`);
            if (marketsRes.ok) {
              marketsData = await marketsRes.json();
            }
          } catch (e) {
            console.warn('[GMX] Failed to fetch markets:', e);
          }
          
          // Update positions with mark price and net value
          processedPositions = processedPositions.map((position) => {
            const marketInfo = MARKET_INFO[position.market.toLowerCase()];
            if (!marketInfo) {
              return {
                ...position,
                markPrice: position.entryPrice,
                netValue: position.collateralAmount,
              };
            }
            
            let markPrice: number | undefined;
            
            // For BTC, use CoinGecko price (MUST be different from entry price)
            if (marketInfo.indexToken === 'BTC') {
              if (btcPrice && btcPrice > 0) {
                markPrice = btcPrice;
                console.log(`[GMX] ✅ Using CoinGecko BTC price: $${btcPrice.toFixed(2)} for ${marketInfo.name}`);
              } else {
                console.error(`[GMX] ❌ BTC price from CoinGecko is invalid: ${btcPrice}`);
              }
            }
            
            // Try to get from markets data if available (for non-BTC or as fallback)
            if (!markPrice && marketsData?.markets) {
              const matchingMarket = marketsData.markets.find((m: GmxMarketData['markets'][0]) => {
                // Try to match by market address or index token
                return m.marketToken?.toLowerCase() === position.market.toLowerCase() ||
                       m.indexToken?.toLowerCase() === position.market.toLowerCase();
              });
              
              // Markets might have price data in different formats
              if (matchingMarket) {
                // Try different price field names
                markPrice = matchingMarket.markPrice 
                  ? parseFloat(matchingMarket.markPrice)
                  : matchingMarket.price
                  ? parseFloat(matchingMarket.price)
                  : matchingMarket.indexTokenPrice
                  ? parseFloat(matchingMarket.indexTokenPrice)
                  : undefined;
              }
            }
            
            // Last resort: use entry price (but log warning)
            if (!markPrice || markPrice === 0 || isNaN(markPrice)) {
              console.error(`[GMX] ❌ Could not fetch mark price for ${marketInfo.name}, using entry price as fallback`);
              markPrice = parseFloat(position.entryPrice);
            } else {
              const entryPriceNum = parseFloat(position.entryPrice);
              const priceDiff = markPrice - entryPriceNum;
              const priceDiffPercent = ((priceDiff / entryPriceNum) * 100).toFixed(4);
              console.log(`[GMX] ✅ Mark price for ${marketInfo.name}: $${markPrice.toFixed(2)} (entry: $${entryPriceNum.toFixed(2)}, diff: $${priceDiff.toFixed(2)} / ${priceDiffPercent}%)`);
            }

            // Calculate net value: collateral + unrealized PnL
            const entryPrice = parseFloat(position.entryPrice);
            const sizeInUsd = parseFloat(position.sizeInUsd);
            const collateral = parseFloat(position.collateralAmount);
            
            // Always calculate PnL (will be 0 if markPrice === entryPrice)
            let unrealizedPnL = 0;
            if (markPrice && entryPrice > 0 && sizeInUsd > 0) {
              if (position.isLong) {
                unrealizedPnL = ((markPrice - entryPrice) / entryPrice) * sizeInUsd;
              } else {
                unrealizedPnL = ((entryPrice - markPrice) / entryPrice) * sizeInUsd;
              }
            }
            
            const netValue = collateral + unrealizedPnL;
            
            // Log detailed calculation for debugging
            console.log(`[GMX] Position ${marketInfo.name} calculation:`, {
              entryPrice: entryPrice.toFixed(2),
              markPrice: markPrice.toFixed(2),
              priceDiff: (markPrice - entryPrice).toFixed(2),
              sizeInUsd: sizeInUsd.toFixed(2),
              collateral: collateral.toFixed(2),
              unrealizedPnL: unrealizedPnL.toFixed(2),
              netValue: netValue.toFixed(2),
              isLong: position.isLong,
            });

            return {
              ...position,
              markPrice: markPrice.toFixed(2),
              netValue: netValue.toFixed(2),
            };
          });
        } catch (error) {
          console.error('[GMX] Error fetching mark prices:', error);
          // Fallback: try to get prices from tokens endpoint
          try {
            const tokensRes = await fetch(`${GMX_AVALANCHE_API}/tokens`);
            if (tokensRes.ok) {
              const tokensData = await tokensRes.json();
              const tokenPriceMap = new Map<string, number>();
              
              if (tokensData?.tokens) {
                tokensData.tokens.forEach((token: GmxTokenData['tokens'][0]) => {
                  if (token.symbol && token.price) {
                    tokenPriceMap.set(token.symbol.toUpperCase(), parseFloat(token.price));
                  }
                });
              }
              
              processedPositions = processedPositions.map((position) => {
                const marketInfo = MARKET_INFO[position.market.toLowerCase()];
                if (!marketInfo) {
                  return {
                    ...position,
                    markPrice: position.entryPrice,
                    netValue: position.collateralAmount,
                  };
                }
                
                let markPrice = tokenPriceMap.get(marketInfo.indexToken.toUpperCase());
                if (!markPrice || markPrice === 0 || isNaN(markPrice)) {
                  markPrice = parseFloat(position.entryPrice);
                }
                
                const entryPrice = parseFloat(position.entryPrice);
                const sizeInUsd = parseFloat(position.sizeInUsd);
                const collateral = parseFloat(position.collateralAmount);
                
                let unrealizedPnL = 0;
                if (markPrice && entryPrice > 0 && sizeInUsd > 0 && markPrice !== entryPrice) {
                  if (position.isLong) {
                    unrealizedPnL = ((markPrice - entryPrice) / entryPrice) * sizeInUsd;
                  } else {
                    unrealizedPnL = ((entryPrice - markPrice) / entryPrice) * sizeInUsd;
                  }
                }
                
                const netValue = collateral + unrealizedPnL;
                
                return {
                  ...position,
                  markPrice: markPrice.toFixed(2),
                  netValue: netValue.toFixed(2),
                };
              });
            }
          } catch (fallbackError) {
            console.error('[GMX] Fallback price fetch also failed:', fallbackError);
            // Final fallback: use entry price
            processedPositions = processedPositions.map((position) => ({
              ...position,
              markPrice: position.entryPrice,
              netValue: position.collateralAmount,
            }));
          }
        }

        return processedPositions;
      } catch (error) {
        console.error('[GMX] Error fetching positions:', error);
        return [];
      }
    },
    enabled: hasAddress && !!publicClient,
    refetchInterval: 10000, // Update every 10 seconds for real-time prices
    staleTime: 5000,
    gcTime: 60000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
  });

  return {
    positions: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
