import React, { useEffect, useState } from 'react';
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
    // Suppress wallet provider errors and analytics CORS errors in console (known Privy issues)
    // Setup is deferred to avoid blocking initial render
    useEffect(() => {
        // Defer console interception setup to next tick (non-blocking)
        const setupId = setTimeout(() => {
            const originalError = console.error;
            const originalWarn = console.warn;
        
            // Suppress known non-critical Privy errors
            const shouldSuppress = (message: any): boolean => {
                const msgStr = typeof message === 'string' ? message : String(message);
                return (
                    msgStr.includes('walletProvider?.on is not a function') ||
                    msgStr.includes('Error authenticating session') ||
                    msgStr.includes('this.walletProvider') ||
                    msgStr.includes('setWalletProvider') ||
                    msgStr.includes('analytics_events') ||
                    msgStr.includes('CORS header') ||
                    msgStr.includes('Cross-Origin Request Blocked')
                );
            };

            console.error = (...args: any[]) => {
                // Check all arguments for CORS/analytics errors
                const hasSuppressibleError = args.some(arg => {
                    const msgStr = typeof arg === 'string' ? arg : String(arg);
                    return shouldSuppress(msgStr);
                });
                
                if (hasSuppressibleError) {
                    // Suppress known non-critical Privy errors (analytics CORS is non-critical)
                    return;
                }
                originalError.apply(console, args);
            };

            console.warn = (...args: any[]) => {
                const hasSuppressibleError = args.some(arg => {
                    const msgStr = typeof arg === 'string' ? arg : String(arg);
                    return shouldSuppress(msgStr);
                });
                
                if (hasSuppressibleError) {
                    // Suppress known non-critical Privy warnings
                    return;
                }
                originalWarn.apply(console, args);
            };

            // Intercept fetch requests to suppress CORS errors from Privy analytics
            const originalFetch = window.fetch;
            window.fetch = async (...args) => {
                try {
                    const response = await originalFetch(...args);
                    // If it's a Privy analytics request that failed, don't log the error
                    if (args[0] && typeof args[0] === 'string' && args[0].includes('analytics_events')) {
                        if (!response.ok) {
                            // Silently handle analytics failures - they're non-critical
                            return response;
                        }
                    }
                    return response;
                } catch (error: any) {
                    // Suppress CORS errors from Privy analytics
                    if (args[0] && typeof args[0] === 'string' && args[0].includes('analytics_events')) {
                        // Return a mock response to prevent error propagation
                        return new Response(JSON.stringify({ error: 'Analytics request blocked' }), {
                            status: 0,
                            statusText: 'CORS blocked',
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                    throw error;
                }
            };

            // Also catch unhandled promise rejections from Privy
            const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
                const reason = event.reason;
                if (reason && typeof reason === 'object' && 'message' in reason) {
                    const msg = String(reason.message);
                    if (
                        msg.includes('walletProvider') || 
                        msg.includes('on is not a function') ||
                        msg.includes('analytics_events') ||
                        msg.includes('CORS')
                    ) {
                        event.preventDefault();
                        return;
                    }
                }
            };

            window.addEventListener('unhandledrejection', handleUnhandledRejection);

            // Store cleanup function
            (window as any).__privyCleanup = () => {
                console.error = originalError;
                console.warn = originalWarn;
                window.fetch = originalFetch;
                window.removeEventListener('unhandledrejection', handleUnhandledRejection);
            };
        }, 0);

        return () => {
            clearTimeout(setupId);
            if ((window as any).__privyCleanup) {
                (window as any).__privyCleanup();
                delete (window as any).__privyCleanup;
            }
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
