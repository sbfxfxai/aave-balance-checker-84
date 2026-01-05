// CRITICAL: Manually import Buffer polyfill at the very top
// This ensures Buffer is available before any Web3 libraries try to use it
// The vite-plugin-node-polyfills should handle this, but manual import ensures it works
import { Buffer } from 'buffer';
if (typeof window !== "undefined") {
  // Expose Buffer globally for libraries that expect it
  (window as any).Buffer = Buffer;
  (globalThis as any).Buffer = Buffer;
}

// CRITICAL: Detect SES lockdown from wallet extensions
// SES lockdown enforces stricter JavaScript semantics and can cause TDZ errors
if (typeof window !== "undefined") {
  // Check for SES lockdown (from MetaMask or other wallet extensions)
  if (typeof (window as any).lockdown !== 'undefined' || 
      typeof (window as any).harden !== 'undefined' ||
      (window as any).__SES__) {
    console.warn('[TiltVault] SES Lockdown detected - likely from wallet extension');
    console.warn('[TiltVault] This may cause compatibility issues with some bundles');
    (window as any).__SES_DETECTED__ = true;
  }
  
  // CRITICAL: Catch SES_UNCAUGHT_EXCEPTION errors that occur during module evaluation
  // These happen before React error boundaries can catch them
  const originalError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    const messageStr = String(message || '');
    const sourceStr = String(source || '');
    
    // Filter out known non-critical empty errors
    // Cloudflare Turnstile and other third-party scripts sometimes throw empty errors
    if (!messageStr && !error) {
      // Empty error with no source info - likely from third-party script
      // Only log in development to avoid console spam
      if (import.meta.env.DEV) {
        console.debug('[TiltVault] Empty error detected (likely third-party script):', { source: sourceStr, lineno, colno });
      }
      return false; // Suppress empty errors
    }
    
    // Filter out Cloudflare Turnstile errors (they're informational, not critical)
    if (sourceStr.includes('challenges.cloudflare.com') || 
        sourceStr.includes('turnstile') ||
        messageStr.includes('Private Access Token')) {
      // Cloudflare Turnstile informational messages - suppress
      return false;
    }
    
    // Check if this is a TDZ error from GMX SDK
    if (messageStr.includes("can't access lexical declaration") && 
        (messageStr.includes('before initialization') || messageStr.includes('uo'))) {
      console.error('[TiltVault] Caught GMX SDK TDZ error - likely due to SES lockdown');
      console.error('[TiltVault] Error details:', { message: messageStr, source: sourceStr, lineno, colno, error });
      
      // Set a flag that the GMX route can check
      (window as any).__GMX_SDK_ERROR__ = {
        type: 'TDZ_ERROR',
        message: messageStr,
        source: sourceStr,
        timestamp: Date.now()
      };
      
      // Don't prevent default - let it propagate but mark it as handled
      // The error boundary will catch it when the component tries to render
      return false;
    }
    
    // Log other errors with context (but only if they have meaningful content)
    if (messageStr || error) {
      // Only log if there's actual error content
      if (import.meta.env.DEV) {
        console.error('[TiltVault] Unhandled error:', {
          message: messageStr || '(no message)',
          source: sourceStr || '(unknown)',
          lineno: lineno || '(unknown)',
          colno: colno || '(unknown)',
          error: error ? (error.message || error.toString() || error) : '(no error object)'
        });
      }
    }
    
    // Call original error handler for other errors
    if (originalError) {
      return originalError(message, source, lineno, colno, error);
    }
    return false;
  };
  
  // Also catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    
    // Filter out empty promise rejections
    if (!reason || (typeof reason === 'object' && !reason.message && Object.keys(reason).length === 0)) {
      // Empty rejection - likely from third-party script
      if (import.meta.env.DEV) {
        console.debug('[TiltVault] Empty promise rejection detected (likely third-party script)');
      }
      event.preventDefault(); // Suppress empty rejections
      return;
    }
    
    // Filter out Cloudflare Turnstile rejections
    if (reason && typeof reason === 'object' && 'message' in reason) {
      const msg = String(reason.message || '');
      if (msg.includes('Private Access Token') || msg.includes('turnstile') || msg.includes('cloudflare')) {
        event.preventDefault(); // Suppress Cloudflare informational rejections
        return;
      }
    }
    
    if (reason && typeof reason === 'object' && 'message' in reason) {
      const msg = String(reason.message);
      if (msg.includes("can't access lexical declaration") && 
          (msg.includes('before initialization') || msg.includes('uo'))) {
        console.error('[TiltVault] Caught GMX SDK TDZ error in promise rejection');
        (window as any).__GMX_SDK_ERROR__ = {
          type: 'TDZ_ERROR',
          message: msg,
          source: 'unhandledrejection',
          timestamp: Date.now()
        };
        // Prevent default to avoid console spam
        event.preventDefault();
      }
    }
  });

  // CRITICAL: Set up console interceptors IMMEDIATELY to catch CSS parsing errors
  // These must run before CSS files are parsed to suppress third-party CSS warnings
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleLog = console.log;
  
  console.error = (...args: unknown[]) => {
    const message = args[0]?.toString() || '';
    const allArgsStr = args.map(arg => String(arg)).join(' ');
    
    // Suppress Privy analytics CORS errors
    if (
      message.includes('analytics_events') ||
      message.includes('CORS header') ||
      message.includes('Cross-Origin Request Blocked') ||
      args.some(arg => String(arg).includes('analytics_events') || String(arg).includes('CORS'))
    ) {
      return; // Suppress Privy analytics CORS errors
    }
    
    // Suppress CSS parsing errors from third-party sources (Privy, Cloudflare)
    if (
      message.includes('Error in parsing value') ||
      message.includes('Unknown property') ||
      message.includes('Declaration dropped') ||
      allArgsStr.includes('248cf8b6147e27db.css') ||
      allArgsStr.includes('auth.privy.io') ||
      allArgsStr.includes('challenges.cloudflare.com') ||
      allArgsStr.includes('-webkit-text-size-adjust') ||
      allArgsStr.includes('-moz-column-gap') ||
      allArgsStr.includes('normal:1:')
    ) {
      return; // Suppress CSS parsing errors
    }
    
    originalConsoleError.apply(console, args);
  };
  
  console.warn = (...args: unknown[]) => {
    const message = args[0]?.toString() || '';
    const allArgsStr = args.map(arg => String(arg)).join(' ');
    
    // Suppress Privy analytics CORS warnings
    if (
      message.includes('analytics_events') ||
      message.includes('CORS header') ||
      message.includes('Cross-Origin Request Blocked') ||
      args.some(arg => String(arg).includes('analytics_events') || String(arg).includes('CORS'))
    ) {
      return; // Suppress Privy analytics CORS warnings
    }
    
    // Suppress informational CSP warnings (these are expected when using nonces/hashes)
    if (
      message.includes('Content-Security-Policy') &&
      (message.includes("Ignoring") || 
       message.includes("'unsafe-inline'") ||
       message.includes("nonce-source or hash-source specified"))
    ) {
      return; // Suppress CSP informational warnings
    }
    
    // Suppress partitioned cookie/storage warnings (informational browser security feature)
    if (
      message.includes('Partitioned cookie') || 
      message.includes('Partitioned storage') ||
      allArgsStr.includes('Partitioned cookie') ||
      allArgsStr.includes('Partitioned storage')
    ) {
      return; // Suppress informational partitioned storage messages
    }
    
    // Suppress CSS parsing errors from third-party sources (Privy, Cloudflare)
    if (
      message.includes('Error in parsing value') ||
      message.includes('Unknown property') ||
      message.includes('Declaration dropped') ||
      allArgsStr.includes('248cf8b6147e27db.css') ||
      allArgsStr.includes('auth.privy.io') ||
      allArgsStr.includes('challenges.cloudflare.com') ||
      allArgsStr.includes('-webkit-text-size-adjust') ||
      allArgsStr.includes('-moz-column-gap') ||
      allArgsStr.includes('normal:1:')
    ) {
      return; // Suppress CSS parsing errors
    }
    
    // Suppress preload warnings for resources that may not be used immediately
    if (
      message.includes('preloaded with link preload was not used') ||
      (allArgsStr.includes('preload') && allArgsStr.includes('not used')) ||
      message.includes('preload tag are set correctly')
    ) {
      return; // Suppress preload warnings (resource may be used later or conditionally)
    }
    
    // Suppress OpaqueResponseBlocking warnings (usually CORS-related, informational)
    if (
      message.includes('OpaqueResponseBlocking') ||
      allArgsStr.includes('OpaqueResponseBlocking') ||
      message.includes('blocked by OpaqueResponseBlocking')
    ) {
      return; // Suppress OpaqueResponseBlocking warnings
    }
    
    originalConsoleWarn.apply(console, args);
  };
  
  // Suppress console.log messages for partitioned cookies and preload warnings
  console.log = (...args: unknown[]) => {
    const message = args[0]?.toString() || '';
    const allArgsStr = args.map(arg => String(arg)).join(' ');
    
    // Suppress partitioned cookie/storage access messages (informational browser security feature)
    if (message.includes('Partitioned cookie') || message.includes('Partitioned storage')) {
      return; // Suppress informational partitioned storage messages
    }
    
    // Suppress preload warnings for resources that may not be used immediately
    if (
      message.includes('preloaded with link preload was not used') ||
      (allArgsStr.includes('preload') && allArgsStr.includes('not used')) ||
      message.includes('preload tag are set correctly')
    ) {
      return; // Suppress preload warnings (resource may be used later or conditionally)
    }
    
    // Suppress OpaqueResponseBlocking warnings (usually CORS-related, informational)
    if (
      message.includes('OpaqueResponseBlocking') ||
      allArgsStr.includes('OpaqueResponseBlocking') ||
      message.includes('blocked by OpaqueResponseBlocking')
    ) {
      return; // Suppress OpaqueResponseBlocking warnings
    }
    
    originalConsoleLog.apply(console, args);
  };
}

