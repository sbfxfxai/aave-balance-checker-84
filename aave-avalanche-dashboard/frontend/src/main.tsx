// CRITICAL: Manually import Buffer polyfill at the very top
// This ensures Buffer is available before any Web3 libraries try to use it
// The vite-plugin-node-polyfills should handle this, but manual import ensures it works
import { Buffer } from 'buffer';

// Define interface for window with custom properties
interface WindowWithSES extends Window {
  lockdown?: unknown;
  harden?: unknown;
  __SES__?: unknown;
  __SES_DETECTED__?: boolean;
  __GMX_SDK_ERROR__?: {
    type: string;
    message: string;
    source: string;
    timestamp: number;
  };
  __TILTVAULT_MAIN_LOADED__?: boolean;
  Buffer?: typeof Buffer;
}

// Define windowWithSES at module level so it's available throughout
const windowWithSES: WindowWithSES | null = typeof window !== "undefined" ? window as WindowWithSES : null;

if (typeof window !== "undefined" && windowWithSES) {
  // Expose Buffer globally for libraries that expect it
  windowWithSES.Buffer = Buffer;
  (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer = Buffer;
}

// CRITICAL: Detect SES lockdown from wallet extensions
// SES lockdown enforces stricter JavaScript semantics and can cause TDZ errors
if (typeof window !== "undefined" && windowWithSES) {
  
  // Check for SES lockdown (from MetaMask or other wallet extensions)
  if (typeof windowWithSES.lockdown !== 'undefined' || 
      typeof windowWithSES.harden !== 'undefined' ||
      windowWithSES.__SES__) {
    console.warn('[TiltVault] SES Lockdown detected - likely from wallet extension');
    console.warn('[TiltVault] This may cause compatibility issues with some bundles');
    windowWithSES.__SES_DETECTED__ = true;
  }
  
  // Track GMX SDK TDZ errors for error boundary handling
  window.addEventListener('error', (event) => {
    const messageStr = String(event.message || '');
    if (messageStr.includes("can't access lexical declaration") && 
        (messageStr.includes('before initialization') || messageStr.includes('uo'))) {
      console.error('[TiltVault] Caught GMX SDK TDZ error - likely due to SES lockdown');
      windowWithSES.__GMX_SDK_ERROR__ = {
        type: 'TDZ_ERROR',
        message: messageStr,
        source: event.filename || 'unknown',
        timestamp: Date.now()
      };
    }
  });
  
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason && typeof reason === 'object' && 'message' in reason) {
      const msg = String(reason.message);
      if (msg.includes("can't access lexical declaration") && 
          (msg.includes('before initialization') || msg.includes('uo'))) {
        console.error('[TiltVault] Caught GMX SDK TDZ error in promise rejection');
        windowWithSES.__GMX_SDK_ERROR__ = {
          type: 'TDZ_ERROR',
          message: msg,
          source: 'unhandledrejection',
          timestamp: Date.now()
        };
      }
    }
  });

}

// CRITICAL: React is now bundled WITH web3-vendor, so it will be available
// when web3-vendor executes. We still need to expose it globally for Privy.
// Import React - it will be available from web3-vendor chunk
import React from "react";
import ReactDOM from "react-dom/client";

