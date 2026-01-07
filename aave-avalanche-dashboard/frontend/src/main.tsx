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
  
  // Track GMX SDK TDZ errors for error boundary handling
  window.addEventListener('error', (event) => {
    const messageStr = String(event.message || '');
    if (messageStr.includes("can't access lexical declaration") && 
        (messageStr.includes('before initialization') || messageStr.includes('uo'))) {
      console.error('[TiltVault] Caught GMX SDK TDZ error - likely due to SES lockdown');
      (window as any).__GMX_SDK_ERROR__ = {
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
        (window as any).__GMX_SDK_ERROR__ = {
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

// Hide the initial loading shell once React app mounts
// CRITICAL: Log immediately to verify script execution
if (typeof window !== 'undefined') {
  window.__TILTVAULT_MAIN_LOADED__ = true;
}
console.log('[TiltVault] ✅ main.tsx script loaded and executing');
console.log('[TiltVault] Starting app initialization...');

// Global error handler to catch any uncaught errors
window.addEventListener('error', (event) => {
  // Filter out non-critical errors (MetaMask, Privy iframe, etc.)
  const errorMessage = String(event.message || '');
  const filename = String(event.filename || '');
  
  // Skip known non-critical errors
  if (
    errorMessage.includes('MetaMask') ||
    errorMessage.includes('lockdown') ||
    errorMessage.includes('SES') ||
    errorMessage.includes('Content-Security-Policy') ||
    filename.includes('lockdown-install.js') ||
    filename.includes('contentscript.js') ||
    filename.includes('inpage.js') ||
    filename.includes('embedded-wallets')
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
  if (loadingText && !document.body.classList.contains('tv-app-loaded')) {
    loadingText.textContent = `Error: ${event.message || 'Unknown error'}. Check console.`;
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
    reasonStr.includes('Content-Security-Policy') ||
    reasonStr.includes('Exceeded max attempts') && reasonStr.includes('eth_accounts')
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
