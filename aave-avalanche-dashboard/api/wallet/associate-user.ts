import { getRedis } from '../utils/redis';
import { verifyMessage } from 'ethers';

// POST /api/wallet/associate-user
export default async function handler(req: any, res: any) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

        try {
            const redis = getRedis();

            // Store mapping: wallet_owner:{walletAddress} -> privyUserId
            await redis.set(`wallet_owner:${walletAddress.toLowerCase()}`, privyUserId);

            // Also store reverse mapping just in case
            await redis.set(`user_wallet:${privyUserId}`, walletAddress.toLowerCase());
        } catch (redisError) {
            console.error('[AssociateUser] Redis error:', redisError);
            return res.status(500).json({ error: 'Failed to store wallet association', details: redisError instanceof Error ? redisError.message : String(redisError) });
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
        return res.status(500).json({ error: 'Internal server error' });
    }
}