// CRITICAL: React is now bundled WITH web3-vendor, so it will be available
// when web3-vendor executes. We still need to expose it globally for Privy.
// Import React - it will be available from web3-vendor chunk
import React from "react";
import ReactDOM from "react-dom/client";

// CRITICAL: Expose React globally for Privy and other libraries that expect it
// This must happen BEFORE Privy loads
if (typeof window !== "undefined") {
  (window as any).React = React;
  (window as any).ReactDOM = ReactDOM;
  console.log('[Entry] ✅ React and ReactDOM exposed globally');
  
  // Verify React is actually available
  if (!React || !React.useLayoutEffect || !React.createContext) {
    console.error('[Entry] ❌ CRITICAL: React is not properly loaded!');
    console.error('[Entry] React:', React);
    console.error('[Entry] useLayoutEffect:', typeof React?.useLayoutEffect);
    console.error('[Entry] createContext:', typeof React?.createContext);
  } else {
    console.log('[Entry] ✅ React verified - useLayoutEffect:', typeof React.useLayoutEffect);
    console.log('[Entry] ✅ React verified - createContext:', typeof React.createContext);
  }
}

// Import App and other dependencies
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Buffer polyfill is manually imported at the top and exposed globally
// Verify it's available and log status
if (typeof window !== "undefined") {
  if ((window as any).Buffer) {
    console.log('[TiltVault] ✅ Buffer polyfill available (manually imported)');
    // Verify Buffer works
    try {
      const test = (window as any).Buffer.from('test');
      if (test && typeof test.toString === 'function') {
        console.log('[TiltVault] ✅ Buffer verified and working');
      } else {
        console.error('[TiltVault] ❌ Buffer exists but is not functional');
      }
    } catch (error) {
      console.error('[TiltVault] ❌ Buffer verification failed:', error);
    }
  } else {
    console.error('[TiltVault] ❌ CRITICAL: Buffer not available after manual import!');
  }
}

