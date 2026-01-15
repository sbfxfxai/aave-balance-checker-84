import { getPrivyClient } from './privy-client';
import { getRedis } from './redis';
import { logger, LogCategory } from './logger';
import { errorTracker } from './errorTracker';
import { ethers } from 'ethers';

// GMX V2 Contract Addresses (Avalanche)
const GMX_EXCHANGE_ROUTER = '0x7C68C7866A64FA2160F78EEaE12217FFbf871fa8';
const GMX_ORDER_VAULT = '0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5';
const USDC_ADDRESS = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const WETH_ADDRESS = '0xf20d962a5c8ab710e7c5b6c1a5877df2ea40b416';

// ETH/USD Market Address (GMX V2)
const ETH_USD_MARKET = '0x70d95587d40A2C234b4c0997523a3aC658Ba4451';

interface GmxExecutionResult {
  success: boolean;
  txHash?: string;
  message?: string;
  error?: string;
  orderId?: string;
}

interface GmxOrderParams {
  marketAddress: string;
  collateralToken: string;
  collateralAmount: bigint;
  sizeDeltaUsd: bigint;
  acceptablePrice: bigint;
  isLong: boolean;
  executionFee: bigint;
}

/**
 * Execute GMX trade via Privy Server Wallet
 * 
 * This function:
 * 1. Looks up the Privy wallet ID from the user's wallet address
 * 2. Validates USDC balance and allowances
 * 3. Approves USDC to GMX router if needed
 * 4. Creates a GMX order with the specified parameters
 * 5. Stores transaction details for tracking
 * 
 * @param walletAddress The user's embedded wallet address
 * @param amountUsd Amount in USD to use as collateral
 * @param paymentId Payment ID for tracking
 * @returns Execution result with transaction details
 */
