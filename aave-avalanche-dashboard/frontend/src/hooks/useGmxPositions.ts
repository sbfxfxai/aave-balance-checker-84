import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';

export interface GmxPositionData {
  id: string;
  account: string;
  market: string;
  marketInfo?: { name: string; indexToken: string };
  collateralToken: string;
  sizeInUsd: string;
  sizeInTokens: string;
  collateralAmount: string;
  entryPrice: string;
  leverage: number;
  isLong: boolean;
}

const MARKET_INFO: Record<string, { name: string; indexToken: string }> = {
  '0xfb02132333a79c8b5bd0b64e3abcca5f7faf2937': { name: 'BTC/USD', indexToken: 'BTC' },
  '0xb7e69749e3d2edd90ea59a4932efea2d41e245d7': { name: 'ETH/USD', indexToken: 'ETH' },
  '0x913c1f46b48b3ed35e7dc3cf754d4ae8499f31cf': { name: 'AVAX/USD', indexToken: 'AVAX' },
};

const SYNTHETICS_READER = '0x62Cb8740E6986B29dC671B2EB596676f60590A5B' as const;
const DATA_STORE = '0x2F0b22339414ADeD7D5F06f9D604c7fF5b2fe3f6' as const;

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
          console.log('[GMX] No positions found');
          return [];
        }

        return positions.map((pos, index) => {
          const market = pos.addresses.market.toLowerCase();
          const marketInfo = MARKET_INFO[market];
          const sizeUsd = Number(formatUnits(pos.numbers.sizeInUsd, 30));
          const collateralUsd = Number(formatUnits(pos.numbers.collateralAmount, 6));
          const leverage = collateralUsd > 0 ? sizeUsd / collateralUsd : 0;
          const sizeInTokens = Number(formatUnits(pos.numbers.sizeInTokens, 8));
          const entryPrice = sizeInTokens > 0 ? sizeUsd / sizeInTokens : 0;

          return {
            id: `${pos.addresses.market}-${pos.addresses.collateralToken}-${index}`,
            account: pos.addresses.account,
            market: pos.addresses.market,
            marketInfo,
            collateralToken: pos.addresses.collateralToken,
            sizeInUsd: sizeUsd.toFixed(2),
            sizeInTokens: sizeInTokens.toFixed(8),
            collateralAmount: collateralUsd.toFixed(2),
            entryPrice: entryPrice.toFixed(2),
            leverage: parseFloat(leverage.toFixed(2)),
            isLong: pos.flags.isLong,
          };
        }).filter(p => parseFloat(p.sizeInUsd) > 0);
      } catch (error) {
        console.error('[GMX] Error fetching positions:', error);
        return [];
      }
    },
    enabled: hasAddress && !!publicClient,
    refetchInterval: 30000,
    staleTime: 25000,
    gcTime: 60000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  return {
    positions: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
