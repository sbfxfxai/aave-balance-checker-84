import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const GMX_READER = '0x38D91ED9628d776c2a8F0e2e9F6c5A5B5B5B5B5B5'; // GMX Reader on Avalanche

// Contract ABIs
const GMX_READER_ABI = [
  {
    "inputs": [
      {"name": "_account", "type": "address"},
      {"name": "_marketAddress", "type": "address"},
      {"name": "_collateralToken", "type": "address"},
      {"name": "_indexToken", "type": "address"},
      {"name": "_isLong", "type": "bool"}
    ],
    "name": "getPosition",
    "outputs": [
      {
        "components": [
          {"name": "size", "type": "uint256"},
          {"name": "collateral", "type": "uint256"},
          {"name": "averagePrice", "type": "uint256"},
          {"name": "entryPrice", "type": "uint256"},
          {"name": "realisedPnl", "type": "int256"},
          {"name": "hasRealisedProfit", "type": "bool"},
          {"name": "hasProfit", "type": "bool"},
          {"name": "lastIncreasedTime", "type": "uint256"}
        ],
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
];

interface PositionData {
  size: string;
  collateral: string;
  averagePrice: string;
  entryPrice: string;
  realisedPnl: string;
  hasRealisedProfit: boolean;
  hasProfit: boolean;
  lastIncreasedTime: string;
}

interface VerificationResult {
  success: boolean;
  position?: PositionData;
  error?: string;
  blockNumber?: number;
  timestamp?: string;
}

class GMXPositionVerifier {
  private provider: ethers.JsonRpcProvider;
  private reader: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    this.reader = new ethers.Contract(GMX_READER, GMX_READER_ABI, this.provider);
  }

  /**
   * Verify a GMX position by account and market parameters
   */
  async verifyPosition(
    account: string,
    marketAddress: string,
    collateralToken: string,
    indexToken: string,
    isLong: boolean
  ): Promise<VerificationResult> {
    try {
      console.log('🔍 Verifying GMX position...');
      console.log(`📊 Account: ${account}`);
      console.log(`📈 Market: ${marketAddress}`);
      console.log(`💰 Collateral: ${collateralToken}`);
      console.log(`📊 Index: ${indexToken}`);
      console.log(`📏 Direction: ${isLong ? 'Long' : 'Short'}`);

      // Validate addresses
      if (!ethers.isAddress(account)) {
        throw new Error('Invalid account address');
      }
      if (!ethers.isAddress(marketAddress)) {
        throw new Error('Invalid market address');
      }
      if (!ethers.isAddress(collateralToken)) {
        throw new Error('Invalid collateral token address');
      }
      if (!ethers.isAddress(indexToken)) {
        throw new Error('Invalid index token address');
      }

      // Get current block number
      const blockNumber = await this.provider.getBlockNumber();
      console.log(`📦 Current block: ${blockNumber}`);

      // Query position from GMX
      const positionData = await this.reader.getPosition(
        account,
        marketAddress,
        collateralToken,
        indexToken,
        isLong
      );

      // Check if position exists
      if (positionData.size.toString() === '0') {
        return {
          success: false,
          error: 'Position does not exist or has zero size',
          blockNumber,
          timestamp: new Date().toISOString()
        };
      }

      const position: PositionData = {
        size: ethers.formatEther(positionData.size),
        collateral: ethers.formatEther(positionData.collateral),
        averagePrice: ethers.formatUnits(positionData.averagePrice, 30), // GMX uses 30 decimals for prices
        entryPrice: ethers.formatUnits(positionData.entryPrice, 30),
        realisedPnl: ethers.formatEther(positionData.realisedPnl),
        hasRealisedProfit: positionData.hasRealisedProfit,
        hasProfit: positionData.hasProfit,
        lastIncreasedTime: new Date(Number(positionData.lastIncreasedTime) * 1000).toISOString()
      };

      console.log('✅ Position verified successfully!');
      console.log(`📊 Size: ${position.size}`);
      console.log(`💰 Collateral: ${position.collateral}`);
      console.log(`📈 Average Price: $${position.averagePrice}`);
      console.log(`📊 Entry Price: $${position.entryPrice}`);
      console.log(`💵 Realised PnL: ${position.realisedPnl}`);
      console.log(`📅 Last Increased: ${position.lastIncreasedTime}`);

      return {
        success: true,
        position,
        blockNumber,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Position verification failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Verify multiple positions for an account
   */
  async verifyMultiplePositions(
    account: string,
    positions: Array<{
      marketAddress: string;
      collateralToken: string;
      indexToken: string;
      isLong: boolean;
    }>
  ): Promise<VerificationResult[]> {
    console.log(`📦 Verifying ${positions.length} positions for account ${account}...`);

    const results: VerificationResult[] = [];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      console.log(`📝 Verifying position ${i + 1}/${positions.length}...`);

      const result = await this.verifyPosition(
        account,
        pos.marketAddress,
        pos.collateralToken,
        pos.indexToken,
        pos.isLong
      );

      results.push(result);

      // Add delay to avoid rate limiting
      if (i < positions.length - 1) {
        await this.delay(1000); // 1 second delay
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`📊 Verification completed: ${successCount}/${results.length} positions verified successfully`);

    return results;
  }

  /**
   * Get position health metrics
   */
  async getPositionHealth(
    account: string,
    marketAddress: string,
    collateralToken: string,
    indexToken: string,
    isLong: boolean
  ): Promise<{
    healthy: boolean;
    metrics: {
      leverage: number;
      liquidationPrice: string;
      currentPrice: string;
      distanceToLiquidation: string;
      collateralRatio: number;
    };
  }> {
    try {
      const verification = await this.verifyPosition(
        account,
        marketAddress,
        collateralToken,
        indexToken,
        isLong
      );

      if (!verification.success || !verification.position) {
        throw new Error('Cannot verify position for health check');
      }

      const position = verification.position;
      const size = parseFloat(position.size);
      const collateral = parseFloat(position.collateral);
      const averagePrice = parseFloat(position.averagePrice);

      // Calculate leverage
      const leverage = size / collateral;

      // Get current market price (simplified - in production, use price oracle)
      const currentPrice = averagePrice; // This would come from a price oracle

      // Calculate liquidation price (simplified calculation)
      const liquidationPrice = isLong 
        ? averagePrice * (1 - 1 / leverage)
        : averagePrice * (1 + 1 / leverage);

      // Calculate distance to liquidation
      const distanceToLiquidation = isLong
        ? ((currentPrice - liquidationPrice) / currentPrice * 100).toFixed(2)
        : ((liquidationPrice - currentPrice) / currentPrice * 100).toFixed(2);

      // Calculate collateral ratio
      const collateralRatio = (collateral / size) * 100;

      const metrics = {
        leverage,
        liquidationPrice: liquidationPrice.toFixed(6),
        currentPrice: currentPrice.toFixed(6),
        distanceToLiquidation: `${distanceToLiquidation}%`,
        collateralRatio
      };

      const healthy = parseFloat(distanceToLiquidation) > 10 && leverage <= 10;

      return { healthy, metrics };

    } catch (error) {
      console.error('❌ Health check failed:', error);
      throw error;
    }
  }

  /**
   * Monitor position for changes
   */
  async monitorPosition(
    account: string,
    marketAddress: string,
    collateralToken: string,
    indexToken: string,
    isLong: boolean,
    callback: (result: VerificationResult) => void
  ): Promise<void> {
    console.log('👁️ Starting position monitoring...');

    let lastPosition: PositionData | null = null;

    const checkPosition = async () => {
      try {
        const result = await this.verifyPosition(
          account,
          marketAddress,
          collateralToken,
          indexToken,
          isLong
        );

        if (result.success && result.position) {
          // Check if position changed
          if (!lastPosition || 
              lastPosition.size !== result.position.size ||
              lastPosition.collateral !== result.position.collateral ||
              lastPosition.realisedPnl !== result.position.realisedPnl) {
            
            console.log('🔄 Position change detected!');
            callback(result);
            lastPosition = result.position;
          }
        } else if (!result.success && lastPosition) {
          // Position was closed
          console.log('🚫 Position closed!');
          callback(result);
          lastPosition = null;
        }
      } catch (error) {
        console.error('❌ Monitoring error:', error);
      }
    };

    // Check position every 30 seconds
    const interval = setInterval(checkPosition, 30000);

    // Initial check
    await checkPosition();

    // Return cleanup function
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log('🛑 Position monitoring stopped');
      process.exit(0);
    });
  }

  /**
   * Delay helper function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get provider information
   */
  async getProviderInfo(): Promise<{
    network: { name: string; chainId: number };
    blockNumber: number;
    gasPrice: string;
  }> {
    const network = await this.provider.getNetwork();
    const blockNumber = await this.provider.getBlockNumber();
    const feeData = await this.provider.getFeeData();

    return {
      network: {
        name: network.name,
        chainId: Number(network.chainId)
      },
      blockNumber,
      gasPrice: ethers.formatUnits(feeData.gasPrice || 0, 'gwei')
    };
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 5) {
    console.log('Usage: npm run verify-position <account> <market> <collateral> <index> <isLong>');
    console.log('Example: npm run verify-position 0x1234... 0x5678... 0x9abc... 0xdef0... true');
    process.exit(1);
  }

  const [account, marketAddress, collateralToken, indexToken, isLongStr] = args;
  const isLong = isLongStr.toLowerCase() === 'true';

  const verifier = new GMXPositionVerifier();

  try {
    // Get provider info
    const providerInfo = await verifier.getProviderInfo();
    console.log('🌐 Provider Info:', providerInfo);

    // Verify position
    const result = await verifier.verifyPosition(
      account,
      marketAddress,
      collateralToken,
      indexToken,
      isLong
    );

    if (result.success) {
      console.log('✅ Position verification successful!');
      
      // Get health metrics
      const health = await verifier.getPositionHealth(
        account,
        marketAddress,
        collateralToken,
        indexToken,
        isLong
      );
      
      console.log('🏥 Position Health:', health);
    } else {
      console.log('❌ Position verification failed:', result.error);
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

// Export for use in other modules
export { GMXPositionVerifier, type PositionData, type VerificationResult };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