// CRITICAL: Expose React globally for Privy and other libraries that expect it
// This must happen BEFORE Privy loads
if (typeof window !== "undefined" && windowWithSES) {
  windowWithSES.React = React;
  console.log('[Entry] ✅ React exposed globally');
  
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
if (typeof window !== "undefined" && windowWithSES) {
  if (windowWithSES.Buffer) {
    console.log('[TiltVault] ✅ Buffer polyfill available (manually imported)');
    // Verify Buffer works
    try {
      const test = windowWithSES.Buffer.from('test');
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

// Hide the initial loading shell once React app mounts
// CRITICAL: Log immediately to verify script execution
if (typeof window !== 'undefined' && windowWithSES) {
  // Type assertion for custom window property
  windowWithSES.__TILTVAULT_MAIN_LOADED__ = true;
}
console.log('[TiltVault] ✅ main.tsx script loaded and executing');
console.log('[TiltVault] Starting app initialization...');

// Filter out verbose Privy debug logs
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
const originalConsoleDebug = console.debug;

const shouldSuppressLog = (message: unknown): boolean => {
  const messageStr = String(message || '');
  return (
    messageStr.includes('Detected injected providers') ||
    (messageStr.includes('Embedded') && messageStr.includes('Provider.request')) ||
    messageStr.includes('eth_accounts for privy') ||
    messageStr.includes('Unable to initialize all expected connectors') ||
    messageStr.includes('Wallet did not respond to eth_accounts') ||
    messageStr.includes('Defaulting to prefetched accounts') ||
    messageStr.includes('Error in parsing value for') ||
    messageStr.includes('Declaration dropped') ||
    messageStr.includes('Unknown property') ||
    messageStr.includes('-webkit-text-size-adjust') ||
    messageStr.includes('-moz-column-gap') ||
    messageStr.includes('NS_BINDING_ABORTED') ||
    messageStr.includes('XHR') && (messageStr.includes('ABORTED') || messageStr.includes('CORS Missing')) ||
    messageStr.includes('csp-report.browser-intake-datadoghq.com') ||
    messageStr.includes('dd-api-key') ||
    messageStr.includes('ddsource=csp-report') ||
    messageStr.includes('SES Removing unpermitted intrinsics') ||
    messageStr.includes('Removing intrinsics.%') ||
    messageStr.includes('Content-Security-Policy') ||
    messageStr.includes('blocked an inline script') ||
    messageStr.includes('violates the following directive') ||
    messageStr.includes('Cookie') && messageStr.includes('has been rejected') ||
    messageStr.includes('squareGeo') ||
    messageStr.includes('SameSite') ||
    messageStr.includes('DialogContent') && messageStr.includes('requires a DialogTitle') ||
    messageStr.includes('requires a DialogTitle')
  );
};

console.log = (...args: unknown[]) => {
  if (!shouldSuppressLog(args[0])) {
    originalConsoleLog.apply(console, args);
  }
};

console.info = (...args: unknown[]) => {
  if (!shouldSuppressLog(args[0])) {
    originalConsoleInfo.apply(console, args);
  }
};

console.debug = (...args: unknown[]) => {
  if (!shouldSuppressLog(args[0])) {
    originalConsoleDebug.apply(console, args);
  }
};

// Global error handler to catch any uncaught errors
window.addEventListener('error', (event) => {
  // Filter out undefined/empty errors (often from browser extensions or harmless events)
  if (!event.message && !event.filename && !event.error) {
    return; // Skip logging undefined errors
  }
  
  // Filter out non-critical errors (MetaMask, Privy iframe, etc.)
  const errorMessage = String(event.message || '');
  const filename = String(event.filename || '');
  
  // Skip known non-critical errors
  if (
    errorMessage.includes('MetaMask') ||
    errorMessage.includes('lockdown') ||
    errorMessage.includes('SES') ||
    errorMessage.includes('Removing unpermitted intrinsics') ||
    errorMessage.includes('Removing intrinsics.%') ||
    errorMessage.includes('Content-Security-Policy') ||
    errorMessage.includes('blocked an inline script') ||
    errorMessage.includes('violates the following directive') ||
    errorMessage.includes('Ignoring') && errorMessage.includes('unsafe-inline') ||
    errorMessage.includes('CORS Missing Allow Origin') ||
    errorMessage.includes('analytics_events') ||
    errorMessage.includes('OpaqueResponseBlocking') ||
    errorMessage.includes('Partitioned cookie') ||
    errorMessage.includes('Cookie') && errorMessage.includes('has been rejected') ||
    errorMessage.includes('squareGeo') ||
    errorMessage.includes('SameSite') ||
    errorMessage.includes('Detected injected providers') ||
    errorMessage.includes('Error in parsing value for') ||
    errorMessage.includes('Declaration dropped') ||
    errorMessage.includes('Unknown property') ||
    errorMessage.includes('-webkit-text-size-adjust') ||
    errorMessage.includes('-moz-column-gap') ||
    errorMessage.includes('Embedded') && errorMessage.includes('Provider.request') ||
    errorMessage.includes('eth_accounts for privy') ||
    errorMessage.includes('Unable to initialize all expected connectors') ||
    errorMessage.includes('Wallet did not respond to eth_accounts') ||
    errorMessage.includes('Exceeded max attempts') && errorMessage.includes('eth_accounts') ||
    errorMessage.includes('DialogContent') && errorMessage.includes('requires a DialogTitle') ||
    errorMessage.includes('requires a DialogTitle') ||
    filename.includes('lockdown-install.js') ||
    filename.includes('contentscript.js') ||
    filename.includes('inpage.js') ||
    filename.includes('embedded-wallets') ||
    filename.includes('index-C2WInh_O.js') || // Privy bundle
    (errorMessage === 'Unknown error' && !event.error) // Generic undefined errors
  ) {
    return; // Don't log these as they're expected
  }
  
  // Log actual errors with full details
  console.error('[TiltVault] ❌ Error caught:', {
    message: event.message || 'Unknown error',
    filename: event.filename || 'unknown',
    lineno: event.lineno || 0,
    colno: event.colno || 0,
    error: event.error ? (event.error.toString() + (event.error.stack ? '\n' + event.error.stack : '')) : 'no error object',
    timestamp: new Date().toISOString()
  });
  
  const loadingText = document.querySelector('.tv-initial-loading') as HTMLElement | null;
  if (loadingText && !document.body.classList.contains('tv-app-loaded') && event.message) {
    loadingText.textContent = `Error: ${event.message}. Check console.`;
    loadingText.style.color = '#ef4444';
  }
}, true);

// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const reasonStr = reason ? (typeof reason === 'string' ? reason : reason.toString()) : 'Unknown';
  
  // Filter out known non-critical rejections
  if (
    reasonStr.includes('MetaMask') ||
    reasonStr.includes('lockdown') ||
    reasonStr.includes('SES') ||
    reasonStr.includes('Removing unpermitted intrinsics') ||
    reasonStr.includes('Content-Security-Policy') ||
    reasonStr.includes('Ignoring') && reasonStr.includes('unsafe-inline') ||
    reasonStr.includes('CORS Missing Allow Origin') ||
    reasonStr.includes('analytics_events') ||
    reasonStr.includes('OpaqueResponseBlocking') ||
    reasonStr.includes('Partitioned cookie') ||
    reasonStr.includes('Detected injected providers') ||
    reasonStr.includes('Error in parsing value for') ||
    reasonStr.includes('Declaration dropped') ||
    reasonStr.includes('Unknown property') ||
    reasonStr.includes('-webkit-text-size-adjust') ||
    reasonStr.includes('-moz-column-gap') ||
    reasonStr.includes('Embedded') && reasonStr.includes('Provider.request') ||
    reasonStr.includes('eth_accounts for privy') ||
    reasonStr.includes('Unable to initialize all expected connectors') ||
    reasonStr.includes('Wallet did not respond to eth_accounts') ||
    reasonStr.includes('DialogContent') && reasonStr.includes('requires a DialogTitle') ||
    reasonStr.includes('requires a DialogTitle') ||
    (reasonStr.includes('Exceeded max attempts') && reasonStr.includes('eth_accounts'))
  ) {
    return; // Don't log these as they're expected
  }
  
  // Log actual rejections with full details
  console.error('[TiltVault] ❌ Unhandled promise rejection:', {
    reason: reasonStr,
    stack: reason instanceof Error ? reason.stack : undefined,
    timestamp: new Date().toISOString()
  });
  
  const loadingText = document.querySelector('.tv-initial-loading') as HTMLElement | null;
  if (loadingText && !document.body.classList.contains('tv-app-loaded')) {
    loadingText.textContent = 'Error: Promise rejection. Check console.';
    loadingText.style.color = '#ef4444';
  }
});

try {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    console.error('[TiltVault] ❌ Root element not found');
    // Show error in loading screen
    const loadingText = document.querySelector('.tv-initial-loading');
    if (loadingText) {
      loadingText.textContent = 'Error: Root element not found';
      (loadingText as HTMLElement).style.color = '#ef4444';
    }
    throw new Error('Root element not found');
  }

  console.log('[TiltVault] ✅ Root element found, creating React root...');
  const root = createRoot(rootElement);
  
  console.log('[TiltVault] ✅ Rendering React app...');
  // Render the app
  root.render(<App />);
  
  console.log('[TiltVault] ✅ React app rendered, hiding loading screen...');
  // Hide loading screen after React has had time to render
  // Use requestAnimationFrame to ensure DOM is ready
  requestAnimationFrame(() => {
    setTimeout(() => {
      if (typeof document !== 'undefined') {
        document.body.classList.add('tv-app-loaded');
        console.log('[TiltVault] ✅ Loading screen hidden');
      }
    }, 100); // Small delay to allow React to render
  });
  
  // Safety timeout: If app doesn't render within 5 seconds, show error
  setTimeout(() => {
    if (typeof document !== 'undefined' && !document.body.classList.contains('tv-app-loaded')) {
      console.error('[TiltVault] ❌ App did not render within timeout period');
      const loadingText = document.querySelector('.tv-initial-loading') as HTMLElement | null;
      if (loadingText) {
        loadingText.textContent = 'Error: App is taking too long to load. Please refresh.';
        loadingText.style.color = '#ef4444';
      }
    }
  }, 5000);
} catch (error) {
  console.error('[TiltVault] ❌ Failed to mount React app:', error);
  console.error('[TiltVault] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
  // Show error message
  const loadingText = document.querySelector('.tv-initial-loading') as HTMLElement | null;
  if (loadingText) {
    loadingText.textContent = `Error loading app: ${error instanceof Error ? error.message : 'Unknown error'}. Please refresh the page.`;
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
