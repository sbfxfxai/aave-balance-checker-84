import { getRedis } from '../utils/redis';
import { verifyMessage, isAddress } from 'ethers';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';

// Configuration constants
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const RATE_LIMIT_WINDOW = 60; // seconds
const RATE_LIMIT_MAX = 10; // attempts per window
const SIGNATURE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * Associate a wallet address with a Privy user ID
 * 
 * This endpoint:
 * 1. Validates the wallet address and Privy user ID format
 * 2. Verifies cryptographic signature to prove wallet ownership
 * 3. Stores the association in Redis with long TTL
 * 4. Includes rate limiting and replay attack protection
 * 
 * @security Requires signature verification in production
 * @rateLimited 10 requests per minute per IP
 * @persistence Redis with 1-year TTL
 */
// POST /api/wallet/associate-user
export default async function handler(req: VercelRequest, res: VercelResponse) {
    const startTime = Date.now();
    
    // Helper to send error response safely
    const sendError = (status: number, error: string, details?: string) => {
        try {
            if (!res.headersSent) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
            }
            return res.status(status).json({
                success: false,
                error,
                ...(details && { details })
            });
        } catch (err) {
            console.error('[Associate User] Failed to send error response:', err);
            try {
                res.status(status).end(JSON.stringify({ success: false, error }));
            } catch {
                // Last resort - response might already be sent
            }
        }
    };
    
    // Set headers early to ensure they're always set
    const setHeaders = () => {
        try {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
            res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
        } catch (err) {
            console.error('[Associate User] Failed to set headers:', err);
        }
    };
    
    setHeaders();

    if (req.method === 'OPTIONS') {
        try {
            return res.status(200).json({ ok: true });
        } catch {
            return res.status(200).end('{"ok":true}');
        }
    }
    
    if (req.method !== 'POST') {
        return sendError(405, 'Method not allowed', 'Only POST and OPTIONS methods are allowed');
    }

    try {
        // Get Redis client with graceful error handling
        let redis;
        try {
            redis = await getRedis();
        } catch (redisError) {
            const errorMsg = redisError instanceof Error ? redisError.message : String(redisError);
            try {
                logger.error('Redis unavailable for wallet association', LogCategory.DATABASE, {
                    error: errorMsg
                }, redisError instanceof Error ? redisError : new Error(errorMsg));
            } catch {
                console.error('[Associate User] Redis error:', errorMsg);
            }
            
            return sendError(503, 'Service temporarily unavailable', 'Database service is currently unavailable. Please try again later.');
        }

        // Rate limiting (with error handling)
        const clientIp = req.headers['x-forwarded-for'] as string || 
                        req.socket.remoteAddress || 
                        'unknown';
        const rateLimitKey = `ratelimit:associate:${clientIp}`;
        
        let attempts = 0;
        try {
            attempts = await redis.incr(rateLimitKey);
            if (attempts === 1) {
                await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW);
            }
        } catch (rateLimitError) {
            // If rate limiting fails, log but continue (fail open)
            logger.warn('Rate limiting check failed, continuing', LogCategory.AUTH, {
                error: rateLimitError instanceof Error ? rateLimitError.message : String(rateLimitError)
            });
        }

        if (attempts > RATE_LIMIT_MAX) {
            logger.warn('Rate limit exceeded for wallet association', LogCategory.AUTH, {
                clientIp,
                attempts
            });
            
            return res.status(429).json({
                success: false,
                error: 'Too many requests',
                details: `Rate limit exceeded. Try again in ${RATE_LIMIT_WINDOW} seconds.` 
            });
        }

        // Parse request body safely
        let walletAddress: string | undefined;
        let privyUserId: string | undefined;
        let signature: string | undefined;
        let message: string | undefined;
        let timestamp: string | number | undefined;
        
        try {
            if (!req.body || typeof req.body !== 'object') {
                return sendError(400, 'Invalid request body', 'Request body must be a valid JSON object');
            }
            
            ({ walletAddress, privyUserId, signature, message, timestamp } = req.body);
        } catch (parseError) {
            const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
            console.error('[Associate User] Failed to parse request body:', errorMsg);
            return sendError(400, 'Invalid request body', 'Failed to parse request body');
        }

        // Input validation
        if (!walletAddress || !privyUserId) {
            const error = new Error('Missing required fields');
            logger.error('Wallet association failed - missing fields', LogCategory.AUTH, {
                hasWalletAddress: !!walletAddress,
                hasPrivyUserId: !!privyUserId
            }, error);
            
                return res.status(400).json({ 
                    success: false,
                    error: 'Missing required fields',
                    details: 'walletAddress and privyUserId are required'
                });
        }

        if (!isAddress(walletAddress)) {
            const error = new Error('Invalid wallet address format');
            logger.error('Wallet association failed - invalid address', LogCategory.AUTH, {
                walletAddress
            }, error);
            
                return res.status(400).json({ 
                    success: false,
                    error: 'Invalid wallet address format',
                    details: 'Must be a valid Ethereum address'
                });
        }

        if (!privyUserId.startsWith('did:privy:')) {
            const error = new Error('Invalid Privy user ID format');
            logger.error('Wallet association failed - invalid user ID', LogCategory.AUTH, {
                privyUserId: privyUserId.substring(0, 20) + '...'
            }, error);
            
                return res.status(400).json({
                    success: false,
                    error: 'Invalid Privy user ID format',
                    details: 'Must start with "did:privy:"'
                });
        }

        // Enforce signature in production
        if (!signature || !message) {
            if (process.env.NODE_ENV === 'production') {
                const error = new Error('Signature verification required in production');
                logger.error('Wallet association failed - missing signature in production', LogCategory.AUTH, {
                    walletAddress: walletAddress.substring(0, 8) + '...',
                    privyUserId: privyUserId.substring(0, 20) + '...'
                }, error);
                
                return res.status(400).json({ 
                    success: false,
                    error: 'Signature verification required',
                    details: 'You must provide a signature to prove wallet ownership'
                });
            }
            logger.warn('No signature provided - allowed in development mode', LogCategory.AUTH, {
                walletAddress: walletAddress.substring(0, 8) + '...',
                privyUserId: privyUserId.substring(0, 20) + '...'
            });
        }

        // Verify signature
        let signatureVerified = false;
        if (signature && message) {
            try {
                logger.info('Verifying signature for wallet association', LogCategory.AUTH, {
                    walletAddress: walletAddress.substring(0, 8) + '...',
                    messageLength: message.length,
                    signatureLength: signature.length
                });
                
                // Validate message format - accept multiple formats
                const normalizedMessage = message.toLowerCase();
                const normalizedWallet = walletAddress.toLowerCase();
                const normalizedUserId = privyUserId.toLowerCase();
                
                // Check if message contains wallet address and user ID (flexible format)
                const hasWallet = normalizedMessage.includes(normalizedWallet);
                const hasUserId = normalizedMessage.includes(normalizedUserId) || 
                                 normalizedMessage.includes(privyUserId.toLowerCase().replace('did:privy:', ''));
                
                if (!hasWallet || !hasUserId) {
                    const error = new Error('Invalid message format');
                    logger.error('Signature verification failed - invalid message format', LogCategory.AUTH, {
                        walletAddress: walletAddress.substring(0, 8) + '...',
                        hasWallet,
                        hasUserId,
                        messagePreview: message.substring(0, 100) + '...'
                    }, error);
                    
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid message format',
                        details: 'Message must include wallet address and user ID'
                    });
                }

                // Check timestamp to prevent replay attacks
                if (timestamp) {
                    const messageTime = typeof timestamp === 'string' ? parseInt(timestamp, 10) : timestamp;
                    const now = Date.now();
                    
                    if (Math.abs(now - messageTime) > SIGNATURE_TIMEOUT) {
                        const error = new Error('Signature expired');
                        logger.error('Signature verification failed - expired timestamp', LogCategory.AUTH, {
                            walletAddress: walletAddress.substring(0, 8) + '...',
                            messageTime,
                            now,
                            age: Math.abs(now - messageTime)
                        }, error);
                        
                        return res.status(400).json({
                            success: false,
                            error: 'Signature expired',
                            details: 'Signature must be generated within 5 minutes'
                        });
                    }
                }

                // Verify signature with proper error handling
                let recoveredAddress: string;
                try {
                    recoveredAddress = verifyMessage(message, signature);
                } catch (verifyError) {
                    const errorMsg = verifyError instanceof Error ? verifyError.message : String(verifyError);
                    logger.error('Signature verification error - verifyMessage threw', LogCategory.AUTH, {
                        walletAddress: walletAddress.substring(0, 8) + '...',
                        error: errorMsg
                    }, verifyError instanceof Error ? verifyError : new Error(errorMsg));
                    
                    return res.status(400).json({
                        success: false,
                        error: 'Signature verification failed',
                        details: 'Invalid signature format or verification error',
                        message: errorMsg
                    });
                }
                
                if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
                    const error = new Error('Signature address mismatch');
                    logger.error('Signature verification failed - address mismatch', LogCategory.AUTH, {
                        walletAddress: walletAddress.substring(0, 8) + '...',
                        recoveredAddress: recoveredAddress.substring(0, 8) + '...'
                    }, error);
                    
                    return res.status(401).json({ 
                        success: false,
                        error: 'Invalid signature',
                        details: 'Wallet ownership verification failed'
                    });
                }
                
                signatureVerified = true;
                logger.info('Signature verified successfully', LogCategory.AUTH, {
                    walletAddress: walletAddress.substring(0, 8) + '...'
                });
            } catch (sigError) {
                logger.error('Signature verification error', LogCategory.AUTH, {
                    walletAddress: walletAddress.substring(0, 8) + '...',
                    error: sigError instanceof Error ? sigError.message : String(sigError)
                }, sigError instanceof Error ? sigError : new Error(String(sigError)));
                
                return res.status(400).json({ 
                    success: false,
                    error: 'Signature verification failed',
                    details: sigError instanceof Error ? sigError.message : String(sigError)
                });
            }
        }

        const walletKey = `wallet_owner:${walletAddress.toLowerCase()}`;
        const userKey = `user_wallet:${privyUserId}`;

        // Check for existing association (with error handling)
        let existingOwner: string | null = null;
        try {
            existingOwner = await redis.get(walletKey) as string | null;
        } catch (readError) {
            logger.error('Failed to check existing wallet association', LogCategory.DATABASE, {
                error: readError instanceof Error ? readError.message : String(readError)
            }, readError instanceof Error ? readError : new Error(String(readError)));
            
            return res.status(503).json({
                success: false,
                error: 'Service temporarily unavailable',
                details: 'Unable to check wallet association. Please try again later.'
            });
        }
        
        if (existingOwner && existingOwner !== privyUserId) {
            if (!signatureVerified) {
                logger.warn('Wallet already associated with another user', LogCategory.AUTH, {
                    walletAddress: walletAddress.substring(0, 8) + '...',
                    existingOwner: existingOwner.substring(0, 20) + '...',
                    requestedOwner: privyUserId.substring(0, 20) + '...'
                });
                
                return res.status(409).json({
                    success: false,
                    error: 'Wallet already associated',
                    details: 'Provide a signature to prove ownership and re-associate'
                });
            }
            
            logger.info('Re-associating wallet to new user', LogCategory.AUTH, {
                walletAddress: walletAddress.substring(0, 8) + '...',
                previousOwner: existingOwner.substring(0, 20) + '...',
                newOwner: privyUserId.substring(0, 20) + '...'
            });
        }

        // Store mappings in Redis
        logger.info('Storing wallet association in Redis', LogCategory.DATABASE, {
            walletKey: walletKey.substring(0, 30) + '...',
            userKey: userKey.substring(0, 30) + '...',
            privyUserId: privyUserId.substring(0, 20) + '...'
        });
        
        try {
            await Promise.all([
                redis.set(walletKey, privyUserId, { ex: ONE_YEAR_SECONDS }),
                redis.set(userKey, walletAddress.toLowerCase(), { ex: ONE_YEAR_SECONDS })
            ]);

            // Verify storage
            const [storedValue, ttl] = await Promise.all([
                redis.get(walletKey) as Promise<string | null>,
                redis.ttl(walletKey)
            ]);

            if (storedValue !== privyUserId) {
                const error = new Error(`Redis verification failed: expected ${privyUserId}, got ${storedValue}`);
                logger.error('Redis storage verification failed', LogCategory.DATABASE, {
                    walletKey: walletKey.substring(0, 30) + '...',
                    expected: privyUserId.substring(0, 20) + '...',
                    actual: storedValue
                }, error);
                
                throw error;
            }

            if (ttl <= 0) {
                const error = new Error(`Redis TTL not set correctly: ${ttl} seconds`);
                logger.error('Redis TTL verification failed', LogCategory.DATABASE, {
                    walletKey: walletKey.substring(0, 30) + '...',
                    ttl
                }, error);
                
                throw error;
            }

            logger.info('Wallet association stored and verified', LogCategory.DATABASE, {
                walletAddress: walletAddress.substring(0, 8) + '...',
                privyUserId: privyUserId.substring(0, 20) + '...',
                ttl: ttl,
                days: Math.floor(ttl / 86400)
            });
            
        } catch (redisError) {
            logger.error('Redis storage failed', LogCategory.DATABASE, {
                walletKey: walletKey.substring(0, 30) + '...',
                privyUserId: privyUserId.substring(0, 20) + '...'
            }, redisError instanceof Error ? redisError : new Error(String(redisError)));
            
            errorTracker.trackError(redisError instanceof Error ? redisError : new Error(String(redisError)), {
                category: 'database',
                context: {
                    stage: 'wallet_association',
                    walletAddress: walletAddress.substring(0, 8) + '...',
                    privyUserId: privyUserId.substring(0, 20) + '...'
                }
            });
            
            return res.status(500).json({ 
                success: false,
                error: 'Storage failed',
                details: 'The wallet association could not be stored. Please try again.',
                message: redisError instanceof Error ? redisError.message : String(redisError)
            });
        }

        logger.info('Wallet association completed successfully', LogCategory.AUTH, {
            walletAddress: walletAddress.substring(0, 8) + '...',
            privyUserId: privyUserId.substring(0, 20) + '...',
            signatureVerified,
            duration: Date.now() - startTime
        });

        return res.status(200).json({ 
            success: true,
            signatureVerified,
            walletAddress: walletAddress.toLowerCase(),
            privyUserId,
            expiresIn: ONE_YEAR_SECONDS,
            message: signatureVerified 
                ? 'Wallet successfully associated with cryptographic verification'
                : 'Wallet associated (development mode - signature verification recommended)'
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        // Safely log error (don't let logging errors break the response)
        try {
            logger.error('Wallet association failed with unexpected error', LogCategory.AUTH, {
                duration: Date.now() - startTime,
                error: errorMessage
            }, error instanceof Error ? error : new Error(errorMessage));
        } catch (logError) {
            console.error('[Associate User] Failed to log error:', logError);
        }
        
        // Safely track error (don't let tracking errors break the response)
        try {
            errorTracker.trackError(error instanceof Error ? error : new Error(errorMessage), {
                category: 'authentication',
                context: {
                    stage: 'wallet_association',
                    method: req.method,
                    url: req.url
                }
            });
        } catch (trackError) {
            console.error('[Associate User] Failed to track error:', trackError);
        }
        
        // Ensure response is always properly formatted JSON
        try {
            return res.status(500).json({ 
                success: false,
                error: 'Internal server error',
                details: process.env.NODE_ENV === 'production' 
                    ? 'An unexpected error occurred. Please try again later.'
                    : errorMessage,
                ...(process.env.NODE_ENV === 'development' && { 
                    stack: error instanceof Error ? error.stack : undefined 
                })
            });
        } catch (responseError) {
            // Last resort: send plain text if JSON fails
            console.error('[Associate User] Failed to send JSON response:', responseError);
            res.status(500).end('Internal server error');
        }
    }
}

export const config = {
    maxDuration: 10, // 10 seconds max execution time
};
