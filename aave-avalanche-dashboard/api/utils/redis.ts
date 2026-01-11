import { Redis } from '@upstash/redis';
import { logger, LogCategory } from './logger';
import { errorTracker } from './errorTracker';

// Shared Redis client for endpoints that don't need Privy
let _redis: Redis | null = null;
let _redisError: string | null = null;
let _redisPromise: Promise<Redis> | null = null;
let _errorTimestamp: number | null = null;

// Configuration
const ERROR_RESET_TIMEOUT = 60000; // 1 minute
const CONNECTION_TIMEOUT = 5000; // 5 seconds

/**
 * Get the shared Redis client instance.
 * Initializes the client on first call with proper error handling and race condition prevention.
 * 
 * @returns Promise resolving to Redis client
 * @throws {Error} If Redis configuration is missing or initialization fails
 * 
 * @example
 * try {
 *   const redis = await getRedis();
 *   await redis.set('key', 'value');
 * } catch (error) {
 *   logger.error('Redis unavailable', LogCategory.DATABASE, {}, error);
 * }
 */
export async function getRedis(): Promise<Redis> {
  // Reset stale errors after timeout
  if (_redisError && _errorTimestamp) {
    if (Date.now() - _errorTimestamp > ERROR_RESET_TIMEOUT) {
      logger.info('Redis: Resetting error state after timeout', LogCategory.DATABASE);
      _redisError = null;
      _errorTimestamp = null;
    }
  }

  // Return cached error if still valid
  if (_redisError) {
    const error = new Error(_redisError);
    logger.error('Redis: Returning cached error', LogCategory.DATABASE, { error: _redisError });
    throw error;
  }

  // Return existing client if already initialized
  if (_redis) {
    return _redis;
  }

  // Prevent race conditions - if initialization is in progress, wait for it
  if (_redisPromise) {
    logger.debug('Redis: Initialization in progress, waiting...', LogCategory.DATABASE);
    return _redisPromise;
  }

  // Start initialization
  _redisPromise = (async () => {
    const startTime = Date.now();
    
    try {
      const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

      if (!url || !token) {
        const missingVars = [];
        if (!url) missingVars.push('KV_REST_API_URL or UPSTASH_REDIS_REST_URL');
        if (!token) missingVars.push('KV_REST_API_TOKEN or UPSTASH_REDIS_REST_TOKEN');
        
        const errorMsg = `Redis configuration missing: ${missingVars.join(' and ')} must be set`;
        _redisError = errorMsg;
        _errorTimestamp = Date.now();
        
        logger.error('Redis: Configuration missing', LogCategory.DATABASE, { missingVars });
        
        errorTracker.trackError(new Error(errorMsg), {
          category: 'database',
          context: { stage: 'redis_config', missingVars }
        });
        
        throw new Error(errorMsg);
      }

      logger.info('Redis: Initializing client', LogCategory.DATABASE, { url: url.replace(/\/\/.*@/, '//***@') });

      const redis = new Redis({ 
        url, 
        token,
        // Add connection timeout and retry options
        retry: {
          retries: 3,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 5000
        }
      });

      // Validate connection with a ping (with timeout)
      const pingPromise = redis.ping();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis connection timeout')), CONNECTION_TIMEOUT)
      );

      await Promise.race([pingPromise, timeoutPromise]);

      _redis = redis;
      
      logger.info('Redis: Connected and validated successfully', LogCategory.DATABASE, {
        duration: Date.now() - startTime
      });
      
      return _redis;
    } catch (error) {
      _redisError = error instanceof Error ? error.message : 'Failed to initialize Redis';
      _errorTimestamp = Date.now();
      
      logger.error('Redis: Initialization failed', LogCategory.DATABASE, {
        error: _redisError,
        duration: Date.now() - startTime
      }, error instanceof Error ? error : new Error(_redisError));
      
      errorTracker.trackError(error instanceof Error ? error : new Error(_redisError), {
        category: 'database',
        context: { stage: 'redis_initialization', duration: Date.now() - startTime }
      });
      
      throw error instanceof Error ? error : new Error(_redisError);
    } finally {
      // Clear the initialization promise
      _redisPromise = null;
    }
  })();

  return _redisPromise;
}

