import { getRedis } from '../utils/redis';
import { verifyMessage } from 'ethers';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// POST /api/wallet/associate-user
export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Set JSON content type early
    res.setHeader('Content-Type', 'application/json');
    
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).json({ ok: true });
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { walletAddress, privyUserId, signature, message } = req.body;

        if (!walletAddress || !privyUserId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Verify signature if provided (Strict Delegation Mode)
        let signatureVerified = false;
        if (signature && message) {
            try {
                console.log(`[AssociateUser] 🔐 Verifying signature for ${walletAddress}...`);
                console.log(`[AssociateUser] Message length: ${message.length} chars`);
                console.log(`[AssociateUser] Signature length: ${signature.length} chars`);
                
                const recoveredAddress = verifyMessage(message, signature);
                console.log(`[AssociateUser] Recovered address: ${recoveredAddress}`);
                console.log(`[AssociateUser] Expected address: ${walletAddress}`);
                
                if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
                    console.error(`[AssociateUser] ❌ Signature mismatch!`);
                    console.error(`[AssociateUser] Recovered: ${recoveredAddress.toLowerCase()}`);
                    console.error(`[AssociateUser] Expected: ${walletAddress.toLowerCase()}`);
                    return res.status(401).json({ 
                        error: 'Invalid signature - wallet ownership verification failed',
                        details: {
                            recovered: recoveredAddress,
                            expected: walletAddress
                        }
                    });
                }
                
                signatureVerified = true;
                console.log(`[AssociateUser] ✅✅✅ SIGNATURE VERIFIED for ${walletAddress}`);
                console.log(`[AssociateUser] ✅ Wallet ownership confirmed via cryptographic signature`);
            } catch (sigError) {
                console.error('[AssociateUser] ❌ Signature verification error:', sigError);
                console.error('[AssociateUser] Error details:', {
                    name: sigError instanceof Error ? sigError.name : 'Unknown',
                    message: sigError instanceof Error ? sigError.message : String(sigError),
                    stack: sigError instanceof Error ? sigError.stack : 'No stack'
                });
                return res.status(400).json({ 
                    error: 'Signature verification failed',
                    details: sigError instanceof Error ? sigError.message : String(sigError)
                });
            }
        } else {
            console.warn(`[AssociateUser] ⚠️ No signature provided for ${walletAddress} (Implicit Association)`);
            console.warn(`[AssociateUser] ⚠️ This is less secure - signature verification is recommended`);
            // TODO: Enforce signature in production?
        }

        // CRITICAL: Store in Redis with TTL to ensure persistence
        // The webhook depends on this mapping to execute transactions
        // MANDATORY: Redis storage MUST succeed or the association fails
        const redis = getRedis();
        const walletKey = `wallet_owner:${walletAddress.toLowerCase()}`;
        const userKey = `user_wallet:${privyUserId}`;

        // Store mapping: wallet_owner:{walletAddress} -> privyUserId
        // Use 1 year TTL to ensure persistence (associations should be long-lived)
        const oneYearInSeconds = 365 * 24 * 60 * 60;
        
        console.log(`[AssociateUser] Storing mapping in Redis...`);
        console.log(`[AssociateUser] Wallet key: ${walletKey}`);
        console.log(`[AssociateUser] User key: ${userKey}`);
        console.log(`[AssociateUser] Privy User ID: ${privyUserId}`);
        
        try {
            // Store primary mapping
            // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
            await redis.set(walletKey, privyUserId, { ex: oneYearInSeconds });
            console.log(`[AssociateUser] ✅ Primary mapping stored: ${walletKey} -> ${privyUserId}`);

            // Store reverse mapping
            // @ts-ignore - @upstash/redis types may not include set method in some TypeScript versions, but it exists at runtime
            await redis.set(userKey, walletAddress.toLowerCase(), { ex: oneYearInSeconds });
            console.log(`[AssociateUser] ✅ Reverse mapping stored: ${userKey} -> ${walletAddress.toLowerCase()}`);
            
            // CRITICAL: Verify the write succeeded - fail if verification fails
            // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
            const verifyValue = await redis.get(walletKey);
            if (verifyValue !== privyUserId) {
                const errorMsg = `Redis write verification failed! Expected: ${privyUserId}, Got: ${verifyValue}`;
                console.error(`[AssociateUser] ❌ ${errorMsg}`);
                console.error(`[AssociateUser] Wallet key used: ${walletKey}`);
                console.error(`[AssociateUser] Wallet address (original): ${walletAddress}`);
                console.error(`[AssociateUser] Wallet address (normalized): ${walletAddress.toLowerCase()}`);
                
                return res.status(500).json({ 
                    error: 'Redis storage verification failed',
                    details: errorMsg,
                    walletKey,
                    expected: privyUserId,
                    got: verifyValue
                });
            }
            
            // Double-check: Try reading it back immediately
            // @ts-ignore - @upstash/redis types may not include get method in some TypeScript versions, but it exists at runtime
            const doubleCheck = await redis.get(walletKey);
            if (doubleCheck !== privyUserId) {
                const errorMsg = `Redis double-check failed! Expected: ${privyUserId}, Got: ${doubleCheck}`;
                console.error(`[AssociateUser] ❌ ${errorMsg}`);
                
                return res.status(500).json({ 
                    error: 'Redis storage verification failed (double-check)',
                    details: errorMsg,
                    walletKey,
                    expected: privyUserId,
                    got: doubleCheck
                });
            }
            
            // Verify TTL is set correctly
            // @ts-ignore - @upstash/redis types may not include ttl method in some TypeScript versions, but it exists at runtime
            const ttl = await redis.ttl(walletKey);
            if (ttl <= 0) {
                const errorMsg = `Redis TTL not set correctly! TTL: ${ttl} seconds`;
                console.error(`[AssociateUser] ❌ ${errorMsg}`);
                
                return res.status(500).json({ 
                    error: 'Redis TTL verification failed',
                    details: errorMsg,
                    walletKey,
                    ttl
                });
            }
            
            console.log(`[AssociateUser] ✅ Stored and verified association in Redis`);
            console.log(`[AssociateUser] Key: ${walletKey} -> ${privyUserId}`);
            console.log(`[AssociateUser] ✅ Double-check passed: Key exists and value matches`);
            console.log(`[AssociateUser] Key TTL: ${ttl} seconds (${Math.floor(ttl / 86400)} days)`);
            
        } catch (redisError) {
            console.error('[AssociateUser] ❌ Redis storage failed:', redisError);
            const errorMessage = redisError instanceof Error ? redisError.message : String(redisError);
            const errorStack = redisError instanceof Error ? redisError.stack : 'No stack';
            
            // Redis is CRITICAL for webhook - MUST fail if storage fails
            console.error('[AssociateUser] ❌ CRITICAL: Redis storage is mandatory - association failed');
            console.error('[AssociateUser] ❌ Webhook will not be able to find Privy user ID without this mapping');
            console.error('[AssociateUser] ❌ Ensure Redis is configured: KV_REST_API_URL and KV_REST_API_TOKEN');
            
            return res.status(500).json({ 
                error: 'Redis storage failed - mapping is mandatory',
                details: errorMessage,
                walletKey,
                privyUserId,
                message: 'The wallet association could not be stored in Redis. This is required for webhook operations. Please ensure Redis is configured correctly.'
            });
        }

        console.log(`[AssociateUser] ✅ Linked ${walletAddress} to ${privyUserId}`);
        if (signatureVerified) {
            console.log(`[AssociateUser] ✅ Association completed WITH signature verification`);
        } else {
            console.log(`[AssociateUser] ⚠️ Association completed WITHOUT signature verification (implicit)`);
        }

        return res.status(200).json({ 
            success: true,
            signatureVerified,
            walletAddress,
            privyUserId
        });
    } catch (error) {
        console.error('[AssociateUser] Error:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'No stack trace';
        
        console.error('[AssociateUser] Error details:', {
            message: errorMessage,
            stack: errorStack,
            body: req.body,
            method: req.method,
            url: req.url
        });
        
        // Ensure we always return JSON, even if there's an error
        try {
            return res.status(500).json({ 
                error: 'Internal server error',
                details: errorMessage,
                // Only include stack in dev mode
                ...(process.env.NODE_ENV === 'development' && { stack: errorStack })
            });
        } catch (responseError) {
            // If we can't send JSON response, log it
            console.error('[AssociateUser] Failed to send error response:', responseError);
            // Try to send a plain text response as last resort
            try {
                res.status(500).send(JSON.stringify({ 
                    error: 'Internal server error',
                    details: errorMessage
                }));
            } catch {
                // If all else fails, just log
                console.error('[AssociateUser] Complete failure to send response');
            }
        }
    }
}
