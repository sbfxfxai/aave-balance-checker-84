/**
 * GMX SDK Execution Script - Low Gas Optimization
 * 
 * This script executes GMX trades with optimized gas usage
 * for the TiltVault platform's aggressive strategy.
 */

const { ethers } = require('ethers');
require('dotenv').config();

// Configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const GMX_ROUTER = '0xaBBc5F93239337567b4624062C6eE4E5838d7dEe0'; // GMX Router on Avalanche

// Low gas optimization settings
const GAS_SETTINGS = {
  gasLimit: 300000,        // Reduced gas limit
  gasPrice: 25000000000,   // 25 gwei (adjustable)
  maxFeePerGas: 30000000000,
  maxPriorityFeePerGas: 2000000000
};

// Contract ABIs (simplified for low gas)
const GMX_ROUTER_ABI = [
  {
    "inputs": [
      {"name": "_orderParams", "type": "bytes"},
      {"name": "_executionFee", "type": "uint256"},
      {"name": "_collateralToken", "type": "address"},
      {"name": "_collateralAmount", "type": "uint256"},
      {"name": "_indexToken", "type": "address"},
      {"name": "_minOut", "type": "uint256"},
      {"name": "_isLong", "type": "bool"},
      {"name": "_isIncrease", "type": "bool"}
    ],
    "name": "createOrder",
    "outputs": [{"name": "", "type": "bytes"}],
    "stateMutability": "payable",
    "type": "function"
  }
];

