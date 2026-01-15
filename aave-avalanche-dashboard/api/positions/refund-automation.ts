/**
 * Refund Automation for gas_sent_cap_failed Positions
 * 
 * Automatically processes refunds for positions where:
 * - AVAX was sent for gas
 * - Aave supply failed due to supply cap
 * - User is eligible for AVAX refund (minus fees)
 * 
 * This can be triggered via:
 * - Cron job (Vercel Cron)
 * - Manual API endpoint
 * - Scheduled task
 */

import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { getPosition, updatePosition, getAllPositions, PositionStatus } from './store';
import { ethers } from 'ethers';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || process.env.AVALANCHE_RPC || 'https://api.avax.network/ext/bc/C/rpc';
const HUB_WALLET_PRIVATE_KEY = process.env.HUB_WALLET_PRIVATE_KEY;
const REFUND_FEE_AVAX = ethers.parseUnits('0.0001', 18); // Small fee to cover gas for refund tx
const MIN_REFUND_AMOUNT = ethers.parseUnits('0.001', 18); // Don't refund if less than 0.001 AVAX
const MAX_REFUND_AGE_HOURS = 24; // Only refund positions older than 24 hours (prevents race conditions)

/**
 * Get positions by status
 */
export async function getPositionsByStatus(status: string): Promise<any[]> {
  try {
    const redis = await getRedis();
    const allPositions = await getAllPositions();
    return allPositions.filter(p => p.status === status);
  } catch (error) {
    logger.error('Failed to get positions by status', LogCategory.DATABASE, {
      status,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Process refund for a single position
 */
async function processRefund(position: any): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
  refundAmount?: string;
}> {
  try {
    if (!position.walletAddress || !position.avaxTxHash) {
      return {
        success: false,
        error: 'Missing wallet address or AVAX transaction hash'
      };
    }

    // Check position age (prevent refunding too quickly)
    const positionAge = Date.now() - new Date(position.createdAt || position.timestamp || 0).getTime();
    const minAge = MAX_REFUND_AGE_HOURS * 60 * 60 * 1000;
    
    if (positionAge < minAge) {
      return {
        success: false,
        error: `Position too new (${Math.floor(positionAge / 1000 / 60)} minutes old). Minimum age: ${MAX_REFUND_AGE_HOURS} hours`
      };
    }

    // Get provider
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    
    // Get AVAX transaction to determine amount sent
    const avaxTx = await provider.getTransaction(position.avaxTxHash);
    if (!avaxTx) {
      return {
        success: false,
        error: 'Could not retrieve AVAX transaction'
      };
    }

    const amountSent = avaxTx.value;
    const refundAmount = amountSent - REFUND_FEE_AVAX;

    // Check if refund amount is worth processing
    if (refundAmount < MIN_REFUND_AMOUNT) {
      return {
        success: false,
        error: `Refund amount too small: ${ethers.formatEther(refundAmount)} AVAX (minimum: ${ethers.formatEther(MIN_REFUND_AMOUNT)})`
      };
    }

    // Check current balance of user wallet
    const userBalance = await provider.getBalance(position.walletAddress);
    
    // If user already spent the AVAX, skip refund
    if (userBalance < amountSent * BigInt(50) / BigInt(100)) { // Less than 50% remaining
      logger.info('User wallet balance low - AVAX may have been spent', LogCategory.API, {
        positionId: position.id,
        walletAddress: position.walletAddress,
        expectedAmount: ethers.formatEther(amountSent),
        currentBalance: ethers.formatEther(userBalance)
      });
      // Still process refund but log it
    }

    // Initialize hub wallet
    if (!HUB_WALLET_PRIVATE_KEY) {
      throw new Error('HUB_WALLET_PRIVATE_KEY not configured');
    }
    const hubWallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);

    // Check hub wallet balance
    const hubBalance = await provider.getBalance(hubWallet.address);
    if (hubBalance < refundAmount + ethers.parseUnits('0.001', 18)) { // Need gas too
      return {
        success: false,
        error: 'Insufficient hub wallet balance for refund'
      };
    }

    // Send refund transaction
    const refundTx = await hubWallet.sendTransaction({
      to: position.walletAddress,
      value: refundAmount
    });

    const receipt = await refundTx.wait(1);

    if (!receipt || receipt.status !== 1) {
      return {
        success: false,
        error: 'Refund transaction failed on-chain'
      };
    }

    // Update position status
    await updatePosition(position.id, {
      status: 'failed_refund_pending',
      refundTxHash: refundTx.hash,
      refundAmount: ethers.formatEther(refundAmount),
      refundedAt: new Date().toISOString()
    });

    logger.info('Refund processed successfully', LogCategory.API, {
      positionId: position.id,
      walletAddress: position.walletAddress,
      refundAmount: ethers.formatEther(refundAmount),
      txHash: refundTx.hash
    });

    return {
      success: true,
      txHash: refundTx.hash,
      refundAmount: ethers.formatEther(refundAmount)
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Refund processing failed', LogCategory.API, {
      positionId: position.id,
      error: errorMessage
    }, error instanceof Error ? error : new Error(errorMessage));

    return {
      success: false,
      error: errorMessage
    };
  }
}

/**
 * Process all eligible refunds
 */
export async function processAllRefunds(): Promise<{
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  results: Array<{ positionId: string; success: boolean; txHash?: string; error?: string }>;
}> {
  try {
    // Get all positions with gas_sent_cap_failed status
    const positions = await getPositionsByStatus('gas_sent_cap_failed');
    
    logger.info('Starting refund processing', LogCategory.API, {
      totalPositions: positions.length
    });

    const results: Array<{ positionId: string; success: boolean; txHash?: string; error?: string }> = [];
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    for (const position of positions) {
      // Skip if already refunded
      if (position.refundTxHash) {
        skipped++;
        continue;
      }

      const result = await processRefund(position);
      
      results.push({
        positionId: position.id,
        success: result.success,
        txHash: result.txHash,
        error: result.error
      });

      if (result.success) {
        successful++;
      } else {
        failed++;
        // Log specific error reasons
        if (result.error?.includes('too new')) {
          skipped++; // Count as skipped, not failed
        }
      }

      // Small delay between refunds to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.info('Refund processing completed', LogCategory.API, {
      total: positions.length,
      successful,
      failed,
      skipped
    });

    return {
      processed: positions.length,
      successful,
      failed,
      skipped,
      results
    };

  } catch (error) {
    logger.error('Refund batch processing failed', LogCategory.API, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));

    return {
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      results: []
    };
  }
}

