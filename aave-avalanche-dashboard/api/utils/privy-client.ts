import { PrivyClient } from '@privy-io/server-auth';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

let privyClient: PrivyClient | null = null;

export function getPrivyClient(): PrivyClient {
    if (!privyClient) {
        if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
            throw new Error('Privy App ID or Secret not configured');
        }
        privyClient = new PrivyClient(PRIVY_APP_ID!, PRIVY_APP_SECRET!);
    }
    return privyClient;
}
