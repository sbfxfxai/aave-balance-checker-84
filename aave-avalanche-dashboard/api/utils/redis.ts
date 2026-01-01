/**
 * Redis utilities for caching and data storage
 */

import { Redis } from '@upstash/redis';

export interface RedisConfig {
  url: string;
  token: string;
  defaultTtl?: number;
}

export interface CacheOptions {
  ttl?: number;
  nx?: boolean; // Set if not exists
  xx?: boolean; // Set if exists
}

class RedisManager {
  private client: Redis;
  private defaultTtl: number;

  constructor(config: RedisConfig) {
    this.client = new Redis({
      url: config.url,
      token: config.token,
      retry: {
        retries: 3,
        backoff: (retryCount: number) => 1000
      }
    });
    this.defaultTtl = config.defaultTtl || 3600; // 1 hour default
  }

  /**
   * Set key-value pair
   */
  async set(key: string, value: any, options: CacheOptions = {}): Promise<void> {
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
      const ttl = options.ttl || this.defaultTtl;
      
      if (options.nx) {
        await this.client.set(key, serializedValue, { ex: ttl, nx: true });
      } else if (options.xx) {
        await this.client.set(key, serializedValue, { ex: ttl, xx: true });
      } else {
        await this.client.set(key, serializedValue, { ex: ttl });
      }
    } catch (error) {
      console.error('[Redis] Set error:', error);
      throw new Error(`Failed to set key ${key}: ${error}`);
    }
  }

  /**
   * Get value by key
   */
  async get(key: string): Promise<any> {
    try {
      const value = await this.client.get(key);
      if (value === null) return null;
      
      // Try to parse as JSON, fallback to string
      try {
        return JSON.parse(value as string);
      } catch {
        return value;
      }
    } catch (error) {
      console.error('[Redis] Get error:', error);
      return null;
    }
  }

  /**
   * Delete key
   */
  async del(key: string): Promise<boolean> {
    try {
      const result = await this.client.del(key);
      return result > 0;
    } catch (error) {
      console.error('[Redis] Delete error:', error);
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result > 0;
    } catch (error) {
      console.error('[Redis] Exists error:', error);
      return false;
    }
  }

  /**
   * Set expiration on key
   */
  async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, ttl);
      return result > 0;
    } catch (error) {
      console.error('[Redis] Expire error:', error);
      return false;
    }
  }

  /**
   * Get remaining TTL for key
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      console.error('[Redis] TTL error:', error);
      return -1;
    }
  }

  /**
   * Increment numeric value
   */
  async incr(key: string, amount: number = 1): Promise<number> {
    try {
      if (amount === 1) {
        return await this.client.incr(key);
      } else {
        return await this.client.incrby(key, amount);
      }
    } catch (error) {
      console.error('[Redis] Increment error:', error);
      throw new Error(`Failed to increment key ${key}: ${error}`);
    }
  }

  /**
   * Add to list
   */
  async lpush(key: string, ...values: any[]): Promise<number> {
    try {
      const serializedValues = values.map(v => 
        typeof v === 'string' ? v : JSON.stringify(v)
      );
      return await this.client.lpush(key, ...serializedValues);
    } catch (error) {
      console.error('[Redis] LPush error:', error);
      throw new Error(`Failed to lpush to key ${key}: ${error}`);
    }
  }

  /**
   * Get list range
   */
  async lrange(key: string, start: number = 0, stop: number = -1): Promise<any[]> {
    try {
      const values = await this.client.lrange(key, start, stop);
      return values.map(v => {
        try {
          return JSON.parse(v as string);
        } catch {
          return v;
        }
      });
    } catch (error) {
      console.error('[Redis] LRange error:', error);
      return [];
    }
  }

  /**
   * Add to set
   */
  async sadd(key: string, ...members: any[]): Promise<number> {
    try {
      const serializedMembers = members.map(m => 
        typeof m === 'string' ? m : JSON.stringify(m)
      );
      return await this.client.sadd(key, serializedMembers);
    } catch (error) {
      console.error('[Redis] SAdd error:', error);
      throw new Error(`Failed to sadd to key ${key}: ${error}`);
    }
  }

  /**
   * Get set members
   */
  async smembers(key: string): Promise<any[]> {
    try {
      const members = await this.client.smembers(key);
      return members.map(m => {
        try {
          return JSON.parse(m as string);
        } catch {
          return m;
        }
      });
    } catch (error) {
      console.error('[Redis] SMembers error:', error);
      return [];
    }
  }

  /**
   * Get multiple keys
   */
  async mget(...keys: string[]): Promise<any[]> {
    try {
      const values = await this.client.mget(...keys);
      return values.map(v => {
        if (v === null) return null;
        try {
          return JSON.parse(v as string);
        } catch {
          return v;
        }
      });
    } catch (error) {
      console.error('[Redis] MGet error:', error);
      return new Array(keys.length).fill(null);
    }
  }

  /**
   * Pipeline multiple commands
   */
  async pipeline(commands: Array<{ type: string; args: any[] }>): Promise<any[]> {
    try {
      const pipe = this.client.pipeline();
      
      commands.forEach(cmd => {
        switch (cmd.type) {
          case 'set':
            pipe.set(cmd.args[0], cmd.args[1], cmd.args[2] || {});
            break;
          case 'get':
            pipe.get(cmd.args[0]);
            break;
          case 'del':
            pipe.del(cmd.args[0]);
            break;
          case 'incr':
            pipe.incr(cmd.args[0]);
            break;
          case 'expire':
            pipe.expire(cmd.args[0], cmd.args[1]);
            break;
          default:
            console.warn(`[Redis] Unknown pipeline command type: ${cmd.type}`);
        }
      });

      return await pipe.exec();
    } catch (error) {
      console.error('[Redis] Pipeline error:', error);
      throw new Error(`Pipeline execution failed: ${error}`);
    }
  }

  /**
   * Clear all keys (use with caution)
   */
  async flush(): Promise<void> {
    try {
      await this.client.flushdb();
    } catch (error) {
      console.error('[Redis] Flush error:', error);
      throw new Error(`Failed to flush database: ${error}`);
    }
  }

  /**
   * Check Redis connection health
   */
  async ping(): Promise<string> {
    try {
      return await this.client.ping();
    } catch (error) {
      console.error('[Redis] Ping error:', error);
      throw new Error(`Redis health check failed: ${error}`);
    }
  }
}

