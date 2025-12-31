// Dynamic import to avoid @hpke dependency issues
let PrivyClient: any = null;
let privyClient: any = null;
let privyImportError: Error | null = null;

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

async function initPrivyClient() {
    if (privyClient !== null || privyImportError !== null) {
        return { privyClient, error: privyImportError };
    }

    try {
        // Dynamic import to avoid static import issues with @hpke
        const privyModule = await import('@privy-io/server-auth');
        PrivyClient = privyModule.PrivyClient;
        
        if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
            privyImportError = new Error('Privy App ID or Secret not configured');
            return { privyClient: null, error: privyImportError };
        }
        
        privyClient = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);
        console.log('[PrivyClient] Successfully initialized PrivyClient');
        return { privyClient, error: null };
    } catch (error) {
        privyImportError = error instanceof Error ? error : new Error(String(error));
        console.error('[PrivyClient] Failed to import @privy-io/server-auth:', privyImportError.message);
        return { privyClient: null, error: privyImportError };
    }
}

export async function getPrivyClient(): Promise<any> {
    if (privyClient !== null) {
        return privyClient;
    }
    
    if (privyImportError !== null) {
        throw privyImportError;
    }
    
    const result = await initPrivyClient();
    if (!result.privyClient) {
        throw result.error || new Error('Privy client initialization failed');
    }
    
    return result.privyClient;
}
