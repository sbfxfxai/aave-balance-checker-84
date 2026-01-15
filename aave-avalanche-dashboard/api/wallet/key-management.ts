/**
 * Server Encryption Key Management Utilities
 * 
 * CRITICAL: Server encryption key must be stored in secrets manager
 * (Vercel Secrets, AWS SSM, Doppler, etc.) - NEVER in environment variables long-term
 * 
 * This module provides utilities for key rotation and management
 */

import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';

// Key rotation configuration
const KEY_ROTATION_WARNING_DAYS = 60; // Warn if key is older than 60 days
const KEY_ROTATION_REQUIRED_DAYS = 90; // Require rotation after 90 days

/**
 * Get server encryption key from secrets manager
 * 
 * Priority:
 * 1. Vercel Secrets (if available)
 * 2. Environment variable (fallback, should be migrated)
 * 
 * @returns Server encryption key
 * @throws Error if key not found
 */
export function getServerEncryptionKey(): string {
  // In production, this should fetch from secrets manager
  // For now, check environment variable with clear warning
  const key = process.env.SERVER_ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('SERVER_ENCRYPTION_KEY not found. Must be set in secrets manager.');
  }
  
  // Warn if key appears to be in plain env (not from secrets manager)
  if (process.env.VERCEL_ENV === 'production' && !process.env.SERVER_ENCRYPTION_KEY_SOURCE) {
    logger.warn('Server encryption key may not be from secrets manager', LogCategory.AUTH, {
      warning: 'Key should be stored in Vercel Secrets or external secrets manager',
      recommendation: 'Migrate to secrets manager and set SERVER_ENCRYPTION_KEY_SOURCE'
    });
  }
  
  return key;
}

/**
 * Check if server encryption key needs rotation
 * 
 * @returns Rotation status and recommendations
 */
export async function checkKeyRotationStatus(): Promise<{
  needsRotation: boolean;
  daysSinceRotation: number | null;
  recommendation: string;
  keySource: 'secrets_manager' | 'env_var' | 'unknown';
}> {
  try {
    const redis = await getRedis();
    
    // Get key rotation metadata from Redis
    const rotationKey = 'key_rotation:server_encryption_key';
    const rotationData = await redis.get<string>(rotationKey);
    
    let daysSinceRotation: number | null = null;
    let keySource: 'secrets_manager' | 'env_var' | 'unknown' = 'unknown';
    
    if (rotationData) {
      const data = JSON.parse(rotationData);
      const lastRotation = new Date(data.lastRotation);
      daysSinceRotation = Math.floor((Date.now() - lastRotation.getTime()) / (1000 * 60 * 60 * 24));
      keySource = data.source || 'unknown';
    } else {
      // No rotation record - assume key is old and needs rotation
      daysSinceRotation = KEY_ROTATION_REQUIRED_DAYS + 1;
      keySource = process.env.SERVER_ENCRYPTION_KEY_SOURCE === 'secrets_manager' ? 'secrets_manager' : 'env_var';
    }
    
    const needsRotation = daysSinceRotation !== null && daysSinceRotation >= KEY_ROTATION_REQUIRED_DAYS;
    const needsWarning = daysSinceRotation !== null && daysSinceRotation >= KEY_ROTATION_WARNING_DAYS;
    
    let recommendation = 'Key rotation status normal';
    if (needsRotation) {
      recommendation = `CRITICAL: Key rotation required (${daysSinceRotation} days old). Rotate immediately and re-encrypt all active keys.`;
    } else if (needsWarning) {
      recommendation = `Key rotation recommended soon (${daysSinceRotation} days old). Plan rotation within ${KEY_ROTATION_REQUIRED_DAYS - daysSinceRotation} days.`;
    }
    
    return {
      needsRotation,
      daysSinceRotation,
      recommendation,
      keySource
    };
  } catch (error) {
    logger.error('Failed to check key rotation status', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return {
      needsRotation: false,
      daysSinceRotation: null,
      recommendation: 'Unable to check rotation status',
      keySource: 'unknown'
    };
  }
}

/**
 * Record key rotation event
 * Call this after rotating the server encryption key
 * 
 * @param source Source of the key (secrets_manager, env_var, etc.)
 */
export async function recordKeyRotation(source: 'secrets_manager' | 'env_var' = 'secrets_manager'): Promise<void> {
  try {
    const redis = await getRedis();
    const rotationKey = 'key_rotation:server_encryption_key';
    
    const rotationData = {
      lastRotation: new Date().toISOString(),
      source,
      rotatedBy: 'system', // In production, track who rotated
      version: Date.now() // Version number for tracking
    };
    
    await redis.set(rotationKey, JSON.stringify(rotationData), { ex: 365 * 24 * 60 * 60 }); // 1 year TTL
    
    logger.info('Key rotation recorded', LogCategory.AUTH, {
      source,
      timestamp: rotationData.lastRotation
    });
    
    // Log to audit trail
    await logKeyRotationEvent('rotate', source);
  } catch (error) {
    logger.error('Failed to record key rotation', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Get count of active encrypted keys (for rotation planning)
 */
export async function getActiveKeyCount(): Promise<number> {
  try {
    const redis = await getRedis();
    
    // Count keys matching wallet: pattern
    const keys = await redis.keys('wallet:0x*');
    return keys.length;
  } catch (error) {
    logger.error('Failed to get active key count', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    });
    return 0;
  }
}

/**
 * Log key rotation event to audit trail
 */
async function logKeyRotationEvent(
  action: 'rotate' | 'check' | 'warn',
  source: string
): Promise<void> {
  try {
    const redis = await getRedis();
    const logKey = 'audit:key_rotation';
    
    const logEntry = {
      action,
      source,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown'
    };
    
    await redis.lpush(logKey, JSON.stringify(logEntry));
    await redis.ltrim(logKey, 0, 999); // Keep last 1000 entries
    await redis.expire(logKey, 365 * 24 * 60 * 60); // 1 year TTL
  } catch (error) {
    logger.warn('Failed to log key rotation event', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Health check endpoint for key management
 * Returns key rotation status and recommendations
 */
export async function getKeyManagementHealth(): Promise<{
  status: 'healthy' | 'warning' | 'critical';
  keyRotation: {
    needsRotation: boolean;
    daysSinceRotation: number | null;
    recommendation: string;
    keySource: string;
  };
  activeKeys: number;
  lastChecked: string;
}> {
  const rotationStatus = await checkKeyRotationStatus();
  const activeKeys = await getActiveKeyCount();
  
  let status: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (rotationStatus.needsRotation) {
    status = 'critical';
  } else if (rotationStatus.daysSinceRotation && rotationStatus.daysSinceRotation >= KEY_ROTATION_WARNING_DAYS) {
    status = 'warning';
  }
  
  return {
    status,
    keyRotation: rotationStatus,
    activeKeys,
    lastChecked: new Date().toISOString()
  };
}
