import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Buffer } from "buffer";

// Polyfill Buffer for browser (required by Privy and Web3 libraries)
if (typeof window !== "undefined") {
  (window as any).Buffer = Buffer;
  (globalThis as any).Buffer = Buffer;
}

// Suppress harmless WalletConnect warnings about session_request events
if (typeof window !== 'undefined') {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const message = args[0]?.toString() || '';
    // Filter out WalletConnect session_request warnings
    if (message.includes('emitting session_request') && message.includes('without any listeners')) {
      return; // Suppress this specific warning
    }
    originalError.apply(console, args);
  };
}

createRoot(document.getElementById("root")!).render(<App />);
