import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Lazy load Buffer polyfill only when Web3 is needed (deferred)
// This reduces initial bundle size since Buffer is only needed for Web3 operations
const setupBufferPolyfill = async () => {
  if (typeof window !== "undefined" && !(window as any).Buffer) {
    const { Buffer } = await import("buffer");
    (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
    (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
  }
};

// Setup Buffer polyfill in background (non-blocking)
setupBufferPolyfill().catch(() => {
  // Silently fail - Buffer will be loaded when Web3 providers initialize
});

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
    return originalXHRSend.apply(this, args);
  };

  // Suppress console errors for CORS, analytics, and informational CSP warnings
  const originalError = console.error;
  const originalWarn = console.warn;
  
  console.error = (...args: unknown[]) => {
    const message = args[0]?.toString() || '';
    // Filter out WalletConnect session_request warnings
    if (message.includes('emitting session_request') && message.includes('without any listeners')) {
      return; // Suppress this specific warning
    }
    // Suppress Privy analytics CORS errors
    if (
      message.includes('analytics_events') ||
      message.includes('CORS header') ||
      message.includes('Cross-Origin Request Blocked') ||
      args.some(arg => String(arg).includes('analytics_events') || String(arg).includes('CORS'))
    ) {
      return; // Suppress Privy analytics CORS errors
    }
    originalError.apply(console, args);
  };
  
  console.warn = (...args: unknown[]) => {
    const message = args[0]?.toString() || '';
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
      (message.includes("Ignoring") || message.includes("'unsafe-inline'"))
    ) {
      return; // Suppress CSP informational warnings
    }
    originalWarn.apply(console, args);
  };
  
  // Suppress console.log messages for partitioned cookies (informational browser security messages)
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const message = args[0]?.toString() || '';
    // Suppress partitioned cookie/storage access messages (informational browser security feature)
    if (message.includes('Partitioned cookie') || message.includes('Partitioned storage')) {
      return; // Suppress informational partitioned storage messages
    }
    originalLog.apply(console, args);
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
  const loadingText = document.querySelector('.tv-initial-loading');
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
