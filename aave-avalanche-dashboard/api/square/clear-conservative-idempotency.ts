/**
 * Clear Conservative Transfer Idempotency
 * 
 * This endpoint clears the idempotency key for a specific payment ID
 * to allow reprocessing of the conservative flow for testing
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentId, squareId } = req.body;

  if (!paymentId && !squareId) {
    return res.status(400).json({ 
      error: 'Missing paymentId or squareId',
      example: { paymentId: 'payment-123' },
      example2: { squareId: '737pjFr7koP6U0j7pIKFiMgwWo7YY' }
    });
  }

  try {
    const redis = await getRedis();

    const keysToDelete = [];
    
    if (paymentId) {
      keysToDelete.push(`conservative_flow_executed:${paymentId}`);
      keysToDelete.push(`processed_payment:${paymentId}`);
    }
    
    if (squareId) {
      keysToDelete.push(`conservative_flow_executed:${squareId}`);
      keysToDelete.push(`processed_payment:${squareId}`);
    }

    console.log('[Clear-Idempotency] Clearing keys:', keysToDelete);

    const results = [];
    for (const key of keysToDelete) {
      try {
        const existed = await redis.del(key);
        results.push({ key, deleted: existed > 0 });
      } catch (error) {
        results.push({ key, error: error instanceof Error ? error.message : String(error) });
      }
    }

    console.log('[Clear-Idempotency] Results:', results);

    return res.status(200).json({
      success: true,
      message: 'Idempotency keys cleared',
      paymentId,
      squareId,
      results
    });

  } catch (error) {
    console.error('[Clear-Idempotency] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
