// Position storage using Redis for persistence across serverless invocations

// Lazy-initialize Upstash Redis client
let _redis: any = null;
async function getRedis(): Promise<any> {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    
    if (!url || !token) {
      throw new Error('Redis not configured: KV_REST_API_URL and KV_REST_API_TOKEN required');
    }
    
    // Dynamic import to avoid issues in some environments
    const { Redis } = await import('@upstash/redis');
    _redis = new Redis({ url, token });
  }
  return _redis;
}

const POSITION_TTL = 90 * 24 * 60 * 60; // 90 days in seconds
const GLOBAL_POSITIONS_RETENTION_DAYS = 90; // Keep global sorted set entries for 90 days
const GLOBAL_POSITIONS_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // Run cleanup daily (in ms)

// Position status type for type safety
export type PositionStatus = 
  | 'pending' 
  | 'pending_email'
  | 'executing' 
  | 'avax_sent' 
  | 'supply_failed' 
  | 'gas_sent_cap_failed' 
  | 'active' 
  | 'withdrawn' 
  | 'closed' 
  | 'failed' 
  | 'failed_refund_pending';

export interface UserPosition {
  id: string;
  paymentId: string;
  userEmail: string;
  walletAddress?: string; // Optional for backward compatibility
  strategyType: 'conservative' | 'aggressive';
  usdcAmount: number;
  status: PositionStatus;
  
  // AAVE position details
  aaveSupplyAmount?: number;
  aaveSupplyTxHash?: string;
  
  // Morpho position details
  morphoAmount?: number;
  morphoTxHash?: string;
  
  // GMX position details
  gmxCollateralAmount?: number;
  gmxPositionSize?: number;
  gmxLeverage?: number;
  gmxEntryPrice?: number;
  gmxOrderTxHash?: string;
  gmxPositionKey?: string;
  
  // Transaction hashes for partial success tracking
  avaxTxHash?: string; // AVAX transfer tx hash (if sent but Aave failed)
  
  // Refund tracking
  refundTxHash?: string; // Refund transaction hash
  refundAmount?: string; // Refund amount in AVAX (formatted)
  refundedAt?: string; // When refund was processed
  
  // Retry metadata
  retryCount?: number;
  lastAttemptedAt?: string;
  errorType?: 'idempotent' | 'insufficient_balance' | 'supply_cap' | 'reserve_paused' | 'network_error' | 'approval_failed' | 'transaction_failed' | 'unknown';
  
  // Timestamps
  createdAt: string;
  executedAt?: string;
  closedAt?: string;
  
  // Error tracking
  error?: string;
}

export async function savePosition(position: UserPosition): Promise<void> {
  try {
    const redis = await getRedis();
    const pipeline = redis.pipeline();
    
    // Convert createdAt to timestamp for sorted set
    const createdAtTimestamp = new Date(position.createdAt).getTime();
    
    // Save the position object
    pipeline.set(`position:${position.id}`, position, { ex: POSITION_TTL });
    
    // Add to email index
    const email = position.userEmail.toLowerCase();
    pipeline.sadd(`user:${email}:positions`, position.id);
    
    // Add to wallet index if present
    if (position.walletAddress) {
      const wallet = position.walletAddress.toLowerCase();
      pipeline.sadd(`wallet:${wallet}:positions`, position.id);
    }
    
    // Add to global list for admin/debugging (capped at 1000 items)
    pipeline.lpush('global:positions', position.id);
    pipeline.ltrim('global:positions', 0, 999);
    
    // Add to sorted set for time-range queries (score = timestamp)
    // Enables queries like "recent positions in last 24h" or "positions by date range"
    // Store with lightweight hash for integrity checks: id:hash
    const positionHash = generatePositionHash(position);
    pipeline.zadd('positions:by_time', { 
      score: createdAtTimestamp, 
      member: `${position.id}:${positionHash}` 
    });
    pipeline.expire('positions:by_time', POSITION_TTL); // Match position TTL
    
    // Add to sorted set per email for time-ordered user queries
    pipeline.zadd(`user:${email}:positions:by_time`, { 
      score: createdAtTimestamp, 
      member: position.id 
    });
    pipeline.expire(`user:${email}:positions:by_time`, POSITION_TTL);
    
    // Add to sorted set per wallet if present
    if (position.walletAddress) {
      const wallet = position.walletAddress.toLowerCase();
      pipeline.zadd(`wallet:${wallet}:positions:by_time`, { 
        score: createdAtTimestamp, 
        member: position.id 
      });
      pipeline.expire(`wallet:${wallet}:positions:by_time`, POSITION_TTL);
    }
    
    await pipeline.exec();
    console.log(`[Redis] Saved position ${position.id} for ${email} (timestamp: ${createdAtTimestamp})`);
  } catch (error) {
    console.error('[Redis] Error saving position:', error);
    // Fallback to in-memory if Redis fails (though data will be lost on cold start)
    // In a real production app, we might want to throw here or use a better fallback
  }
}

