/**
 * Verification script to check if GMX position was created for user wallet
 * 
 * User wallet: 0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67 (ending 67)
 * Hub wallet: 0x34c11928868d14bdD7Be55A0D9f9e02257240c24
 * 
 * Transaction hash: 0x4d5fdc81317dfb75aaf8f457e9a6571409d95d2926d5edeea63344957e8292e7
 */

import { createPublicClient, http, formatUnits } from 'viem';
import { avalanche } from 'viem/chains';

const USER_WALLET = '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67' as const;
const HUB_WALLET = '0x34c11928868d14bdD7Be55A0D9f9e02257240c24' as const;
const USDC_TRANSFER_TX = '0x4d5fdc81317dfb75aaf8f457e9a6571409d95d2926d5edeea63344957e8292e7' as const;

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

const MARKET_INFO: Record<string, { name: string; indexToken: string }> = {
  '0xfb02132333a79c8b5bd0b64e3abcca5f7faf2937': { name: 'BTC/USD', indexToken: 'BTC' },
  '0xb7e69749e3d2edd90ea59a4932efea2d41e245d7': { name: 'ETH/USD', indexToken: 'ETH' },
  '0x913c1f46b48b3ed35e7dc3cf754d4ae8499f31cf': { name: 'AVAX/USD', indexToken: 'AVAX' },
};

async function verifyGmxPosition() {
  console.log('🔍 Verifying GMX Position Creation\n');
  console.log(`User Wallet: ${USER_WALLET}`);
  console.log(`Hub Wallet: ${HUB_WALLET}`);
  console.log(`USDC Transfer TX: ${USDC_TRANSFER_TX}\n`);

  const publicClient = createPublicClient({
    chain: avalanche,
    transport: http('https://avalanche.public-rpc.com'),
  });

  // 1. Check USDC transfer transaction
  console.log('📊 Step 1: Analyzing USDC Transfer Transaction');
  console.log(`   Transaction: https://snowtrace.io/tx/${USDC_TRANSFER_TX}`);
  
  try {
    const tx = await publicClient.getTransaction({ hash: USDC_TRANSFER_TX });
    console.log(`   From: ${tx.from}`);
    console.log(`   To: ${tx.to}`);
    console.log(`   Value: ${formatUnits(tx.value, 18)} AVAX`);
    
    if (tx.from.toLowerCase() === USER_WALLET.toLowerCase() && tx.to?.toLowerCase() === HUB_WALLET.toLowerCase()) {
      console.log('   ⚠️  WARNING: USDC transfer is FROM user TO hub (backwards!)');
      console.log('   ⚠️  For GMX strategies, we should NOT transfer USDC at all');
      console.log('   ⚠️  Hub wallet should execute GMX directly using its own USDC\n');
    } else if (tx.from.toLowerCase() === HUB_WALLET.toLowerCase() && tx.to?.toLowerCase() === USER_WALLET.toLowerCase()) {
      console.log('   ✅ USDC transfer is FROM hub TO user (correct direction)');
      console.log('   ⚠️  But for GMX strategies, we should NOT transfer USDC at all\n');
    } else {
      console.log('   ⚠️  Unexpected transaction direction\n');
    }
  } catch (error) {
    console.error('   ❌ Error fetching transaction:', error);
  }

  // 2. Check if user wallet has GMX positions
  console.log('📊 Step 2: Checking GMX Positions for User Wallet');
  try {
    const positions = await publicClient.readContract({
      address: SYNTHETICS_READER,
      abi: READER_ABI,
      functionName: 'getAccountPositions',
      args: [DATA_STORE, USER_WALLET, 0n, 100n],
    });

    if (!positions || positions.length === 0) {
      console.log('   ❌ No GMX positions found for user wallet');
      console.log('   ❌ GMX position was NOT created!\n');
    } else {
      console.log(`   ✅ Found ${positions.length} GMX position(s) for user wallet\n`);
      
      positions.forEach((pos, index) => {
        const market = pos.addresses.market.toLowerCase();
        const marketInfo = MARKET_INFO[market];
        const sizeUsd = Number(formatUnits(pos.numbers.sizeInUsd, 30));
        const collateralUsd = Number(formatUnits(pos.numbers.collateralAmount, 6));
        const leverage = collateralUsd > 0 ? sizeUsd / collateralUsd : 0;
        const sizeInTokens = Number(formatUnits(pos.numbers.sizeInTokens, 8));
        const entryPrice = sizeInTokens > 0 ? sizeUsd / sizeInTokens : 0;
        const isLong = pos.flags.isLong;

        console.log(`   Position ${index + 1}:`);
        console.log(`     Market: ${marketInfo?.name || 'Unknown'} (${market})`);
        console.log(`     Direction: ${isLong ? 'LONG' : 'SHORT'}`);
        console.log(`     Size: $${sizeUsd.toFixed(2)}`);
        console.log(`     Collateral: $${collateralUsd.toFixed(2)}`);
        console.log(`     Leverage: ${leverage.toFixed(2)}x`);
        console.log(`     Entry Price: $${entryPrice.toFixed(2)}`);
        console.log(`     Account: ${pos.addresses.account}`);
        console.log('');
      });
    }
  } catch (error) {
    console.error('   ❌ Error fetching positions:', error);
  }

  // 3. Check hub wallet positions (should be empty if position is in user wallet)
  console.log('📊 Step 3: Checking GMX Positions for Hub Wallet');
  try {
    const hubPositions = await publicClient.readContract({
      address: SYNTHETICS_READER,
      abi: READER_ABI,
      functionName: 'getAccountPositions',
      args: [DATA_STORE, HUB_WALLET, 0n, 100n],
    });

    if (!hubPositions || hubPositions.length === 0) {
      console.log('   ✅ Hub wallet has no GMX positions (correct - positions should be in user wallet)');
    } else {
      console.log(`   ⚠️  Hub wallet has ${hubPositions.length} GMX position(s)`);
      console.log('   ⚠️  This suggests positions are being created in hub wallet instead of user wallet!');
    }
  } catch (error) {
    console.error('   ❌ Error fetching hub positions:', error);
  }

  // 4. Check transaction receipt for GMX position creation
  console.log('\n📊 Step 4: Checking for GMX Position Creation Transaction');
  console.log('   Looking for transactions from hub wallet that created positions...');
  console.log('   (This requires checking recent transactions from hub wallet)');
  console.log('   Check: https://snowtrace.io/address/' + HUB_WALLET);
}

// Run verification
verifyGmxPosition().catch(console.error);

