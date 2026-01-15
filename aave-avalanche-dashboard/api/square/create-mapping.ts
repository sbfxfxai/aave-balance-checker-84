/**
 * Create Square to Frontend Payment Mapping
 * 
 * This endpoint creates a mapping from Square payment ID to frontend payment ID
 * to help the webhook find payment info when it receives order events
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { squareId, frontendId } = req.body;

  if (!squareId || !frontendId) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: ['squareId', 'frontendId']
    });
  }

  try {
    const redis = await getRedis();
    const pipeline = redis.pipeline();

    // Create mapping from Square ID to frontend ID
    const mappingKey = `square_to_frontend:${squareId}`;
    pipeline.set(mappingKey, frontendId, { ex: 24 * 60 * 60 }); // 24 hours

    // Also store payment_info with Square ID as key for direct lookup
    const frontendPaymentInfoKey = `payment_info:${frontendId}`;
    const paymentInfo = await redis.get(frontendPaymentInfoKey);
    
    if (paymentInfo) {
      const squarePaymentInfoKey = `payment_info:${squareId}`;
      pipeline.set(squarePaymentInfoKey, paymentInfo, { ex: 24 * 60 * 60 });
    }
    
    // Execute all operations atomically
    await pipeline.exec();
    
    if (paymentInfo) {
      console.log('[CreateMapping] ✅ Also stored payment_info with Square ID key');
    }

    console.log('[CreateMapping] ✅ Created mapping:', { squareId, frontendId });

    return res.status(200).json({
      success: true,
      message: 'Mapping created successfully',
      squareId,
      frontendId,
      mappingKey,
      hasPaymentInfo: !!paymentInfo
    });

  } catch (error) {
    console.error('[CreateMapping] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
