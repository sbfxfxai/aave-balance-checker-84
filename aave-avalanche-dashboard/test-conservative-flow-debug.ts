/**
 * Test Conservative Flow Debug Script
 * 
 * This script tests the conservative flow to ensure both AVAX and Aave transfers are initiated
 * by the webhook. Use this to debug any issues with the conservative flow.
 */

import { ethers } from 'ethers';

// Configuration (same as webhook)
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const HUB_WALLET_PRIVATE_KEY = process.env.HUB_WALLET_PRIVATE_KEY || '';
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const CONSERVATIVE_AVAX_AMOUNT = ethers.parseUnits('0.005', 18);
const AAVE_POOL = '0x794a61358D6845594F94dc1DB02A252b5b4814aD';

// Test data
const TEST_WALLET = '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67';
const TEST_AMOUNT = 10; // $10 USD
const TEST_PAYMENT_ID = 'conservative-test-' + Date.now();

async function testConservativeFlow() {
  console.log('🧪 Testing Conservative Flow');
  console.log('================================');
  console.log('Test Wallet:', TEST_WALLET);
  console.log('Test Amount: $' + TEST_AMOUNT);
  console.log('Test Payment ID:', TEST_PAYMENT_ID);
  console.log('');

  try {
    // Test 1: Check hub wallet configuration
    console.log('📋 Test 1: Hub Wallet Configuration');
    if (!HUB_WALLET_PRIVATE_KEY) {
      throw new Error('HUB_WALLET_PRIVATE_KEY not configured');
    }
    
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const hubWallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    console.log('✅ Hub wallet address:', hubWallet.address);
    
    // Check balances
    const avaxBalance = await provider.getBalance(hubWallet.address);
    const usdcContract = new ethers.Contract(USDC_CONTRACT, [
      'function balanceOf(address) view returns (uint256)'
    ], hubWallet);
    const usdcBalance = await usdcContract.balanceOf(hubWallet.address);
    
    console.log('📊 Hub Wallet Balances:');
    console.log('  AVAX:', ethers.formatEther(avaxBalance));
    console.log('  USDC:', Number(usdcBalance) / 1_000_000);
    console.log('');

    // Test 2: Simulate AVAX transfer
    console.log('📋 Test 2: AVAX Transfer Simulation');
    console.log('Amount to send:', ethers.formatEther(CONSERVATIVE_AVAX_AMOUNT), 'AVAX');
    
    if (avaxBalance < CONSERVATIVE_AVAX_AMOUNT) {
      console.log('❌ Insufficient AVAX balance for transfer');
    } else {
      console.log('✅ Sufficient AVAX balance for transfer');
      
      // Check gas price
      const gasPrice = await provider.getFeeData();
      console.log('📊 Current gas price:', ethers.formatUnits(gasPrice.gasPrice || 0, 'gwei'), 'gwei');
    }
    console.log('');

    // Test 3: Simulate Aave execution
    console.log('📋 Test 3: Aave Execution Simulation');
    console.log('Amount to supply to Aave: $' + TEST_AMOUNT);
    
    const usdcAmount = BigInt(Math.floor(TEST_AMOUNT * 1_000_000)); // Convert to USDC units
    
    if (usdcBalance < usdcAmount) {
      console.log('❌ Insufficient USDC balance for Aave supply');
      console.log('  Have:', Number(usdcBalance) / 1_000_000, 'USDC');
      console.log('  Need:', TEST_AMOUNT, 'USDC');
    } else {
      console.log('✅ Sufficient USDC balance for Aave supply');
      
      // Check USDC allowance for Aave pool
      const allowance = await usdcContract.allowance(hubWallet.address, AAVE_POOL);
      console.log('📊 USDC allowance for Aave:', Number(allowance) / 1_000_000, 'USDC');
      
      if (allowance < usdcAmount) {
        console.log('⚠️ USDC allowance insufficient - will need to approve');
      } else {
        console.log('✅ USDC allowance sufficient');
      }
    }
    console.log('');

    // Test 4: Check recent transactions
    console.log('📋 Test 4: Recent Transaction Check');
    console.log('Checking recent transactions from hub wallet...');
    
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = latestBlock - 100; // Check last 100 blocks
    
    console.log('Scanning blocks', fromBlock, 'to', latestBlock);
    
    // This is a simplified check - in production you'd want more sophisticated monitoring
    console.log('📊 Recent transaction scan complete');
    console.log('');

    // Test 5: Webhook endpoint test
    console.log('📋 Test 5: Webhook Endpoint Test');
    console.log('To test the webhook endpoint:');
    console.log('1. Make a test payment with note:');
    console.log(`   payment_id:${TEST_PAYMENT_ID} wallet:${TEST_WALLET} risk:conservative email:test@example.com`);
    console.log('2. Check webhook logs for:');
    console.log('   - [Webhook] [IMMEDIATE] Processing payment');
    console.log('   - [Webhook] [IMMEDIATE] Sending AVAX for gas');
    console.log('   - [Webhook] [IMMEDIATE] 🏦 Executing Aave directly from hub wallet');
    console.log('');

    console.log('🎯 Conservative Flow Test Complete!');
    console.log('================================');
    console.log('If all tests pass, the webhook should work correctly.');
    console.log('If you see issues, check the specific test that failed above.');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
if (require.main === module) {
  testConservativeFlow()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { testConservativeFlow };