export async function executeGmxViaPrivy(
  walletAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<GmxExecutionResult> {
  const startTime = Date.now();
  
  logger.info('Starting GMX execution via Privy', LogCategory.PAYMENT, {
    walletAddress: walletAddress.substring(0, 8) + '...',
    amountUsd,
    paymentId
  });

  // Input validation
  if (!ethers.isAddress(walletAddress)) {
    const error = new Error('Invalid wallet address format');
    logger.error('GMX execution failed - invalid address', LogCategory.PAYMENT, {
      walletAddress
    }, error);
    
    return {
      success: false,
      error: error.message
    };
  }

  if (amountUsd <= 0 || amountUsd > 100000) {
    const error = new Error('Amount must be between $0 and $100,000');
    logger.error('GMX execution failed - invalid amount', LogCategory.PAYMENT, {
      amountUsd
    }, error);
    
    return {
      success: false,
      error: error.message
    };
  }

  try {
    const privy = await getPrivyClient();
    const redis = await getRedis();

    // 1. Lookup Privy Wallet ID from Redis
    const walletId = await redis.get<string>(`wallet_id:${walletAddress.toLowerCase()}`);
    
    if (!walletId) {
      const error = new Error('Wallet not found. User needs to authenticate first.');
      logger.error('GMX execution failed - wallet not found', LogCategory.PAYMENT, {
        walletAddress: walletAddress.substring(0, 8) + '...'
      }, error);
      
      errorTracker.trackPaymentError(error, {
        paymentId,
        walletAddress: walletAddress.substring(0, 8) + '...',
        amountUsd,
        stage: 'wallet_lookup'
      });
      
      return {
        success: false,
        error: error.message
      };
    }

    logger.info('Found Privy wallet ID', LogCategory.PAYMENT, {
      walletId: walletId.substring(0, 8) + '...'
    });

    // 2. Wallet address verification is already done via Redis lookup
    // The walletId was retrieved using walletAddress as the key, so they must match
    // No need to fetch wallet details from Privy API as it doesn't support walletApi.get()

    // 3. Check USDC balance
    const provider = new ethers.JsonRpcProvider('https://api.avax.network/ext/bc/C/rpc');
    const usdcContract = new ethers.Contract(
      USDC_ADDRESS,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    );
    
    const balance = await usdcContract.balanceOf(walletAddress);
    const requiredAmount = ethers.parseUnits(amountUsd.toString(), 6); // USDC has 6 decimals
    
    if (balance < requiredAmount) {
      const error = new Error(
        `Insufficient USDC balance. Required: $${amountUsd}, Available: $${ethers.formatUnits(balance, 6)}`
      );
      logger.error('GMX execution failed - insufficient balance', LogCategory.PAYMENT, {
        required: amountUsd,
        available: ethers.formatUnits(balance, 6)
      }, error);
      
      errorTracker.trackPaymentError(error, {
        paymentId,
        walletAddress: walletAddress.substring(0, 8) + '...',
        amountUsd,
        stage: 'balance_check'
      });
      
      return {
        success: false,
        error: error.message
      };
    }

    logger.info('USDC balance sufficient', LogCategory.PAYMENT, {
      balance: ethers.formatUnits(balance, 6),
      required: amountUsd
    });

    // 4. Approve USDC to GMX Router (if needed)
    const approvalTx = await approveUsdcIfNeeded(
      privy,
      walletId,
      walletAddress,
      requiredAmount
    );

    if (approvalTx) {
      logger.info('USDC approved to GMX router', LogCategory.PAYMENT, {
        txHash: approvalTx
      });
      
      // Wait for approval confirmation
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // 5. Create GMX order
    const orderParams = buildGmxOrderParams(amountUsd);
    const orderResult = await createGmxOrder(
      privy,
      walletId,
      orderParams
    );

    logger.info('GMX order created', LogCategory.PAYMENT, {
      txHash: orderResult.txHash,
      orderId: orderResult.orderId
    });

    // 6. Store transaction record in Redis
    await storeTransactionRecord(redis, paymentId, orderResult, walletAddress, amountUsd);

    logger.info('GMX execution completed successfully', LogCategory.PAYMENT, {
      paymentId,
      txHash: orderResult.txHash,
      orderId: orderResult.orderId,
      duration: Date.now() - startTime
    });

    return {
      success: true,
      txHash: orderResult.txHash,
      orderId: orderResult.orderId,
      message: 'GMX order executed successfully via Privy'
    };

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    logger.error('GMX execution failed', LogCategory.PAYMENT, {
      walletAddress: walletAddress.substring(0, 8) + '...',
      amountUsd,
      paymentId,
      duration: Date.now() - startTime,
      error: errorMsg
    }, error instanceof Error ? error : new Error(errorMsg));
    
    // Store error for debugging
    try {
      const redis = await getRedis();
      await redis.set(`payment:${paymentId}:error`, JSON.stringify({
        error: errorMsg,
        timestamp: Date.now(),
        stage: 'execution'
      }), { ex: 86400 }); // 24 hours
    } catch (redisError) {
      logger.error('Failed to store error in Redis', LogCategory.DATABASE, {
        paymentId
      }, redisError instanceof Error ? redisError : new Error(String(redisError)));
    }
    
    errorTracker.trackPaymentError(error instanceof Error ? error : new Error(errorMsg), {
      paymentId,
      walletAddress: walletAddress.substring(0, 8) + '...',
      amountUsd,
      stage: 'execution'
    });
    
    return {
      success: false,
      error: errorMsg
    };
  }
}

/**
 * Approve USDC to GMX Order Vault if current allowance is insufficient
 */
async function approveUsdcIfNeeded(
  privy: any,
  walletId: string,
  walletAddress: string,
  amount: bigint
): Promise<string | null> {
  try {
    // Check current allowance
    const provider = new ethers.JsonRpcProvider('https://api.avax.network/ext/bc/C/rpc');
    const usdcContract = new ethers.Contract(
      USDC_ADDRESS,
      ['function allowance(address owner, address spender) view returns (uint256)'],
      provider
    );

    const currentAllowance = await usdcContract.allowance(walletAddress, GMX_ORDER_VAULT);

    if (currentAllowance >= amount) {
      logger.debug('Sufficient USDC allowance already exists', LogCategory.PAYMENT, {
        currentAllowance: ethers.formatUnits(currentAllowance, 6),
        required: ethers.formatUnits(amount, 6)
      });
      return null;
    }

    logger.info('Approving USDC to GMX Order Vault', LogCategory.PAYMENT, {
      currentAllowance: ethers.formatUnits(currentAllowance, 6),
      required: ethers.formatUnits(amount, 6)
    });

    // Encode approval transaction
    const approveInterface = new ethers.Interface([
      'function approve(address spender, uint256 amount) returns (bool)'
    ]);
    
    const approveData = approveInterface.encodeFunctionData('approve', [
      GMX_ORDER_VAULT,
      amount
    ]);

    // Send approval transaction via Privy
    const response = await privy.walletApi.ethereum.sendTransaction({
      walletId,
      caip2: 'eip155:43114',
      transaction: {
        to: USDC_ADDRESS,
        data: approveData,
        value: '0x0'
      }
    });

    return response.transactionHash;
  } catch (error) {
    logger.error('USDC approval failed', LogCategory.PAYMENT, {
      walletId: walletId.substring(0, 8) + '...',
      amount: ethers.formatUnits(amount, 6)
    }, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Build GMX order parameters for a long ETH position
 */
function buildGmxOrderParams(amountUsd: number): GmxOrderParams {
  // Example: Build a long ETH position with 2x leverage
  const collateralAmount = ethers.parseUnits(amountUsd.toString(), 6); // USDC
  const sizeDeltaUsd = ethers.parseUnits((amountUsd * 2).toString(), 30); // 2x leverage
  const acceptablePrice = ethers.parseUnits('5000', 30); // $5000 per ETH (should fetch real price)
  const executionFee = ethers.parseEther('0.001'); // 0.001 AVAX for execution

  return {
    marketAddress: ETH_USD_MARKET,
    collateralToken: USDC_ADDRESS,
    collateralAmount,
    sizeDeltaUsd,
    acceptablePrice,
    isLong: true,
    executionFee
  };
}

/**
 * Create a GMX order via the Exchange Router
 */
async function createGmxOrder(
  privy: any,
  walletId: string,
  params: GmxOrderParams
): Promise<{ txHash: string; orderId: string }> {
  try {
    // GMX V2 createOrder function signature
    const exchangeRouterInterface = new ethers.Interface([
      'function createOrder((address,address,address,uint256,uint256,uint256,bool,uint256,bytes32,address)) external payable returns (bytes32)'
    ]);

    // Order parameters for GMX V2
    const orderParams = [
      params.marketAddress,           // market
      params.collateralToken,         // initialCollateralToken
      walletId,                       // receiver (should be the wallet address)
      params.collateralAmount,        // initialCollateralAmount
      params.sizeDeltaUsd,            // sizeDeltaUsd
      params.acceptablePrice,         // acceptablePrice
      params.isLong,                  // isLong
      params.executionFee,            // executionFee
      ethers.ZeroHash,                // referralCode
      walletId                        // callbackTarget (optional)
    ];

    const orderData = exchangeRouterInterface.encodeFunctionData('createOrder', [orderParams]);

    // Send transaction via Privy
    const response = await privy.walletApi.ethereum.sendTransaction({
      walletId,
      caip2: 'eip155:43114',
      transaction: {
        to: GMX_EXCHANGE_ROUTER,
        data: orderData,
        value: params.executionFee.toString()
      }
    });

    // Generate order ID from transaction hash (simplified)
    const orderId = `order_${response.transactionHash.slice(0, 10)}`;

    return {
      txHash: response.transactionHash,
      orderId
    };
  } catch (error) {
    logger.error('GMX order creation failed', LogCategory.PAYMENT, {
      walletId: walletId.substring(0, 8) + '...',
      marketAddress: params.marketAddress
    }, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Store transaction record in Redis for tracking
 */
async function storeTransactionRecord(
  redis: any,
  paymentId: string,
  orderResult: { txHash: string; orderId: string },
  walletAddress: string,
  amountUsd: number
): Promise<void> {
  try {
    const record = {
      paymentId,
      txHash: orderResult.txHash,
      orderId: orderResult.orderId,
      walletAddress: walletAddress.toLowerCase(),
      amountUsd,
      timestamp: Date.now(),
      status: 'pending'
    };

    // Store multiple keys for different lookup patterns
    await Promise.all([
      redis.set(`payment:${paymentId}:tx`, JSON.stringify(record), { ex: 86400 * 7 }), // 7 days
      redis.set(`tx:${orderResult.txHash}:payment`, paymentId, { ex: 86400 * 7 }),
      redis.set(`order:${orderResult.orderId}:payment`, paymentId, { ex: 86400 * 7 }),
      redis.set(`tx:${orderResult.txHash}:timestamp`, Date.now(), { ex: 86400 * 7 })
    ]);

    logger.debug('Transaction record stored', LogCategory.DATABASE, {
      paymentId,
      txHash: orderResult.txHash,
      orderId: orderResult.orderId
    });
  } catch (error) {
    logger.error('Failed to store transaction record', LogCategory.DATABASE, {
      paymentId,
      txHash: orderResult.txHash
    }, error instanceof Error ? error : new Error(String(error)));
    // Don't throw - the main execution should still succeed
  }
}

/**
 * Store wallet mapping during user authentication
 * Call this when a user authenticates and you have their wallet address and Privy wallet ID
 */
export async function storeWalletMapping(
  walletAddress: string,
  walletId: string
): Promise<void> {
  try {
    const redis = await getRedis();
    
    await Promise.all([
      redis.set(`wallet_id:${walletAddress.toLowerCase()}`, walletId, { ex: 86400 * 30 }), // 30 days
      redis.set(`wallet_address:${walletId}`, walletAddress.toLowerCase(), { ex: 86400 * 30 })
    ]);

    logger.info('Wallet mapping stored', LogCategory.AUTH, {
      walletAddress: walletAddress.substring(0, 8) + '...',
      walletId: walletId.substring(0, 8) + '...'
    });
  } catch (error) {
    logger.error('Failed to store wallet mapping', LogCategory.DATABASE, {
      walletAddress: walletAddress.substring(0, 8) + '...',
      walletId: walletId.substring(0, 8) + '...'
    }, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Get transaction status by payment ID
 */
export async function getTransactionStatus(paymentId: string): Promise<any> {
  try {
    const redis = await getRedis();
    const record = await redis.get(`payment:${paymentId}:tx`);
    
    if (!record) {
      return null;
    }

    return JSON.parse(record as string);
  } catch (error) {
    logger.error('Failed to get transaction status', LogCategory.DATABASE, {
      paymentId
    }, error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Update transaction status
 */
export async function updateTransactionStatus(
  txHash: string,
  status: 'pending' | 'completed' | 'failed',
  details?: any
): Promise<void> {
  try {
    const redis = await getRedis();
    const paymentId = await redis.get(`tx:${txHash}:payment`);
    
    if (!paymentId) {
      logger.warn('Payment ID not found for transaction', LogCategory.DATABASE, { txHash });
      return;
    }

    const recordKey = `payment:${paymentId}:tx`;
    const existingRecord = await redis.get(recordKey);
    
    if (existingRecord) {
      const record = JSON.parse(existingRecord as string);
      record.status = status;
      record.updatedAt = Date.now();
      
      if (details) {
        record.details = { ...record.details, ...details };
      }
      
      await redis.set(recordKey, JSON.stringify(record), { ex: 86400 * 7 });
      
      logger.info('Transaction status updated', LogCategory.DATABASE, {
        paymentId,
        txHash,
        status
      });
    }
  } catch (error) {
    logger.error('Failed to update transaction status', LogCategory.DATABASE, {
      txHash,
      status
    }, error instanceof Error ? error : new Error(String(error)));
  }
}
