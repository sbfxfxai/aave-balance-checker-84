/**
 * GMX SDK Execution Script
 * 
 * This script executes GMX trades for the TiltVault platform
 * supporting both conservative and aggressive strategies.
 */

const { ethers } = require('ethers');
require('dotenv').config();

// Configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const GMX_ROUTER = '0xaBBc5F93239337567b4624062C6eE4E5838d7dEe0'; // GMX Router on Avalanche

// Contract ABIs
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
  },
  {
    "inputs": [
      {"name": "_orderParams", "type": "bytes"},
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

class GMXExecutor {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    this.wallet = new ethers.Wallet(PRIVATE_KEY, this.provider);
    this.router = new ethers.Contract(GMX_ROUTER, GMX_ROUTER_ABI, this.wallet);
  }

  /**
   * Execute a single GMX order
   */
  async executeOrder(orderParams, collateralToken, collateralAmount, indexToken, minOut, isLong, isIncrease) {
    try {
      console.log('🚀 Executing GMX order...');
      console.log(`📊 Collateral: ${ethers.utils.formatEther(collateralAmount)} tokens`);
      console.log(`📈 Is Long: ${isLong}, Is Increase: ${isIncrease}`);
      
      // Calculate execution fee
      const executionFee = await this.calculateExecutionFee();
      
      // Build transaction
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
          gasLimit: 500000,
          gasPrice: await this.getOptimalGasPrice()
        }
      );

      // Execute transaction
      const txResponse = await this.wallet.sendTransaction(tx);
      console.log(`📤 Transaction sent: ${txResponse.hash}`);
      
      // Wait for confirmation
      const receipt = await txResponse.wait();
      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
      
      return {
        success: true,
        transactionHash: txResponse.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString()
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
   * Execute multiple orders in sequence
   */
  async executeMultipleOrders(orders) {
    console.log(`📦 Executing ${orders.length} orders in sequence...`);
    
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
          await this.delay(3000); // 3 second delay
        }
      } else {
        console.log(`⚠️ Order ${i + 1} failed, continuing with next order...`);
      }
    }
    
    console.log(`📊 Batch execution completed. Total gas used: ${totalGasUsed.toString()}`);
    console.log(`✅ Successful orders: ${results.filter(r => r.success).length}/${results.length}`);
    
    return results;
  }

  /**
   * Calculate execution fee
   */
  async calculateExecutionFee() {
    try {
      // Get current gas price
      const gasPrice = await this.getOptimalGasPrice();
      
      // Base fee in AVAX
      const baseFee = ethers.utils.parseEther('0.0001');
      
      // Gas multiplier (simplified calculation)
      const gasMultiplier = gasPrice.mul(300000).div(ethers.utils.parseUnits('1', 'gwei'));
      
      return baseFee.add(gasMultiplier);
    } catch (error) {
      console.warn('⚠️ Fee calculation failed, using default:', error);
      return ethers.utils.parseEther('0.0001');
    }
  }

  /**
   * Get optimal gas price
   */
  async getOptimalGasPrice() {
    try {
      const feeData = await this.provider.getFeeData();
      
      // Use maxFeePerGas if available, otherwise fall back to gasPrice
      return feeData.maxFeePerGas || feeData.gasPrice;
    } catch (error) {
      console.warn('⚠️ Gas price fetch failed, using default:', error);
      return ethers.utils.parseUnits('25', 'gwei'); // 25 gwei default
    }
  }

  /**
   * Create order parameters for different strategies
   */
  createOrderParams(strategy, token, amount, leverage, priceImpact) {
    // This is a simplified version - in production, you'd use proper encoding
    const params = {
      strategy,
      token,
      amount,
      leverage,
      priceImpact,
      timestamp: Date.now()
    };
    
    // In reality, this would be properly encoded according to GMX specifications
    return ethers.utils.defaultAbiCoder.encode(
      ['tuple(string,address,uint256,uint256,uint256,uint256)'],
      [
        strategy,
        token,
        amount,
        leverage,
        priceImpact,
        params.timestamp
      ]
    );
  }

  /**
   * Monitor transaction status
   */
  async monitorTransaction(txHash) {
    try {
      console.log(`🔍 Monitoring transaction: ${txHash}`);
      
      let receipt = null;
      let attempts = 0;
      const maxAttempts = 30;
      
      while (!receipt && attempts < maxAttempts) {
        attempts++;
        
        try {
          receipt = await this.provider.getTransactionReceipt(txHash);
          
          if (receipt) {
            console.log(`✅ Transaction confirmed after ${attempts} attempts`);
            return {
              confirmed: true,
              blockNumber: receipt.blockNumber,
              gasUsed: receipt.gasUsed.toString(),
              status: receipt.status === 1 ? 'success' : 'failed'
            };
          }
        } catch (error) {
          // Transaction not yet mined
        }
        
        await this.delay(2000); // Wait 2 seconds
      }
      
      console.log(`⏳ Transaction not confirmed after ${maxAttempts} attempts`);
      return {
        confirmed: false,
        status: 'pending'
      };
      
    } catch (error) {
      console.error('❌ Error monitoring transaction:', error);
      return {
        confirmed: false,
        error: error.message,
        status: 'error'
      };
    }
  }

  /**
   * Get current network and account information
   */
  async getNetworkInfo() {
    try {
      const network = await this.provider.getNetwork();
      const balance = await this.wallet.getBalance();
      const nonce = await this.wallet.getTransactionCount();
      
      return {
        network: {
          name: network.name,
          chainId: network.chainId
        },
        account: {
          address: this.wallet.address,
          balance: ethers.utils.formatEther(balance),
          nonce: nonce.toString()
        }
      };
    } catch (error) {
      console.error('❌ Error getting network info:', error);
      return null;
    }
  }

  /**
   * Delay helper function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate order parameters
   */
  validateOrderParams(params) {
    const errors = [];
    
    if (!params.collateralToken || !ethers.utils.isAddress(params.collateralToken)) {
      errors.push('Invalid collateral token address');
    }
    
    if (!params.collateralAmount || params.collateralAmount.lte(0)) {
      errors.push('Invalid collateral amount');
    }
    
    if (!params.indexToken || !ethers.utils.isAddress(params.indexToken)) {
      errors.push('Invalid index token address');
    }
    
    if (!params.minOut || params.minOut.lte(0)) {
      errors.push('Invalid minimum out amount');
    }
    
    if (typeof params.isLong !== 'boolean') {
      errors.push('Invalid isLong value');
    }
    
    if (typeof params.isIncrease !== 'boolean') {
      errors.push('Invalid isIncrease value');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Example usage
async function main() {
  const executor = new GMXExecutor();
  
  // Get network information
  const networkInfo = await executor.getNetworkInfo();
  console.log('🌐 Network Information:', networkInfo);
  
  // Example order parameters (replace with actual values)
  const orderParams = '0x'; // Encoded order parameters
  const collateralToken = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'; // USDC on Avalanche
  const collateralAmount = ethers.utils.parseEther('1000'); // 1000 USDC
  const indexToken = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'; // USDC as index token
  const minOut = ethers.utils.parseEther('990'); // Minimum 990 USDC out
  const isLong = true;
  const isIncrease = true;
  
  // Validate parameters
  const validation = executor.validateOrderParams({
    collateralToken,
    collateralAmount,
    indexToken,
    minOut,
    isLong,
    isIncrease
  });
  
  if (!validation.valid) {
    console.error('❌ Invalid order parameters:', validation.errors);
    process.exit(1);
  }
  
  try {
    // Execute order
    const result = await executor.executeOrder(
      orderParams,
      collateralToken,
      collateralAmount,
      indexToken,
      minOut,
      isLong,
      isIncrease
    );
    
    console.log('🎉 Order execution result:', result);
    
    // Monitor transaction if successful
    if (result.success) {
      const monitoring = await executor.monitorTransaction(result.transactionHash);
      console.log('📊 Transaction monitoring result:', monitoring);
    }
    
  } catch (error) {
    console.error('❌ Order execution failed:', error);
    process.exit(1);
  }
}

// Export for use in other modules
module.exports = {
  GMXExecutor,
  main
};

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