export async function getPosition(id: string): Promise<UserPosition | null> {
  try {
    const redis = await getRedis();
    return await redis.get(`position:${id}`);
  } catch (error) {
    console.error('[Redis] Error getting position:', error);
    return null;
  }
}

export async function getPositionsByEmail(email: string): Promise<UserPosition[]> {
  try {
    const redis = await getRedis();
    const normalizedEmail = email.toLowerCase();
    
    // Get all position IDs for this email
    const ids = await redis.smembers(`user:${normalizedEmail}:positions`);
    if (!ids || ids.length === 0) return [];
    
    // Fetch all positions in parallel
    // @upstash/redis mget takes separate arguments, not an array
    const positions = await redis.mget(...ids.map((id: string) => `position:${id}`));
    return positions.filter(Boolean) as UserPosition[];
  } catch (error) {
    console.error('[Redis] Error getting positions by email:', error);
    return [];
  }
}

export async function getPositionsByWallet(walletAddress: string): Promise<UserPosition[]> {
  try {
    const redis = await getRedis();
    const normalizedWallet = walletAddress.toLowerCase();
    
    // Get all position IDs for this wallet
    const ids = await redis.smembers(`wallet:${normalizedWallet}:positions`);
    if (!ids || ids.length === 0) return [];
    
    // Fetch all positions in parallel
    const positions = await redis.mget(...ids.map((id: string) => `position:${id}`));
    return positions.filter(Boolean) as UserPosition[];
  } catch (error) {
    console.error('[Redis] Error getting positions by wallet:', error);
    return [];
  }
}

export async function updatePosition(id: string, updates: Partial<UserPosition>): Promise<UserPosition | null> {
  try {
    const existing = await getPosition(id);
    if (!existing) return null;
    
    const updated = { ...existing, ...updates };
    await savePosition(updated);
    return updated;
  } catch (error) {
    console.error('[Redis] Error updating position:', error);
    return null;
  }
}

export async function getAllPositions(): Promise<UserPosition[]> {
  try {
    const redis = await getRedis();
    // Get latest 100 positions from global list
    const ids = await redis.lrange('global:positions', 0, 99);
    if (!ids || ids.length === 0) return [];
    
    const positions = await redis.mget(...ids.map((id: string) => `position:${id}`));
    return positions.filter(Boolean) as UserPosition[];
  } catch (error) {
    console.error('[Redis] Error getting all positions:', error);
    return [];
  }
}

/**
 * Get positions by status
 */
export async function getPositionsByStatus(status: PositionStatus): Promise<UserPosition[]> {
  try {
    const redis = await getRedis();
    const allPositions = await getAllPositions();
    return allPositions.filter(p => p.status === status);
  } catch (error) {
    console.error('[Redis] Error getting positions by status:', error);
    return [];
  }
}

