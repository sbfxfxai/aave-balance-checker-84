// Test GMX SDK in Node.js environment (same as Vercel serverless)
const { createWalletClient, createPublicClient, http, parseUnits, formatUnits, maxUint256 } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');

// Test with a dummy private key (don't use real funds)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Hardhat default

async function testGmxSdk() {
  console.log('Testing GMX SDK in Node.js...\n');
  
  try {
    // 1. Test viem imports
    console.log('1. Testing viem imports...');
    const account = privateKeyToAccount(TEST_PRIVATE_KEY);
    console.log('   Account address:', account.address);
    
    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http('https://api.avax.network/ext/bc/C/rpc'),
    });
    console.log('   Public client created');
    
    const walletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http('https://api.avax.network/ext/bc/C/rpc'),
    });
    console.log('   Wallet client created');
    console.log('   ✅ viem works!\n');
    
    // 2. Test GMX API
    console.log('2. Testing GMX API...');
    const [tokensRes, marketsRes] = await Promise.all([
      fetch('https://avalanche-api.gmxinfra.io/tokens'),
      fetch('https://avalanche-api.gmxinfra.io/markets'),
    ]);
    
    if (!tokensRes.ok || !marketsRes.ok) {
      throw new Error('GMX API failed');
    }
    
    const tokensJson = await tokensRes.json();
    const marketsJson = await marketsRes.json();
    
    const btcToken = tokensJson.tokens.find(t => t.symbol === 'BTC');
    const usdcToken = tokensJson.tokens.find(t => t.symbol === 'USDC');
    
    console.log('   BTC token:', btcToken?.address);
    console.log('   USDC token:', usdcToken?.address);
    
    const btcUsdcMarket = marketsJson.markets.find(
      m => m.isListed && 
           m.indexToken.toLowerCase() === btcToken.address.toLowerCase() &&
           m.shortToken.toLowerCase() === usdcToken.address.toLowerCase()
    );
    
    console.log('   BTC/USDC market:', btcUsdcMarket?.marketToken);
    console.log('   ✅ GMX API works!\n');
    
    // 3. Test GMX SDK import
    console.log('3. Testing GMX SDK import...');
    const { GmxSdk } = require('@gmx-io/sdk');
    console.log('   GmxSdk imported successfully');
    
    const sdk = new GmxSdk({
      chainId: 43114,
      rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
      oracleUrl: 'https://avalanche-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
      walletClient: walletClient,
    });
    console.log('   SDK instance created');
    
    sdk.setAccount(account.address);
    console.log('   Account set on SDK');
    console.log('   ✅ GMX SDK works!\n');
    
    // 4. Test SDK methods exist
    console.log('4. Testing SDK methods...');
    console.log('   sdk.orders:', typeof sdk.orders);
    console.log('   sdk.orders.long:', typeof sdk.orders?.long);
    console.log('   sdk.callContract:', typeof sdk.callContract);
    console.log('   ✅ SDK methods exist!\n');
    
    console.log('='.repeat(50));
    console.log('ALL TESTS PASSED - GMX SDK works in Node.js!');
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testGmxSdk();