// Early interceptors to suppress Privy analytics CORS errors (must run before Privy loads)
// Defer setup slightly to avoid blocking initial render
if (typeof window !== 'undefined') {
  // Use requestIdleCallback or setTimeout to defer non-critical interceptor setup
  const setupInterceptors = () => {
    // Intercept fetch requests early to catch Privy analytics
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : String(args[0]);
    
    // Block Privy analytics requests to prevent CORS errors
    if (url.includes('auth.privy.io/api/v1/analytics_events')) {
      // Return a successful mock response to prevent CORS error
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    try {
      return await originalFetch(...args);
    } catch (error: any) {
      // Suppress CORS errors from Privy analytics
      if (url.includes('analytics_events')) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw error;
    }
  };

    // Intercept XMLHttpRequest to catch Privy analytics (Privy might use XHR)
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('auth.privy.io/api/v1/analytics_events')) {
      // Store flag to suppress this request
      (this as any)._isPrivyAnalytics = true;
    }
    return originalXHROpen.apply(this, [method, url, ...rest] as any);
  };
  
  XMLHttpRequest.prototype.send = function(...args: any[]) {
    if ((this as any)._isPrivyAnalytics) {
      // Suppress Privy analytics XHR requests
      // Set status to success to prevent errors
      Object.defineProperty(this, 'status', { value: 200, writable: false });
      Object.defineProperty(this, 'readyState', { value: 4, writable: false });
      Object.defineProperty(this, 'responseText', { value: JSON.stringify({ success: true }), writable: false });
      
      // Trigger onload to prevent hanging
      if (this.onload) {
        setTimeout(() => this.onload?.call(this, {} as any), 0);
      }
      return;
    }
    return originalXHRSend.apply(this, args as any);
  };
  };

  // Defer interceptor setup to avoid blocking initial render
  // Use requestIdleCallback if available, otherwise setTimeout
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(setupInterceptors, { timeout: 100 });
  } else {
    setTimeout(setupInterceptors, 0);
  }
}
  

