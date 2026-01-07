// React is already exposed globally in main.tsx before any imports
// No need to expose it again here - it's already available for Privy
import React, { useEffect, useState } from 'react';
// @ts-ignore - @privy-io/react-auth types exist but TypeScript can't resolve them due to package.json exports configuration
import { PrivyProvider } from '@privy-io/react-auth';
import { PRIVY_APP_ID, privyConfig } from '@/lib/privy-config';

interface PrivyAuthProviderProps {
    children: React.ReactNode;
}

/**
 * PrivyAuthProvider wraps the app with Privy authentication
 * This enables email-based login and smart wallet creation
 * 
 * CRITICAL: Buffer polyfill must be loaded BEFORE PrivyProvider renders
 * because Privy uses Buffer synchronously for transaction signing
 */
export function PrivyAuthProvider({ children }: PrivyAuthProviderProps) {
    const [bufferReady, setBufferReady] = useState(false);

    // Ensure Buffer is available (vite-plugin-node-polyfills should provide it, but ensure it's on window)
    useEffect(() => {
        let timeoutId: NodeJS.Timeout;
        
        const ensureBuffer = async () => {
            if (typeof window !== "undefined") {
                // Check if Buffer is already available
                if ((window as any).Buffer) {
                    try {
                        const testBuffer = (window as any).Buffer.from('test');
                        if (testBuffer && typeof testBuffer.toString === 'function') {
                            console.log('[PrivyAuthProvider] Buffer verified and working');
                            setBufferReady(true);
                            return;
                        }
                    } catch (error) {
                        console.warn('[PrivyAuthProvider] Buffer exists but verification failed, will reload:', error);
                    }
                }
                
                // Try to import Buffer if not available (vite-plugin-node-polyfills should make this work)
                try {
                    const { Buffer } = await import("buffer");
                    (window as any).Buffer = Buffer;
                    (globalThis as any).Buffer = Buffer;
                    
                    // Verify it works
                    const testBuffer = Buffer.from('test');
                    if (testBuffer && typeof testBuffer.toString === 'function') {
                        console.log('[PrivyAuthProvider] Buffer loaded and verified');
                        setBufferReady(true);
                        return;
                    }
                } catch (importError) {
                    console.error('[PrivyAuthProvider] Failed to import Buffer:', importError);
                }
                
                // If we get here, Buffer isn't available - but still try to render
                // Privy might work without it, or the error will be more informative
                console.warn('[PrivyAuthProvider] Buffer not available, proceeding anyway');
                setBufferReady(true);
            } else {
                setBufferReady(true);
            }
        };
        
        // Set a maximum timeout to prevent infinite loading
        timeoutId = setTimeout(() => {
            console.warn('[PrivyAuthProvider] Timeout reached, proceeding without Buffer verification');
            setBufferReady(true);
        }, 2000); // 2 second max wait
        
        ensureBuffer().then(() => {
            clearTimeout(timeoutId);
        });
        
        return () => {
            clearTimeout(timeoutId);
        };
    }, []);

    // Don't render PrivyProvider until Buffer is ready
    // This prevents "fromByteArray" errors when Privy tries to sign transactions
    if (!bufferReady) {
        return (
            <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
                <div className="animate-pulse bg-muted h-10 w-32 rounded-md" />
            </div>
        );
    }

    return (
        <PrivyProvider
            appId={PRIVY_APP_ID}
            config={privyConfig}
        >
            {children}
        </PrivyProvider>
    );
}

export default PrivyAuthProvider;
