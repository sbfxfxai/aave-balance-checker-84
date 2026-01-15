import { VercelRequest, VercelResponse } from '@vercel/node';
import { wordlists } from 'ethers';

// Helper to access Node.js crypto module (available at runtime in Vercel)
function getCrypto() {
  // Use Function constructor to access require in a way TypeScript accepts
  const requireFunc = new Function('return require')();
  return requireFunc('crypto') as {
    pbkdf2: (
      password: string,
      salt: string,
      iterations: number,
      keylen: number,
      digest: string,
      callback: (err: Error | null, derivedKey: Buffer) => void
    ) => void;
    createDecipheriv: (algorithm: string, key: Uint8Array, iv: Uint8Array) => {
      setAuthTag: (tag: Uint8Array) => void;
      update: (data: Uint8Array) => Buffer;
      final: () => Buffer;
    };
  };
}
import { checkRateLimit, RATE_LIMITS } from './rateLimit';
import { withMonitoring } from './monitoring';
import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';

// Encryption parameters (must match send-email.ts)
const MNEMONIC_ENCRYPTION_SALT = process.env.MNEMONIC_SALT || 'tiltvault-mnemonic-salt';
// ENHANCED: Configurable PBKDF2 iterations (default 600k for 2026 security standards)
const PBKDF2_ITERATIONS = parseInt(
  process.env.PBKDF2_ITERATIONS || process.env.MNEMONIC_PBKDF2_ITERATIONS || '600000',
  10
);
const MIN_PBKDF2_ITERATIONS = 100_000;
const EFFECTIVE_PBKDF2_ITERATIONS = Math.max(PBKDF2_ITERATIONS, MIN_PBKDF2_ITERATIONS);

const KEY_LENGTH = 32; // 256 bits for AES-256
const IV_LENGTH = 12; // AES-GCM IV length
const AUTH_TAG_LENGTH = 16; // AES-GCM auth tag length
const MIN_RESPONSE_TIME_MS = 200; // Timing attack protection

// ENHANCED: Per-user salt support
const USE_PER_USER_SALT = process.env.USE_PER_USER_SALT === 'true';

// Strict rate limits for decryption - more restrictive than default
const DECRYPT_RATE_LIMIT = {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Only 3 attempts per hour
    skipSuccessfulRequests: false // Count all attempts
};

/**
 * Validate mnemonic against BIP39 wordlist
 * 
 * @param mnemonic The mnemonic phrase to validate
 * @returns Validation result with error details if invalid
 */
function validateMnemonic(mnemonic: string): { valid: boolean; error?: string } {
    try {
        const words = mnemonic.trim().split(/\s+/);
        
        // Check length
        if (words.length !== 12 && words.length !== 24) {
            return { 
                valid: false, 
                error: `Invalid word count: ${words.length} (expected 12 or 24)` 
            };
        }
        
        // Check all words are in BIP39 wordlist
        const wordlist = wordlists.en;
        const invalidWords = words.filter(word => wordlist.getWordIndex(word.toLowerCase()) === -1);
        
        if (invalidWords.length > 0) {
            return { 
                valid: false, 
                error: `${invalidWords.length} invalid words found` 
            };
        }
        
        return { valid: true };
    } catch (error) {
        logger.error('Mnemonic validation error', LogCategory.AUTH, {
            error: error instanceof Error ? error.message : String(error)
        }, error instanceof Error ? error : new Error(String(error)));
        
        return { 
            valid: false, 
            error: 'Validation failed' 
        };
    }
}

/**
 * Decrypt mnemonic using user's email as key material
 * 
 * ⚠️ SECURITY WARNING: This approach is fundamentally insecure for production use.
 * Email addresses are not high-entropy secrets and should not be used as encryption key material.
 * 
 * @param encryptedMnemonic Base64-encoded encrypted mnemonic
 * @param userEmail User's email address (used as key material)
 * @returns Decrypted mnemonic phrase
 * @throws Error if decryption fails
 */