/**
 * Synchronous getter for cases where Redis is known to be initialized.
 * Use this only when you're certain Redis has been initialized previously.
 * 
 * @returns Redis client instance
 * @throws {Error} If Redis is not initialized or has errors
 * 
 * @example
 * // In hot paths where you know Redis is ready
 * const redis = getRedisSync();
 * await redis.get('key');
 */
export function getRedisSync(): Redis {
  if (_redisError) {
    throw new Error(_redisError);
  }
  if (!_redis) {
    throw new Error('Redis not initialized. Call getRedis() first.');
  }
  return _redis;
}

/**
 * Check if Redis client is ready without attempting initialization.
 * 
 * @returns true if Redis is initialized and no errors are present
 * 
 * @example
 * if (isRedisReady()) {
 *   const redis = getRedisSync();
 *   // Use redis...
 * } else {
 *   // Handle Redis not ready
 * }
 */
export function isRedisReady(): boolean {
  return _redis !== null && _redisError === null;
}

/**
 * Get the current Redis initialization status.
 * Useful for health checks and monitoring.
 * 
 * @returns Status object with initialization state
 */
export function getRedisStatus(): {
  initialized: boolean;
  ready: boolean;
  error: string | null;
  errorAge: number | null;
  hasUrl: boolean;
  hasToken: boolean;
} {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  
  return {
    initialized: _redis !== null,
    ready: isRedisReady(),
    error: _redisError,
    errorAge: _errorTimestamp ? Date.now() - _errorTimestamp : null,
    hasUrl: !!url,
    hasToken: !!token
  };
}

/**
 * Reset the Redis client state.
 * Useful for testing or recovering from persistent errors.
 * 
 * @example
 * // After fixing configuration issues
 * resetRedis();
 * const redis = await getRedis(); // Will retry initialization
 */
export function resetRedis(): void {
  const wasInitialized = _redis !== null;
  const hadError = _redisError !== null;
  
  _redis = null;
  _redisError = null;
  _redisPromise = null;
  _errorTimestamp = null;
  
  logger.info('Redis: State reset', LogCategory.DATABASE, {
    wasInitialized,
    hadError
  });
}

/**
 * Disconnect and clean up the Redis client.
 * Note: Upstash REST API is stateless, so this mainly clears the local instance.
 * 
 * @example
 * // In application shutdown
 * disconnectRedis();
 */
export function disconnectRedis(): void {
  if (_redis) {
    logger.info('Redis: Disconnecting', LogCategory.DATABASE);
    _redis = null;
  }
  
  resetRedis();
}

/**
 * Test Redis connectivity with a simple operation.
 * Useful for health checks and diagnostics.
 * 
 * @returns Promise resolving to true if Redis is working
 * 
 * @example
 * const isHealthy = await testRedisConnectivity();
 * if (!isHealthy) {
 *   // Handle Redis issues
 * }
 */
export async function testRedisConnectivity(): Promise<boolean> {
  try {
    const redis = await getRedis();
    
    // Test basic operations
    const testKey = 'health_check_' + Date.now();
    const testValue = 'ok';
    
    await redis.set(testKey, testValue, { ex: 10 }); // Expire in 10 seconds
    const result = await redis.get(testKey);
    
    if (result === testValue) {
      logger.info('Redis: Connectivity test passed', LogCategory.DATABASE);
      return true;
    } else {
      logger.error('Redis: Connectivity test failed - value mismatch', LogCategory.DATABASE, {
        expected: testValue,
        actual: result
      });
      return false;
    }
  } catch (error) {
    logger.error('Redis: Connectivity test failed', LogCategory.DATABASE, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

/**
 * Get Redis performance metrics.
 * Useful for monitoring and optimization.
 * 
 * @returns Promise resolving to performance metrics
 */
export async function getRedisMetrics(): Promise<{
  connected: boolean;
  lastErrorAge: number | null;
  configurationStatus: 'complete' | 'partial' | 'missing';
}> {
  const status = getRedisStatus();
  
  let configurationStatus: 'complete' | 'partial' | 'missing';
  if (status.hasUrl && status.hasToken) {
    configurationStatus = 'complete';
  } else if (status.hasUrl || status.hasToken) {
    configurationStatus = 'partial';
  } else {
    configurationStatus = 'missing';
  }
  
  return {
    connected: status.ready,
    lastErrorAge: status.errorAge,
    configurationStatus
  };
}

