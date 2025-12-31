#!/usr/bin/env node

/**
 * Test script to verify aggressive strategy execution
 * This simulates a Square webhook for a $5 aggressive deposit
 */

const AVALANCHE_RPC = 'https://api.avax.network/ext/bc/C/rpc';
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6BC66dd1c8EEce';
const ERGC_CONTRACT = '0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B';
const HUB_WALLET_ADDRESS = '0xYourHubWalletAddress'; // Replace with actual

// Test payment data for aggressive strategy
const testPayment = {
  // Square payment data
  id: 'test_aggressive_001',
  amount_money: {
    amount: 525, // $5.25 (includes 5% fee)
    currency: 'USD'
  },
  
  // Payment note with aggressive strategy
  note: 'payment_id:test_001 wallet:0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67 risk:aggressive email:test@example.com',
  
  // Status
  status: 'COMPLETED'
};

async function testAggressiveStrategy() {
  console.log('🧪 Testing Aggressive Strategy Execution');
  console.log('=====================================');
  
  // 1. Verify aggressive allocation
  console.log('\n📊 Strategy Allocation:');
  console.log('Risk Profile: aggressive');
  console.log('Expected: 100% GMX ($5.00), 0% Aave ($0.00)');
  
  // 2. Check ERGC logic
  console.log('\n💰 ERGC Debit Logic:');
  console.log('For aggressive strategy with ERGC discount:');
  console.log('- Should debit 1 ERGC automatically');
  console.log('- Condition: hasErgcDiscount && riskProfile === "aggressive" && gmxPercent > 0');
  
  // 3. Test webhook call
  console.log('\n🔗 Testing Webhook Call:');
  console.log('Sending test payment to webhook...');
  
  try {
    const response = await fetch('http://localhost:3000/api/square/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Square-Signature': 'test_signature' // Bypass signature check for testing
      },
      body: JSON.stringify({
        type: 'payment.updated',
        id: 'test_event_001',
        data: {
          object: testPayment
        }
      })
    });
    
    if (response.ok) {
      const result = await response.json();
      console.log('✅ Webhook response:', JSON.stringify(result, null, 2));
      
      // Check results
      console.log('\n📋 Execution Results:');
      console.log(`Action: ${result.action}`);
      console.log(`GMX Success: ${result.gmxResult?.success || 'N/A'}`);
      console.log(`GMX TxHash: ${result.gmxResult?.txHash || 'N/A'}`);
      console.log(`Aave Success: ${result.aaveResult?.success || 'N/A'}`);
      console.log(`Aave TxHash: ${result.aaveResult?.txHash || 'N/A'}`);
      
      // Verify expectations
      if (result.gmxResult?.success) {
        console.log('✅ GMX executed successfully');
      } else {
        console.log('❌ GMX execution failed');
      }
      
      if (!result.aaveResult || result.aaveResult.success === false) {
        console.log('✅ Aave correctly skipped for aggressive strategy');
      } else {
        console.log('❌ Aave should not execute for aggressive strategy');
      }
      
    } else {
      console.error('❌ Webhook failed:', response.status, response.statusText);
      const error = await response.text();
      console.error('Error details:', error);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
  
  // 4. Check on-chain state (if needed)
  console.log('\n🔍 On-chain Verification:');
  console.log('Check Snowtrace for transactions:');
  console.log(`- GMX Position: https://snowtrace.io/address/${HUB_WALLET_ADDRESS}`);
  console.log(`- ERGC Transfer: https://snowtrace.io/address/${ERGC_CONTRACT}`);
}

// Mock ethers for testing without actual blockchain calls
const mockEthers = {
  parseUnits: (amount, decimals) => BigInt(parseFloat(amount) * Math.pow(10, decimals)),
  formatUnits: (value, decimals) => (Number(value) / Math.pow(10, decimals)).toString(),
  Contract: class {
    constructor(address, abi, provider) {
      this.address = address;
    }
    async balanceOf(address) {
      // Mock balance - return 1 ERGC for testing
      return mockEthers.parseUnits('1', 18);
    }
    async transfer(to, amount) {
      return {
        hash: '0xmocktxhash123',
        wait: async () => ({ status: 1 })
      };
    }
  }
};

// Run test
if (require.main === module) {
  testAggressiveStrategy().catch(console.error);
}

module.exports = { testAggressiveStrategy };
