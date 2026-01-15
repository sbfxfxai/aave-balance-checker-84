/**
 * Dead-Letter Queue Reprocess Endpoint
 * 
 * Allows manual reprocessing of failed payment jobs for support/recovery
 * Requires authentication (API key or admin token)
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { getRedis } from '../utils/redis';

const REPROCESS_API_KEY = process.env.REPROCESS_API_KEY || process.env.ADMIN_API_KEY;
const PAYMENT_DEAD_LETTER_QUEUE_KEY = process.env.PAYMENT_DEAD_LETTER_QUEUE_KEY || 'payment_dead_letter_queue';
const PAYMENT_JOB_PREFIX = process.env.PAYMENT_JOB_PREFIX || 'payment_job:';
const PAYMENT_QUEUE_KEY = process.env.PAYMENT_QUEUE_KEY || 'payment_processing_queue';

interface PaymentJob {
  id: string;
  paymentId: string;
  eventData: any;
  parsedNote: any;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  lastAttemptAt?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
  result?: any;
}

/**
 * Authenticate request for reprocessing
 */
function authenticateRequest(req: VercelRequest): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return false;
  }
  
  // Check Bearer token
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return token === REPROCESS_API_KEY;
  }
  
  // Check API key header
  const apiKey = req.headers['x-api-key'] as string;
  if (apiKey && apiKey === REPROCESS_API_KEY) {
    return true;
  }
  
  return false;
}

/**
 * List dead-letter queue jobs
 */
async function listDeadLetterJobs(limit: number = 50): Promise<PaymentJob[]> {
  try {
    const redis = await getRedis();
    const jobIds = await redis.lrange(PAYMENT_DEAD_LETTER_QUEUE_KEY, 0, limit - 1);
    
    if (!jobIds || jobIds.length === 0) {
      return [];
    }
    
    const jobDataPromises = jobIds.map((jobId: string) => redis.get(`${PAYMENT_JOB_PREFIX}${jobId}`));
    const jobDataArray = await Promise.all(jobDataPromises);
    
    const jobs = jobDataArray
      .filter(Boolean)
      .map((data: any) => {
        try {
          return JSON.parse(data as string) as PaymentJob;
        } catch {
          return null;
        }
      })
      .filter((job: any): job is PaymentJob => job !== null);
    
    return jobs;
  } catch (error) {
    console.error('[Reprocess] Failed to list dead-letter jobs:', error);
    throw error;
  }
}

/**
 * Reprocess a specific job from dead-letter queue
 */
async function reprocessJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const redis = await getRedis();
    
    // Get job data
    const jobDataStr = await redis.get(`${PAYMENT_JOB_PREFIX}${jobId}`);
    if (!jobDataStr) {
      return { success: false, error: 'Job not found' };
    }
    
    const job: PaymentJob = JSON.parse(jobDataStr);
    
    // Check if job is in dead-letter queue
    const deadLetterJobs = await redis.lrange(PAYMENT_DEAD_LETTER_QUEUE_KEY, 0, -1);
    if (!deadLetterJobs.includes(jobId)) {
      return { success: false, error: 'Job not in dead-letter queue' };
    }
    
    // Remove from dead-letter queue
    await redis.lrem(PAYMENT_DEAD_LETTER_QUEUE_KEY, 1, jobId);
    
    // Reset job status for reprocessing
    job.status = 'pending';
    job.attempts = 0; // Reset attempts
    job.error = undefined;
    job.lastAttemptAt = undefined;
    
    // Save updated job
    await redis.set(`${PAYMENT_JOB_PREFIX}${jobId}`, JSON.stringify(job), { ex: 86400 });
    
    // Add back to processing queue
    await redis.lpush(PAYMENT_QUEUE_KEY, jobId);
    
    console.log(`[Reprocess] Job ${jobId} reprocessed successfully`);
    
    return { success: true };
  } catch (error) {
    console.error('[Reprocess] Failed to reprocess job:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reprocess job'
    };
  }
}

/**
 * Get dead-letter queue metrics
 */
async function getDeadLetterMetrics(): Promise<{
  totalJobs: number;
  oldestJobAge?: number;
  jobsByStatus: Record<string, number>;
}> {
  try {
    const redis = await getRedis();
    const jobIds = await redis.lrange(PAYMENT_DEAD_LETTER_QUEUE_KEY, 0, -1);
    
    if (!jobIds || jobIds.length === 0) {
      return {
        totalJobs: 0,
        jobsByStatus: {}
      };
    }
    
    const jobDataPromises = jobIds.map((jobId: string) => redis.get(`${PAYMENT_JOB_PREFIX}${jobId}`));
    const jobDataArray = await Promise.all(jobDataPromises);
    
    const jobs = jobDataArray
      .filter(Boolean)
      .map((data: any) => {
        try {
          return JSON.parse(data as string) as PaymentJob;
        } catch {
          return null;
        }
      })
      .filter((job: any): job is PaymentJob => job !== null);
    
    // Calculate oldest job age
    let oldestJobAge: number | undefined;
    if (jobs.length > 0) {
      const oldestJob = jobs.reduce((oldest: any, current: any) => 
        new Date(current.createdAt) < new Date(oldest.createdAt) ? current : oldest
      );
      oldestJobAge = Date.now() - new Date(oldestJob.createdAt).getTime();
    }
    
    // Count by status
    const jobsByStatus: Record<string, number> = {};
    jobs.forEach((job: any) => {
      jobsByStatus[job.status] = (jobsByStatus[job.status] || 0) + 1;
    });
    
    return {
      totalJobs: jobs.length,
      oldestJobAge,
      jobsByStatus
    };
  } catch (error) {
    console.error('[Reprocess] Failed to get metrics:', error);
    throw error;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<VercelResponse> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Authentication required
  if (!authenticateRequest(req)) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized - API key required'
    });
  }
  
  try {
    if (req.method === 'GET') {
      // List dead-letter jobs or get metrics
      const action = req.query.action as string;
      
      if (action === 'metrics') {
        const metrics = await getDeadLetterMetrics();
        return res.status(200).json({
          success: true,
          metrics
        });
      }
      
      // List jobs
      const limit = parseInt(req.query.limit as string || '50', 10);
      const jobs = await listDeadLetterJobs(limit);
      
      return res.status(200).json({
        success: true,
        jobs,
        count: jobs.length
      });
    }
    
    if (req.method === 'POST') {
      // Reprocess job(s)
      const { jobId, jobIds } = req.body;
      
      if (jobIds && Array.isArray(jobIds)) {
        // Bulk reprocess
        const results = await Promise.all(
          jobIds.map(id => reprocessJob(id))
        );
        
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.length - successCount;
        
        return res.status(200).json({
          success: true,
          reprocessed: successCount,
          failed: failureCount,
          results
        });
      }
      
      if (jobId) {
        // Single job reprocess
        const result = await reprocessJob(jobId);
        
        if (result.success) {
          return res.status(200).json({
            success: true,
            message: `Job ${jobId} reprocessed successfully`
          });
        } else {
          return res.status(400).json({
            success: false,
            error: result.error
          });
        }
      }
      
      return res.status(400).json({
        success: false,
        error: 'Missing jobId or jobIds in request body'
      });
    }
    
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  } catch (error) {
    console.error('[Reprocess] Handler error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
}
