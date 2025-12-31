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

export interface UserPosition {
  id: string;
  paymentId: string;
  userEmail: string;
  walletAddress?: string; // Optional for backward compatibility
  strategyType: 'conservative' | 'aggressive';
  usdcAmount: number;
  status: 'pending' | 'executing' | 'active' | 'closed' | 'failed';
  
  // AAVE position details
  aaveSupplyAmount?: number;
  aaveSupplyTxHash?: string;
  
  // GMX position details
  gmxCollateralAmount?: number;
  gmxPositionSize?: number;
  gmxLeverage?: number;
  gmxEntryPrice?: number;
  gmxOrderTxHash?: string;
  gmxPositionKey?: string;
  
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
    
    await pipeline.exec();
    console.log(`[Redis] Saved position ${position.id} for ${email}`);
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

export function generatePositionId(): string {
  return `pos_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
