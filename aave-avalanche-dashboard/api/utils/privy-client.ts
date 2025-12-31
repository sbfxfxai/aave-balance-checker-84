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
        // Wrap in try-catch to handle @hpke dependency errors gracefully
        let privyModule;
        try {
            privyModule = await import('@privy-io/server-auth');
        } catch (importError) {
            const errorMsg = importError instanceof Error ? importError.message : String(importError);
            const errorStack = importError instanceof Error ? importError.stack : undefined;
            
            // Check if it's the known @hpke dependency issue
            if (errorMsg.includes('errors.js') || errorMsg.includes('@hpke') || errorMsg.includes('Cannot find module')) {
                console.error('[PrivyClient] Known @hpke dependency issue detected');
                console.error('[PrivyClient] Error:', errorMsg);
                if (errorStack) {
                    console.error('[PrivyClient] Stack:', errorStack);
                }
                privyImportError = new Error(`Privy SDK dependency error (@hpke): ${errorMsg}. This is a known issue with @privy-io/server-auth dependencies.`);
                return { privyClient: null, error: privyImportError };
            }
            // Re-throw if it's a different error
            throw importError;
        }
        
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
        if (privyImportError.stack) {
            console.error('[PrivyClient] Stack:', privyImportError.stack);
        }
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

/**
 * Check if Privy client is available (not blocked by @hpke dependency issue)
 * @returns true if Privy is available, false if blocked by dependency issues
 */
export async function isPrivyAvailable(): Promise<boolean> {
    if (privyClient !== null) {
        return true;
    }
    
    if (privyImportError !== null) {
        const errorMsg = privyImportError.message;
        // Check if it's the @hpke dependency issue
        if (errorMsg.includes('@hpke') || errorMsg.includes('errors.js') || errorMsg.includes('Cannot find module')) {
            return false;
        }
        // Other errors might be recoverable
        return false;
    }
    
    // Try to initialize
    const result = await initPrivyClient();
    return result.privyClient !== null;
}

/**
 * Get the Privy import error if available
 * @returns Error message if Privy is unavailable, null if available
 */
export function getPrivyError(): Error | null {
    return privyImportError;
}