async function decryptMnemonic(
    encryptedMnemonic: string, 
    userEmail: string
): Promise<string> {
    const startTime = Date.now();
    
    try {
        const normalizedEmail = userEmail.toLowerCase().trim();
        
        // Decode encrypted data first to extract components
        const Buffer = (globalThis as any).Buffer;
        const encryptedBuffer = Buffer.from(encryptedMnemonic, 'base64');
        
        if (encryptedBuffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
            throw new Error('INVALID_FORMAT');
        }
        
        // Extract components
        const iv = new Uint8Array(encryptedBuffer.subarray(0, IV_LENGTH));
        const authTag = new Uint8Array(
            encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LENGTH)
        );
        const encrypted = new Uint8Array(
            encryptedBuffer.subarray(IV_LENGTH, encryptedBuffer.length - AUTH_TAG_LENGTH)
        );
        
        // ENHANCED: Support per-user salts for better security
        // Extract salt from encrypted data if per-user salt is enabled
        // Format: salt:iv:authTag:encrypted (if per-user salt) or iv:authTag:encrypted (legacy)
        let salt: string;
        let actualIv: Uint8Array;
        let actualAuthTag: Uint8Array;
        let actualEncrypted: Uint8Array;
        
        // ENHANCED: Support per-user salt extraction
        // Format with per-user salt: salt(32 bytes base64 = 44 chars):iv(12):encrypted:authTag(16)
        // Legacy format: iv(12):encrypted:authTag(16)
        if (USE_PER_USER_SALT && encryptedBuffer.length > IV_LENGTH + AUTH_TAG_LENGTH + 44) {
            // New format with per-user salt (salt is stored as base64, 32 bytes = 44 base64 chars)
            try {
                const saltBase64Buffer = encryptedBuffer.subarray(0, 44);
                const saltBase64 = saltBase64Buffer.toString('utf8');
                // Decode base64 salt back to original string
                salt = Buffer.from(saltBase64, 'base64').toString('utf8');
                actualIv = new Uint8Array(encryptedBuffer.subarray(44, 44 + IV_LENGTH));
                actualAuthTag = new Uint8Array(encryptedBuffer.subarray(44 + IV_LENGTH, 44 + IV_LENGTH + AUTH_TAG_LENGTH));
                actualEncrypted = new Uint8Array(encryptedBuffer.subarray(44 + IV_LENGTH + AUTH_TAG_LENGTH));
            } catch (saltError) {
                // Fallback to legacy format if salt extraction fails
                logger.warn('Failed to extract per-user salt, using legacy format', LogCategory.AUTH, {
                    error: saltError instanceof Error ? saltError.message : String(saltError)
                });
                salt = MNEMONIC_ENCRYPTION_SALT;
                actualIv = iv;
                actualAuthTag = authTag;
                actualEncrypted = encrypted;
            }
        } else {
            // Legacy format: use static salt
            salt = MNEMONIC_ENCRYPTION_SALT;
            actualIv = iv;
            actualAuthTag = authTag;
            actualEncrypted = encrypted;
        }
        
        // Async key derivation to avoid blocking event loop
        const crypto = getCrypto();
        const derivedKeyBuffer = await new Promise<Buffer>((resolve, reject) => {
            crypto.pbkdf2(
                normalizedEmail,
                salt,
                EFFECTIVE_PBKDF2_ITERATIONS,
                KEY_LENGTH,
                'sha256',
                (err: Error | null, key: Buffer) => err ? reject(err) : resolve(key)
            );
        });
        
        const derivedKey = new Uint8Array(derivedKeyBuffer);
        
        // Variables already declared above: Buffer, encryptedBuffer, iv, authTag, encrypted
        
        // Decrypt
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, actualIv);
        decipher.setAuthTag(actualAuthTag);
        
        const updateResult = decipher.update(actualEncrypted);
        const finalResult = decipher.final();
        
        // Combine results
        const decryptedArray = new Uint8Array(updateResult.length + finalResult.length);
        decryptedArray.set(new Uint8Array(updateResult), 0);
        decryptedArray.set(new Uint8Array(finalResult), updateResult.length);
        
        const result = Buffer.from(decryptedArray).toString('utf8');
        
        logger.debug('Mnemonic decrypted successfully', LogCategory.AUTH, {
            duration: Date.now() - startTime,
            email: userEmail.substring(0, 8) + '...'
        });
        
        return result;
    } catch (error) {
        logger.error('Mnemonic decryption failed', LogCategory.AUTH, {
            email: userEmail.substring(0, 8) + '...',
            duration: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error)
        }, error instanceof Error ? error : new Error(String(error)));
        
        // Re-throw with generic error to prevent information leakage
        throw new Error('DECRYPTION_FAILED');
    }
}