// Hide the initial loading shell once React app mounts
console.log('[TiltVault] Starting app initialization...');

try {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    console.error('[TiltVault] Root element not found');
    // Show error in loading screen
    const loadingText = document.querySelector('.tv-initial-loading');
    if (loadingText) {
      loadingText.textContent = 'Error: Root element not found';
    }
    throw new Error('Root element not found');
  }

  console.log('[TiltVault] Root element found, creating React root...');
  const root = createRoot(rootElement);
  
  console.log('[TiltVault] Rendering React app...');
  // Render the app
  root.render(<App />);
  
  console.log('[TiltVault] React app rendered, hiding loading screen...');
  // Hide loading screen immediately - React will handle the transition
  // Use requestAnimationFrame to ensure DOM is ready
  requestAnimationFrame(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.add('tv-app-loaded');
      console.log('[TiltVault] Loading screen hidden');
    }
  });
} catch (error) {
  console.error('[TiltVault] Failed to mount React app:', error);
  // Show error message
  const loadingText = document.querySelector('.tv-initial-loading') as HTMLElement | null;
  if (loadingText) {
    loadingText.textContent = 'Error loading app. Please refresh the page.';
    loadingText.style.color = '#ef4444';
  }
  // Still try to hide loading screen after showing error
  setTimeout(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.add('tv-app-loaded');
      console.log('[TiltVault] Loading screen hidden (error fallback)');
    }
  }, 2000);
}
