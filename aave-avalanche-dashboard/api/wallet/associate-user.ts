import { getRedis } from '../square/webhook';
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
        if (signature && message) {
            try {
                const recoveredAddress = verifyMessage(message, signature);
                if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
                    return res.status(401).json({ error: 'Invalid signature - wallet ownership verification failed' });
                }
                console.log(`[AssociateUser] Signature verified for ${walletAddress}`);
            } catch (sigError) {
                console.error('[AssociateUser] Signature verification error:', sigError);
                return res.status(400).json({ error: 'Signature verification failed' });
            }
        } else {
            console.warn(`[AssociateUser] No signature provided for ${walletAddress} (Implicit Association)`);
            // TODO: Enforce signature in production?
        }

        const redis = getRedis();

        // Store mapping: wallet_owner:{walletAddress} -> privyUserId
        await redis.set(`wallet_owner:${walletAddress}`, privyUserId);

        // Also store reverse mapping just in case
        await redis.set(`user_wallet:${privyUserId}`, walletAddress);

        console.log(`[AssociateUser] Linked ${walletAddress} to ${privyUserId}`);

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('[AssociateUser] Error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
