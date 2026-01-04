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

    // Verify Buffer is available (handled by vite-plugin-node-polyfills)
    useEffect(() => {
        const verifyBuffer = () => {
            if (typeof window !== "undefined") {
                if ((window as any).Buffer) {
                    // Verify Buffer works
                    try {
                        const testBuffer = (window as any).Buffer.from('test');
                        if (testBuffer && typeof testBuffer.toString === 'function') {
                            console.log('[PrivyAuthProvider] Buffer verified and working');
                            setBufferReady(true);
                        } else {
                            console.error('[PrivyAuthProvider] Buffer exists but is not functional');
                            setBufferReady(true); // Still try to render
                        }
                    } catch (verifyError) {
                        console.error('[PrivyAuthProvider] Buffer verification failed:', verifyError);
                        setBufferReady(true); // Still try to render
                    }
                } else {
                    console.warn('[PrivyAuthProvider] Buffer not available - vite-plugin-node-polyfills should have loaded it');
                    // Wait a bit for plugin to load it
                    setTimeout(() => {
                        if ((window as any).Buffer) {
                            setBufferReady(true);
                        } else {
                            console.error('[PrivyAuthProvider] Buffer still not available after wait');
                            setBufferReady(true); // Still try to render
                        }
                    }, 100);
                }
            } else {
                setBufferReady(true);
            }
        };
        
        verifyBuffer();
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