// Default Redis instance
export const redis = new RedisManager({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '',
  defaultTtl: 3600
});

// Convenience functions for common operations
export const cache = {
  set: (key: string, value: any, ttl?: number) => redis.set(key, value, { ttl }),
  get: (key: string) => redis.get(key),
  del: (key: string) => redis.del(key),
  exists: (key: string) => redis.exists(key),
  incr: (key: string, amount?: number) => redis.incr(key, amount),
  
  // Session cache
  session: {
    set: (sessionId: string, data: any, ttl: number = 86400) => 
      redis.set(`session:${sessionId}`, data, { ttl }),
    get: (sessionId: string) => redis.get(`session:${sessionId}`),
    del: (sessionId: string) => redis.del(`session:${sessionId}`)
  },
  
  // User cache
  user: {
    set: (userId: string, data: any, ttl: number = 3600) => 
      redis.set(`user:${userId}`, data, { ttl }),
    get: (userId: string) => redis.get(`user:${userId}`),
    del: (userId: string) => redis.del(`user:${userId}`)
  },
  
  // Rate limiting
  rateLimit: {
    incr: (key: string, window: number = 3600) => {
      const fullKey = `rate_limit:${key}`;
      return redis.incr(fullKey).then(count => {
        redis.expire(fullKey, window);
        return count;
      });
    },
    check: (key: string, limit: number, window: number = 3600) => 
      redis.incr(`rate_limit:${key}`).then(count => {
        if (count === 1) {
          redis.expire(`rate_limit:${key}`, window);
        }
        return count <= limit;
      })
  }
};
