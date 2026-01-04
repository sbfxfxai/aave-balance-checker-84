import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// https://vitejs.dev/config/
// Updated: Force rebuild for env vars
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    // CRITICAL: Use node polyfills plugin to properly handle Buffer without breaking it
    // This plugin handles Buffer polyfill correctly without breaking internal dependencies
    nodePolyfills({
      // Polyfill Buffer and process
      include: ['buffer'],
      // Globals that need to be polyfilled - these will be available on window/globalThis
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      // Use protocol imports for better compatibility
      protocolImports: true,
      // Ensure Buffer is available as a global
      polyfills: {
        buffer: true,
      },
    }),
    mode === "development" && componentTagger()
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Don't alias buffer - let vite-plugin-node-polyfills handle it
      // buffer: "buffer",
    },
    dedupe: [
      "@privy-io/react-auth",
      "react",
      "react-dom",
      "scheduler" // Ensure single scheduler instance
    ],
  },
  define: {
    global: "globalThis",
    "process.env": {},
    // Ensure process.browser is available for buffer polyfill
    "process.browser": true,
  },
  build: {
    target: "es2020",
    // Extract CSS to separate files (prevents render blocking)
    cssCodeSplit: true,
    // Use esbuild for faster builds
    // CRITICAL: Buffer polyfill is handled by vite-plugin-node-polyfills
    // which should prevent it from being broken during bundling
    minify: "esbuild",
    // Enable source maps for debugging (can be disabled in production for smaller size)
    sourcemap: process.env.NODE_ENV === "development",
    // Report compressed sizes to help identify large bundles
    reportCompressedSize: true,
    // Optimize chunk sizes
    chunkSizeWarningLimit: 600,
    // Enable CSS minification
    cssMinify: true,
    // Optimize asset inlining threshold (small assets inline, large ones external)
    assetsInlineLimit: 4096, // 4KB - inline smaller assets
    rollupOptions: {
      output: {
        // CRITICAL: Don't minify buffer polyfill - it breaks internal code
        // Use a function to conditionally minify
        // Ensure proper chunk loading order - React must load before Privy and web3-vendor
        // Use consistent chunk names for preloading
        manualChunks: (id) => {
          // CRITICAL: React MUST be in the main entry chunk (not a separate chunk)
          // This ensures React loads synchronously before Privy tries to use it
          // Privy is imported directly in App.tsx, so it loads with the main entry
          // If React is in a separate chunk, Privy's code executes before React is ready
          // Don't chunk React separately - let it be in the main entry point
          // This prevents "can't access property useLayoutEffect of undefined" errors
          
          // Only chunk React if it's not in the entry point
          // For now, let React be in the main entry to ensure it loads first
          // if (id.includes('node_modules/react/') && !id.includes('react-router')) {
          //   return 'react-core';
          // }
          // if (id.includes('node_modules/react-dom/')) {
          //   return 'react-core';
          // }
          // if (id.includes('node_modules/scheduler/')) {
          //   return 'react-core';
          // }
          
          // CRITICAL: React Query must be with React - it uses React.useLayoutEffect
          // But since React is in the main entry, React Query should also be in the main entry
          // if (id.includes('@tanstack')) {
          //   return 'react-core';
          // }
          
          // Router - can be slightly deferred
          if (id.includes('react-router')) {
            return 'react-router';
          }
          
          // GMX SDK - only used on /gmx page, separate chunk
          if (id.includes('@gmx-io/sdk')) {
            return 'gmx-sdk';
          }
          
          // Privy - CRITICAL: Must load AFTER React is available
          // Privy uses React.useLayoutEffect, so React must be loaded first
          // Keep Privy separate but ensure proper load order via chunk dependencies
          if (id.includes('@privy-io')) {
            return 'privy';
          }
          
          // Web3 libraries - keep viem and wagmi together to avoid circular deps
          // Viem must be available when wagmi loads, so bundle them together
          if (id.includes('node_modules/viem/') || 
              id.includes('node_modules/wagmi/') || 
              id.includes('node_modules/@wagmi/')) {
            return 'web3-vendor';
          }
          
          // Ethers.js - separate from viem/wagmi (different ecosystem)
          if (id.includes('node_modules/ethers/')) {
            return 'ethers-core';
          }
          
          // Buffer polyfill - DO NOT chunk it separately, let vite-plugin-node-polyfills handle it
          // Chunking buffer separately breaks its internal dependencies
          // if (id.includes('node_modules/buffer/') || id.includes('node_modules\\buffer\\')) {
          //   return 'buffer-polyfill';
          // }
          
          // UI components - lazy load (Radix UI is heavy)
          if (id.includes('@radix-ui')) {
            return 'ui-vendor';
          }
          
          // Charts - lazy load (only if used)
          if (id.includes('recharts') || id.includes('d3-')) {
            return 'chart-vendor';
          }
          
          // Lucide icons - lazy load (can be large)
          if (id.includes('lucide-react')) {
            return 'icons';
          }
          
          // Don't create a catch-all vendor chunk - let Vite handle remaining dependencies
          // This prevents circular dependency issues from bundling unrelated libraries together
          // Return undefined to let Vite's default chunking handle it
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    // CRITICAL: Exclude buffer from optimization - it breaks when optimized/bundled
    // Buffer must be loaded as-is to prevent "fromByteArray" errors
    exclude: ["@noble/curves", "buffer"],
    include: [
      // CRITICAL: React and ReactDOM must be pre-bundled and available first
      "react",
      "react-dom",
      "react/jsx-runtime",
      "scheduler", // CRITICAL: Scheduler must be pre-bundled with React
      "@privy-io/react-auth", // Privy depends on React, so include it after React
      "viem", // Pre-bundle viem to resolve circular deps
      "wagmi" // Pre-bundle wagmi (depends on viem)
      // NOTE: buffer is excluded - it must be loaded as-is to prevent bundling issues
    ],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  ssr: {
    noExternal: []
  }
}));