class LowGasGMXExecutor {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
    this.router = new ethers.Contract(GMX_ROUTER, GMX_ROUTER_ABI, this.wallet);
  }

  /**
   * Execute order with optimized gas settings
   */
  async executeOrder(orderParams, collateralToken, collateralAmount, indexToken, minOut, isLong, isIncrease) {
    try {
      console.log('🚀 Executing GMX order with low gas optimization...');
      
      // Calculate optimal execution fee
      const executionFee = await this.calculateOptimalFee();
      
      // Build transaction with gas optimization
      const tx = await this.router.createOrder.populateTransaction(
        orderParams,
        executionFee,
        collateralToken,
        collateralAmount,
        indexToken,
        minOut,
        isLong,
        isIncrease,
        {
          value: collateralAmount + executionFee,
          ...GAS_SETTINGS
        }
      );

      // Estimate gas before execution
      const gasEstimate = await this.wallet.estimateGas(tx);
      console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);
      
      // Adjust gas settings if needed
      if (gasEstimate.gt(GAS_SETTINGS.gasLimit)) {
        tx.gasLimit = gasEstimate.mul(110).div(100); // Add 10% buffer
        console.log(`📊 Adjusted gas limit to: ${tx.gasLimit.toString()}`);
      }

      // Execute transaction
      const txResponse = await this.wallet.sendTransaction(tx);
      console.log(`📤 Transaction sent: ${txResponse.hash}`);
      
      // Wait for confirmation
      const receipt = await txResponse.wait();
      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
      
      return {
        success: true,
        transactionHash: txResponse.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString()
      };

    } catch (error) {
      console.error('❌ Order execution failed:', error);
      return {
        success: false,
        error: error.message,
        transactionHash: null
      };
    }
  }

  /**
   * Calculate optimal execution fee
   */
  async calculateOptimalFee() {
    try {
      // Get current gas price
      const gasPrice = await this.provider.getFeeData();
      const optimalGasPrice = gasPrice.gasPrice.mul(110).div(100); // 10% above current
      
      // Calculate execution fee (simplified)
      const baseFee = ethers.utils.parseEther('0.0001'); // 0.0001 AVAX base fee
      const gasMultiplier = optimalGasPrice.mul(300000).div(ethers.utils.parseUnits('1', 'gwei')); // 300k gas
      
      return baseFee.add(gasMultiplier);
    } catch (error) {
      console.warn('⚠️ Fee calculation failed, using default:', error);
      return ethers.utils.parseEther('0.0001');
    }
  }

  /**
   * Batch multiple orders for gas efficiency
   */
  async batchExecute(orders) {
    console.log(`📦 Executing ${orders.length} orders in batch...`);
    
    const results = [];
    let totalGasUsed = ethers.BigNumber.from(0);
    
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      console.log(`📝 Processing order ${i + 1}/${orders.length}...`);
      
      const result = await this.executeOrder(
        order.orderParams,
        order.collateralToken,
        order.collateralAmount,
        order.indexToken,
        order.minOut,
        order.isLong,
        order.isIncrease
      );
      
      results.push(result);
      
      if (result.success) {
        totalGasUsed = totalGasUsed.add(ethers.BigNumber.from(result.gasUsed));
        
        // Add delay between orders to avoid nonce conflicts
        if (i < orders.length - 1) {
          await this.delay(2000); // 2 second delay
        }
      }
    }
    
    console.log(`📊 Batch execution completed. Total gas used: ${totalGasUsed.toString()}`);
    return results;
  }

  /**
   * Monitor gas prices and execute when optimal
   */
  async executeWhenOptimal(orderParams, collateralToken, collateralAmount, indexToken, minOut, isLong, isIncrease) {
    console.log('⏳ Monitoring gas prices for optimal execution...');
    
    const maxGasPrice = ethers.utils.parseUnits('30', 'gwei'); // 30 gwei max
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const feeData = await this.provider.getFeeData();
        const currentGasPrice = feeData.gasPrice;
        
        console.log(`📊 Attempt ${attempts}: Current gas price: ${ethers.utils.formatUnits(currentGasPrice, 'gwei')} gwei`);
        
        if (currentGasPrice.lte(maxGasPrice)) {
          console.log('✅ Gas price is optimal, executing order...');
          return await this.executeOrder(
            orderParams,
            collateralToken,
            collateralAmount,
            indexToken,
            minOut,
            isLong,
            isIncrease
          );
        } else {
          console.log(`⏳ Gas price too high, waiting... (${ethers.utils.formatUnits(currentGasPrice, 'gwei')} > ${ethers.utils.formatUnits(maxGasPrice, 'gwei')} gwei)`);
          await this.delay(30000); // Wait 30 seconds
        }
      } catch (error) {
        console.error(`❌ Error checking gas price (attempt ${attempts}):`, error);
        await this.delay(10000); // Wait 10 seconds on error
      }
    }
    
    throw new Error('Gas price did not become optimal within the time limit');
  }

  /**
   * Delay helper function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current gas statistics
   */
  async getGasStats() {
    try {
      const feeData = await this.provider.getFeeData();
      const block = await this.provider.getBlock('latest');
      
      return {
        gasPrice: ethers.utils.formatUnits(feeData.gasPrice, 'gwei'),
        maxFeePerGas: ethers.utils.formatUnits(feeData.maxFeePerGas, 'gwei'),
        maxPriorityFeePerGas: ethers.utils.formatUnits(feeData.maxPriorityFeePerGas, 'gwei'),
        blockNumber: block.number,
        baseFeePerGas: block.baseFeePerGas ? ethers.utils.formatUnits(block.baseFeePerGas, 'gwei') : 'N/A'
      };
    } catch (error) {
      console.error('❌ Error getting gas stats:', error);
      return null;
    }
  }
}

// Example usage
async function main() {
  const executor = new LowGasGMXExecutor();
  
  // Get current gas statistics
  const gasStats = await executor.getGasStats();
  console.log('📊 Current Gas Statistics:', gasStats);
  
  // Example order parameters (replace with actual values)
  const orderParams = '0x'; // Encoded order parameters
  const collateralToken = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'; // USDC on Avalanche
  const collateralAmount = ethers.utils.parseEther('1000'); // 1000 USDC
  const indexToken = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'; // USDC as index token
  const minOut = ethers.utils.parseEther('990'); // Minimum 990 USDC out
  const isLong = true;
  const isIncrease = true;
  
  try {
    // Execute when gas is optimal
    const result = await executor.executeWhenOptimal(
      orderParams,
      collateralToken,
      collateralAmount,
      indexToken,
      minOut,
      isLong,
      isIncrease
    );
    
    console.log('🎉 Order execution result:', result);
    
  } catch (error) {
    console.error('❌ Order execution failed:', error);
    process.exit(1);
  }
}

// Export for use in other modules
module.exports = {
  LowGasGMXExecutor,
  main
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