/**
 * Log decryption attempt for audit trail and security monitoring
 * 
 * @param email User email
 * @param success Whether decryption succeeded
 * @param req HTTP request for IP/User-Agent tracking
 */
async function logDecryptAttempt(
    email: string,
    success: boolean,
    req: VercelRequest
): Promise<void> {
    try {
        const redis = await getRedis();
        const logEntry = JSON.stringify({
            timestamp: Date.now(),
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown',
            success,
            endpoint: 'decrypt-mnemonic'
        });
        
        await redis.lpush(`decrypt_attempts:${email}`, logEntry);
        await redis.ltrim(`decrypt_attempts:${email}`, 0, 99); // Keep last 100 attempts
        await redis.expire(`decrypt_attempts:${email}`, 30 * 24 * 60 * 60); // 30 days
        
        logger.debug('Decrypt attempt logged', LogCategory.AUTH, {
            email: email.substring(0, 8) + '...',
            success,
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
        });
    } catch (error) {
        logger.error('Failed to log decrypt attempt', LogCategory.DATABASE, {
            email: email.substring(0, 8) + '...',
            success
        }, error instanceof Error ? error : new Error(String(error)));
    }
}

/**
 * Get recent decryption attempts for monitoring
 * 
 * @param email User email
 * @param limit Maximum number of attempts to retrieve
 * @returns Array of recent attempts
 */
export async function getDecryptAttempts(email: string, limit: number = 10): Promise<any[]> {
    try {
        const redis = await getRedis();
        const attempts = await redis.lrange(`decrypt_attempts:${email}`, 0, limit - 1);
        
        return attempts.map(attempt => {
            try {
                return JSON.parse(attempt as string);
            } catch {
                return null;
            }
        }).filter(Boolean);
    } catch (error) {
        logger.error('Failed to get decrypt attempts', LogCategory.DATABASE, {
            email: email.substring(0, 8) + '...'
        }, error instanceof Error ? error : new Error(String(error)));
        
        return [];
    }
}

