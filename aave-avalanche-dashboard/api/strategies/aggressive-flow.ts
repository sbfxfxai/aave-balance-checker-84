/**
 * Aggressive Strategy Flow Mapping
 * 
 * Complete flow from Square webhook through Morpho execution
 * Similar structure to conservative flow but with Morpho lending protocol
 */

import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { savePosition, updatePosition, getPosition } from '../positions/store';
import { executeMorphoFromHubWallet } from '../square/webhook-morpho';
import { sendAvaxTransfer } from '../square/webhook-transfers';

/**
 * Aggressive Strategy Flow
 * 
 * Flow:
 * 1. Receive payment → Parse note → Determine aggressive strategy
 * 2. Send AVAX for gas (higher amount than conservative)
 * 3. Execute Morpho strategy (lending protocol for higher yield)
 * 4. Update position status
 * 5. Error handling with classification
 */

export interface AggressiveFlowResult {
  success: boolean;
  positionId?: string;
  avaxTxHash?: string;
  morphoTxHash?: string;
  error?: string;
  errorType?: 'insufficient_balance' | 'supply_cap' | 'network_error' | 'approval_failed' | 'transaction_failed' | 'unknown';
}

/**
 * Execute aggressive strategy flow
 */
export async function executeAggressiveFlow(
  walletAddress: string,
  amount: number,
  paymentId: string,
  userEmail: string
): Promise<AggressiveFlowResult> {
  try {
    // Step 1: Create position record
    const positionId = `pos_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    await savePosition({
      id: positionId,
      paymentId,
      userEmail,
      walletAddress,
      strategyType: 'aggressive',
      usdcAmount: amount,
      status: 'pending',
      createdAt: new Date().toISOString()
    });

    logger.info('Aggressive flow started', LogCategory.API, {
      positionId,
      walletAddress,
      amount,
      paymentId
    });

    // Step 2: Send AVAX for gas (higher amount for aggressive - more complex operations)
    const AGGRESSIVE_AVAX_AMOUNT = BigInt('60000000000000000'); // 0.06 AVAX
    const avaxResult = await sendAvaxTransfer(walletAddress, AGGRESSIVE_AVAX_AMOUNT, 'aggressive deposit');
    
    let avaxTxHash: string | undefined;
    if (avaxResult.success) {
      avaxTxHash = avaxResult.data.txHash;
      await updatePosition(positionId, {
        status: 'avax_sent',
        avaxTxHash
      });
    } else {
      logger.warn('AVAX transfer failed in aggressive flow', LogCategory.API, {
        positionId,
        error: avaxResult.error
      });
      // Continue - user might have gas
    }

    // Step 3: Execute Morpho strategy
    // Split amount between gauntlet and hyperithm (70/30 split for aggressive)
    const gauntletAmount = Math.floor(amount * 0.7);
    const hyperithmAmount = amount - gauntletAmount;
    
    const morphoResult = await executeMorphoFromHubWallet(
      walletAddress,
      gauntletAmount,
      hyperithmAmount,
      paymentId,
      positionId
    );

    if (morphoResult.success) {
      // Success - update position to active
      await updatePosition(positionId, {
        status: 'active',
        morphoTxHash: morphoResult.gauntletTxHash || morphoResult.hyperithmTxHash,
        morphoAmount: amount,
        executedAt: new Date().toISOString()
      });

      return {
        success: true,
        positionId,
        avaxTxHash,
        morphoTxHash: morphoResult.gauntletTxHash || morphoResult.hyperithmTxHash
      };
    } else {
      // Failure - determine status based on partial success
      const finalStatus = avaxTxHash ? 'supply_failed' : 'failed';
      
      await updatePosition(positionId, {
        status: finalStatus,
        avaxTxHash,
        error: morphoResult.error || 'Morpho execution failed',
        errorType: 'transaction_failed' as const
      });

      return {
        success: false,
        positionId,
        avaxTxHash,
        error: morphoResult.error || 'Morpho execution failed',
        errorType: 'transaction_failed' as const
      };
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Aggressive flow execution failed', LogCategory.API, {
      walletAddress,
      amount,
      paymentId,
      error: errorMessage
    }, error instanceof Error ? error : new Error(errorMessage));

    return {
      success: false,
      error: errorMessage,
      errorType: 'unknown'
    };
  }
}

/**
 * Queue aggressive strategy for async processing
 */
export async function queueAggressiveStrategy(
  positionId: string,
  walletAddress: string,
  amount: number,
  paymentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const redis = await getRedis();
    const strategyRequest = {
      positionId,
      walletAddress,
      amount,
      paymentId,
      strategyType: 'aggressive',
      createdAt: new Date().toISOString()
    };

    await redis.lpush('morpho_strategy_queue', JSON.stringify(strategyRequest));
    
    await updatePosition(positionId, {
      status: 'executing'
    });

    logger.info('Aggressive strategy queued', LogCategory.API, {
      positionId,
      walletAddress,
      amount
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to queue aggressive strategy', LogCategory.API, {
      positionId,
      error: errorMessage
    });

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Process queued aggressive strategies
 */
export async function processAggressiveQueue(): Promise<{
  processed: number;
  successful: number;
  failed: number;
}> {
  try {
    const redis = await getRedis();
    let processed = 0;
    let successful = 0;
    let failed = 0;

    while (true) {
      // Dequeue next job
      const jobStr = await redis.rpop('morpho_strategy_queue');
      if (!jobStr) break;

      try {
        const job = JSON.parse(jobStr);
        const result = await executeAggressiveFlow(
          job.walletAddress,
          job.amount,
          job.paymentId,
          job.userEmail || ''
        );

        processed++;
        if (result.success) {
          successful++;
        } else {
          failed++;
        }
      } catch (error) {
        failed++;
        logger.error('Failed to process aggressive strategy job', LogCategory.API, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { processed, successful, failed };
  } catch (error) {
    logger.error('Aggressive queue processing failed', LogCategory.API, {
      error: error instanceof Error ? error.message : String(error)
    });

    return { processed: 0, successful: 0, failed: 0 };
  }
}