/**
 * API endpoint handler for refund automation
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<VercelResponse> {
  // Require authentication token for security
  const authToken = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.REFUND_AUTOMATION_TOKEN;

  if (expectedToken && authToken !== expectedToken) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  if (req.method === 'POST') {
    // Process all refunds
    const result = await processAllRefunds();
    return res.status(200).json({
      success: true,
      ...result
    });
  } else if (req.method === 'GET') {
    // Get status of refund-eligible positions
    const positions = await getPositionsByStatus('gas_sent_cap_failed');
    const eligible = positions.filter(p => {
      if (p.refundTxHash) return false; // Already refunded
      const age = Date.now() - new Date(p.createdAt || p.timestamp || 0).getTime();
      return age >= MAX_REFUND_AGE_HOURS * 60 * 60 * 1000;
    });

    return res.status(200).json({
      success: true,
      total: positions.length,
      eligible: eligible.length,
      positions: eligible.map(p => ({
        id: p.id,
        walletAddress: p.walletAddress,
        avaxTxHash: p.avaxTxHash,
        createdAt: p.createdAt || p.timestamp,
        ageHours: Math.floor((Date.now() - new Date(p.createdAt || p.timestamp || 0).getTime()) / (1000 * 60 * 60))
      }))
    });
  } else {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }
}