/**
 * Decrypt mnemonic endpoint
 * 
 * 🔒 SECURITY: This endpoint handles sensitive cryptographic operations.
 * Rate limiting, audit logging, and timing attack protection are enforced.
 * 
 * @warning The email-based encryption approach is fundamentally insecure.
 * Consider migrating to a proper key management system for production use.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    const startTime = Date.now();
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    await withMonitoring(req, res, 'decrypt-mnemonic', async (): Promise<void> => {
        try {
            const { encryptedMnemonic, email } = req.body;

            // Input validation
            if (!encryptedMnemonic || typeof encryptedMnemonic !== 'string') {
                const error = new Error('Missing or invalid encryptedMnemonic');
                logger.error('Decrypt request failed - missing encryptedMnemonic', LogCategory.AUTH, {
                    hasEncryptedMnemonic: !!encryptedMnemonic,
                    type: typeof encryptedMnemonic
                }, error);
                
                res.status(400).json({ error: 'Missing or invalid encryptedMnemonic' });
                return;
            }

            if (!email || typeof email !== 'string') {
                const error = new Error('Missing or invalid email');
                logger.error('Decrypt request failed - missing email', LogCategory.AUTH, {
                    hasEmail: !!email,
                    type: typeof email
                }, error);
                
                res.status(400).json({ error: 'Missing or invalid email' });
                return;
            }

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                const error = new Error('Invalid email format');
                logger.error('Decrypt request failed - invalid email format', LogCategory.AUTH, {
                    email: email.substring(0, 8) + '...'
                }, error);
                
                res.status(400).json({ error: 'Invalid email format' });
                return;
            }

            // Validate base64 format
            try {
                const Buffer = (globalThis as any).Buffer;
                Buffer.from(encryptedMnemonic, 'base64');
            } catch (formatError) {
                const error = new Error('Invalid encrypted data format');
                logger.error('Decrypt request failed - invalid base64 format', LogCategory.AUTH, {
                    email: email.substring(0, 8) + '...',
                    encryptedLength: encryptedMnemonic.length
                }, error);
                
                res.status(400).json({ error: 'Invalid encrypted data format' });
                return;
            }

            // Rate limiting - use stricter limits for decryption
            const rateLimitResult = await checkRateLimit(req, {
                maxRequests: DECRYPT_RATE_LIMIT.max,
                windowSeconds: Math.floor(DECRYPT_RATE_LIMIT.windowMs / 1000),
                endpoint: 'decrypt-mnemonic',
                identifier: email,
            });

            if (!rateLimitResult.allowed) {
                await logDecryptAttempt(email, false, req);
                
                logger.warn('Decrypt rate limit exceeded', LogCategory.AUTH, {
                    email: email.substring(0, 8) + '...',
                    attempts: rateLimitResult.limit,
                    resetAt: rateLimitResult.resetAt
                });
                
                res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
                res.setHeader('X-RateLimit-Remaining', '0');
                res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());
                res.status(429).json({
                    error: 'Rate limit exceeded',
                    message: `Too many decryption attempts. Try again after ${new Date(rateLimitResult.resetAt).toISOString()}`,
                    resetAt: rateLimitResult.resetAt,
                });
                return;
            }

            res.setHeader('X-RateLimit-Limit', rateLimitResult.limit.toString());
            res.setHeader('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
            res.setHeader('X-RateLimit-Reset', new Date(rateLimitResult.resetAt).toISOString());

            // Decrypt mnemonic
            let mnemonic: string;
            try {
                mnemonic = await decryptMnemonic(encryptedMnemonic, email);
            } catch (decryptError) {
                await logDecryptAttempt(email, false, req);
                
                errorTracker.trackAuthError(decryptError instanceof Error ? decryptError : new Error(String(decryptError)), {
                    stage: 'mnemonic_decryption',
                    email: email.substring(0, 8) + '...'
                });
                
                // Generic error message to prevent information leakage
                res.status(400).json({
                    error: 'Decryption failed',
                    message: 'Unable to decrypt mnemonic. Please verify your email address is correct.'
                });
                return;
            }

            // Validate mnemonic format
            const validation = validateMnemonic(mnemonic);
            if (!validation.valid) {
                await logDecryptAttempt(email, false, req);
                
                logger.error('Mnemonic validation failed', LogCategory.AUTH, {
                    email: email.substring(0, 8) + '...',
                    validationError: validation.error
                });
                
                res.status(400).json({
                    error: 'Invalid mnemonic',
                    message: 'Decryption succeeded but mnemonic is invalid. Data may be corrupted.'
                });
                return;
            }

            // Success
            await logDecryptAttempt(email, true, req);
            
            logger.info('Mnemonic decrypted successfully', LogCategory.AUTH, {
                email: email.substring(0, 8) + '...',
                wordCount: mnemonic.trim().split(/\s+/).length,
                duration: Date.now() - startTime
            });

            res.status(200).json({
                success: true,
                mnemonic: mnemonic
            });

        } finally {
            // Timing attack protection - ensure consistent response time
            const elapsed = Date.now() - startTime;
            if (elapsed < MIN_RESPONSE_TIME_MS) {
                await new Promise(resolve => 
                    setTimeout(resolve, MIN_RESPONSE_TIME_MS - elapsed)
                );
            }
        }
    });
}