export function generatePositionId(): string {
  return `pos_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate lightweight hash of position data for integrity checks
 * Uses first 8 chars of SHA-256 hash for quick verification
 */
function generatePositionHash(position: UserPosition): string {
  const crypto = require('crypto');
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      id: position.id,
      paymentId: position.paymentId,
      usdcAmount: position.usdcAmount,
      status: position.status,
      createdAt: position.createdAt
    }))
    .digest('hex');
  return hash.substring(0, 8); // 8-char hash for lightweight storage
}

/**
 * Cleanup old entries from global positions sorted set
 * Prevents unbounded growth by removing entries older than retention period
 * Should be called periodically (e.g., daily via cron or scheduled function)
 */
export async function cleanupOldPositions(): Promise<{ removed: number; remaining: number }> {
  try {
    const redis = await getRedis();
    const now = Date.now();
    const cutoffTimestamp = now - (GLOBAL_POSITIONS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    // Remove entries older than retention period
    const removed = await redis.zremrangebyscore('positions:by_time', 0, cutoffTimestamp);
    
    // Get remaining count
    const remaining = await redis.zcard('positions:by_time');
    
    console.log(`[Redis] Cleaned up ${removed} old positions, ${remaining} remaining`);
    
    return { removed, remaining };
  } catch (error) {
    console.error('[Redis] Error cleaning up old positions:', error);
    return { removed: 0, remaining: 0 };
  }
}

/**
 * Verify position integrity by checking stored hash
 * Useful for audit/compliance checks
 */
export async function verifyPositionIntegrity(positionId: string): Promise<boolean> {
  try {
    const redis = await getRedis();
    const position = await redis.get(`position:${positionId}`);
    
    if (!position) {
      return false;
    }
    
    // Get stored hash from sorted set
    const entries = await redis.zrange('positions:by_time', 0, -1, { withScores: true });
    const storedEntry = entries.find((entry: any) => {
      const member = Array.isArray(entry) ? entry[0] : entry;
      return typeof member === 'string' && member.startsWith(`${positionId}:`);
    });
    
    if (!storedEntry) {
      return false; // Entry not in sorted set
    }
    
    // Extract stored hash
    const member = Array.isArray(storedEntry) ? storedEntry[0] : storedEntry;
    const storedHash = typeof member === 'string' ? member.split(':')[1] : null;
    
    if (!storedHash) {
      return false;
    }
    
    // Calculate current hash and compare
    const currentHash = generatePositionHash(position);
    return currentHash === storedHash;
  } catch (error) {
    console.error('[Redis] Error verifying position integrity:', error);
    return false;
  }
}

/**
 * Get recent positions within a time range
 * Useful for support queries, analytics, and admin dashboards
 */
export async function getRecentPositions(
  startTime: number,
  endTime: number,
  limit: number = 100
): Promise<UserPosition[]> {
  try {
    const redis = await getRedis();
    
    // Get position IDs in time range (sorted by timestamp, newest first)
    // Note: entries are stored as "id:hash", so we need to extract just the ID
    const entries = await redis.zrevrangebyscore(
      'positions:by_time',
      endTime, // max score
      startTime, // min score
      { limit: { offset: 0, count: limit } }
    );
    
    if (!entries || entries.length === 0) return [];
    
    // Extract position IDs (entries are stored as "id:hash")
    const ids = entries.map((entry: any) => {
      const member = typeof entry === 'string' ? entry : String(entry);
      if (member.includes(':')) {
        return member.split(':')[0]; // Extract ID before hash
      }
      return member; // Fallback for old format
    }).filter(Boolean);
    
    if (ids.length === 0) return [];
    
    // Fetch all positions in parallel
    const positions = await redis.mget(...ids.map((id: string) => `position:${id}`));
    return positions.filter(Boolean) as UserPosition[];
  } catch (error) {
    console.error('[Redis] Error getting recent positions:', error);
    return [];
  }
}

/**
 * Get positions by email, sorted by creation time (newest first)
 */
export async function getPositionsByEmailSorted(
  email: string,
  limit: number = 50
): Promise<UserPosition[]> {
  try {
    const redis = await getRedis();
    const normalizedEmail = email.toLowerCase();
    
    // Get position IDs sorted by timestamp (newest first)
    const ids = await redis.zrevrange(
      `user:${normalizedEmail}:positions:by_time`,
      0,
      limit - 1
    );
    
    if (!ids || ids.length === 0) return [];
    
    // Fetch all positions in parallel
    const positions = await redis.mget(...ids.map((id: string) => `position:${id}`));
    return positions.filter(Boolean) as UserPosition[];
  } catch (error) {
    console.error('[Redis] Error getting positions by email (sorted):', error);
    // Fallback to unsorted version
    return getPositionsByEmail(email);
  }
}

/**
 * Get positions by wallet, sorted by creation time (newest first)
 */
export async function getPositionsByWalletSorted(
  walletAddress: string,
  limit: number = 50
): Promise<UserPosition[]> {
  try {
    const redis = await getRedis();
    const normalizedWallet = walletAddress.toLowerCase();
    
    // Get position IDs sorted by timestamp (newest first)
    const ids = await redis.zrevrange(
      `wallet:${normalizedWallet}:positions:by_time`,
      0,
      limit - 1
    );
    
    if (!ids || ids.length === 0) return [];
    
    // Fetch all positions in parallel
    const positions = await redis.mget(...ids.map((id: string) => `position:${id}`));
    return positions.filter(Boolean) as UserPosition[];
  } catch (error) {
    console.error('[Redis] Error getting positions by wallet (sorted):', error);
    // Fallback to unsorted version
    return getPositionsByWallet(walletAddress);
  }
}
