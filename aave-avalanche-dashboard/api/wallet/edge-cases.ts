/**
 * Edge Case Handling for Wallet Management
 * 
 * Handles:
 * - Email bounce/failure recovery
 * - Privy user ID migrations
 * - Address normalization issues
 * - Stale position cleanup
 */

import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { getPositionsByEmail, updatePosition } from '../positions/store';

// Configuration
const EMAIL_RETRY_DELAY = 60 * 60 * 1000; // 1 hour
const MAX_EMAIL_RETRIES = 3;
const PRIVY_MIGRATION_TTL = 30 * 24 * 60 * 60; // 30 days

export interface EmailBounceRecord {
  email: string;
  walletAddress: string;
  bounceCount: number;
  lastBounceAt: number;
  lastError?: string;
  retryAfter?: number;
}

export interface PrivyMigrationRecord {
  oldUserId: string;
  newUserId: string;
  walletAddress: string;
  migratedAt: number;
}

/**
 * Handle email bounce/failure
 * Marks position as pending_email and schedules retry
 */
export async function handleEmailBounce(
  email: string,
  walletAddress: string,
  error: string
): Promise<void> {
  try {
    const redis = await getRedis();
    const bounceKey = `email_bounce:${email.toLowerCase().trim()}`;
    
    // Get existing bounce record
    const existingRecord = await redis.get<string>(bounceKey);
    let bounceRecord: EmailBounceRecord;
    
    if (existingRecord) {
      bounceRecord = JSON.parse(existingRecord);
      bounceRecord.bounceCount++;
      bounceRecord.lastBounceAt = Date.now();
      bounceRecord.lastError = error;
    } else {
      bounceRecord = {
        email: email.toLowerCase().trim(),
        walletAddress: walletAddress.toLowerCase().trim(),
        bounceCount: 1,
        lastBounceAt: Date.now(),
        lastError: error
      };
    }
    
    // Calculate retry delay (exponential backoff)
    const retryDelay = Math.min(
      EMAIL_RETRY_DELAY * Math.pow(2, bounceRecord.bounceCount - 1),
      24 * 60 * 60 * 1000 // Max 24 hours
    );
    bounceRecord.retryAfter = Date.now() + retryDelay;
    
    // Store bounce record
    await redis.set(bounceKey, JSON.stringify(bounceRecord), { ex: 7 * 24 * 60 * 60 }); // 7 days TTL
    
    // Update position status if exists
    try {
      const positions = await getPositionsByEmail(email);
      const position = positions.find(p => 
        p.walletAddress?.toLowerCase() === walletAddress.toLowerCase()
      );
      
      if (position) {
        await updatePosition(position.id, {
          status: 'pending_email',
          error: `Email delivery failed: ${error}`,
          lastAttemptedAt: new Date().toISOString()
        });
      }
    } catch (positionError) {
      logger.warn('Failed to update position for email bounce', LogCategory.AUTH, {
        email: email.toLowerCase().trim(),
        error: positionError instanceof Error ? positionError.message : String(positionError)
      });
    }
    
    logger.warn('Email bounce handled', LogCategory.AUTH, {
      email: email.toLowerCase().trim(),
      walletAddress: walletAddress.toLowerCase().trim(),
      bounceCount: bounceRecord.bounceCount,
      retryAfter: new Date(bounceRecord.retryAfter).toISOString()
    });
    
  } catch (error) {
    logger.error('Failed to handle email bounce', LogCategory.AUTH, {
      email: email.toLowerCase().trim(),
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Check if email is eligible for retry
 */
export async function canRetryEmail(email: string): Promise<{
  canRetry: boolean;
  retryAfter?: number;
  bounceCount: number;
}> {
  try {
    const redis = await getRedis();
    const bounceKey = `email_bounce:${email.toLowerCase().trim()}`;
    const bounceRecordStr = await redis.get<string>(bounceKey);
    
    if (!bounceRecordStr) {
      return { canRetry: true, bounceCount: 0 };
    }
    
    const bounceRecord: EmailBounceRecord = JSON.parse(bounceRecordStr);
    
    if (bounceRecord.bounceCount >= MAX_EMAIL_RETRIES) {
      return {
        canRetry: false,
        bounceCount: bounceRecord.bounceCount
      };
    }
    
    const now = Date.now();
    if (bounceRecord.retryAfter && now < bounceRecord.retryAfter) {
      return {
        canRetry: false,
        retryAfter: bounceRecord.retryAfter,
        bounceCount: bounceRecord.bounceCount
      };
    }
    
    return {
      canRetry: true,
      bounceCount: bounceRecord.bounceCount
    };
    
  } catch (error) {
    logger.error('Failed to check email retry eligibility', LogCategory.AUTH, {
      email: email.toLowerCase().trim(),
      error: error instanceof Error ? error.message : String(error)
    });
    
    // Fail open - allow retry on error
    return { canRetry: true, bounceCount: 0 };
  }
}

/**
 * Handle Privy user ID migration
 * Migrates wallet associations from old Privy user ID to new one
 */
export async function migratePrivyUserId(
  oldUserId: string,
  newUserId: string,
  walletAddress: string
): Promise<{
  success: boolean;
  migrated: boolean;
  error?: string;
}> {
  try {
    const redis = await getRedis();
    
    // Normalize addresses
    const normalizedWallet = walletAddress.toLowerCase().trim();
    const normalizedOldUserId = oldUserId.toLowerCase().trim();
    const normalizedNewUserId = newUserId.toLowerCase().trim();
    
    // Check if migration already exists
    const migrationKey = `privy_migration:${normalizedOldUserId}:${normalizedNewUserId}`;
    const existingMigration = await redis.get<string>(migrationKey);
    
    if (existingMigration) {
      logger.info('Privy migration already exists', LogCategory.AUTH, {
        oldUserId: normalizedOldUserId,
        newUserId: normalizedNewUserId
      });
      
      return {
        success: true,
        migrated: false
      };
    }
    
    // Get old associations
    const oldWalletKey = `wallet:${normalizedWallet}:privy_user_id`;
    const oldUserIdFromWallet = await redis.get<string>(oldWalletKey);
    
    const oldUserKey = `privy_user:${normalizedOldUserId}:wallets`;
    const oldWallets = await redis.smembers(oldUserKey) || [];
    
    // Verify old association matches
    if (oldUserIdFromWallet?.toLowerCase() !== normalizedOldUserId) {
      return {
        success: false,
        migrated: false,
        error: 'Old user ID does not match existing association'
      };
    }
    
    // Create new associations
    const pipeline = redis.pipeline();
    
    // Update wallet -> user mapping
    pipeline.set(oldWalletKey, normalizedNewUserId, { ex: ONE_YEAR_SECONDS });
    
    // Update user -> wallets mapping
    const newUserKey = `privy_user:${normalizedNewUserId}:wallets`;
    for (const wallet of oldWallets) {
      pipeline.sadd(newUserKey, wallet);
    }
    pipeline.expire(newUserKey, ONE_YEAR_SECONDS);
    
    // Store migration record
    const migrationRecord: PrivyMigrationRecord = {
      oldUserId: normalizedOldUserId,
      newUserId: normalizedNewUserId,
      walletAddress: normalizedWallet,
      migratedAt: Date.now()
    };
    pipeline.set(migrationKey, JSON.stringify(migrationRecord), { ex: PRIVY_MIGRATION_TTL });
    
    await pipeline.exec();
    
    logger.info('Privy user ID migrated', LogCategory.AUTH, {
      oldUserId: normalizedOldUserId,
      newUserId: normalizedNewUserId,
      walletAddress: normalizedWallet,
      walletsMigrated: oldWallets.length
    });
    
    return {
      success: true,
      migrated: true
    };
    
  } catch (error) {
    logger.error('Failed to migrate Privy user ID', LogCategory.AUTH, {
      oldUserId,
      newUserId,
      walletAddress,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));
    
    return {
      success: false,
      migrated: false,
      error: error instanceof Error ? error.message : 'Migration failed'
    };
  }
}

/**
 * Get migration record for a user ID
 */
export async function getPrivyMigration(
  oldUserId: string
): Promise<PrivyMigrationRecord | null> {
  try {
    const redis = await getRedis();
    const pattern = `privy_migration:${oldUserId.toLowerCase().trim()}:*`;
    const keys = await redis.keys(pattern);
    
    if (keys.length === 0) {
      return null;
    }
    
    const migrationStr = await redis.get<string>(keys[0]);
    if (!migrationStr) {
      return null;
    }
    
    return JSON.parse(migrationStr) as PrivyMigrationRecord;
    
  } catch (error) {
    logger.error('Failed to get Privy migration', LogCategory.AUTH, {
      oldUserId,
      error: error instanceof Error ? error.message : String(error)
    });
    
    return null;
  }
}

/**
 * Normalize Ethereum address (checksum or lowercase)
 * Ensures consistent address format across the system
 */
export function normalizeAddress(address: string): string {
  if (!address || typeof address !== 'string') {
    throw new Error('Invalid address format');
  }
  
  // Remove whitespace and convert to lowercase
  const normalized = address.trim().toLowerCase();
  
  // Validate format
  if (!normalized.startsWith('0x') || normalized.length !== 42) {
    throw new Error('Invalid Ethereum address format');
  }
  
  return normalized;
}

/**
 * Cleanup stale positions (older than 30 days in pending state)
 */
export async function cleanupStalePositions(): Promise<{
  cleaned: number;
  errors: number;
}> {
  try {
    const positions = await getPositionsByEmail(''); // This would need to be updated to get all positions
    
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    let cleaned = 0;
    let errors = 0;
    
    // Note: This is a simplified version - in production, you'd want to
    // iterate through all positions more efficiently
    for (const position of positions) {
      if (position.status === 'pending' || position.status === 'pending_email') {
        const createdAt = new Date(position.createdAt || 0).getTime();
        
        if (createdAt < thirtyDaysAgo) {
          try {
            await updatePosition(position.id, {
              status: 'failed',
              error: 'Position expired after 30 days in pending state'
            });
            cleaned++;
          } catch (error) {
            logger.warn('Failed to cleanup stale position', LogCategory.AUTH, {
              positionId: position.id,
              error: error instanceof Error ? error.message : String(error)
            });
            errors++;
          }
        }
      }
    }
    
    logger.info('Stale positions cleaned', LogCategory.AUTH, {
      cleaned,
      errors
    });
    
    return { cleaned, errors };
    
  } catch (error) {
    logger.error('Failed to cleanup stale positions', LogCategory.AUTH, {
      error: error instanceof Error ? error.message : String(error)
    });
    
    return { cleaned: 0, errors: 1 };
  }
}

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
