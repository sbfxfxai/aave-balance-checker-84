import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
// Updated: Force rebuild for env vars
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      buffer: "buffer",
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
  },
  build: {
    target: "es2020",
    // Extract CSS to separate files (prevents render blocking)
    cssCodeSplit: true,
    // Use esbuild for faster builds (better than terser for most cases)
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
        manualChunks: (id) => {
          // Core React - CRITICAL: React, React-DOM, and scheduler must be in the same chunk
          // The scheduler is required by React-DOM and must be available when React-DOM loads
          // Check for exact package names to avoid partial matches
          if (id.includes('node_modules/react/') && !id.includes('react-router')) {
            return 'react-core';
          }
          if (id.includes('node_modules/react-dom/')) {
            return 'react-core';
          }
          if (id.includes('node_modules/scheduler/')) {
            return 'react-core';
          }
          
          // Router - can be slightly deferred
          if (id.includes('react-router')) {
            return 'react-router';
          }
          
          // GMX SDK - only used on /gmx page, separate chunk
          if (id.includes('@gmx-io/sdk')) {
            return 'gmx-sdk';
          }
          
          // Privy - heavy auth library, separate chunk
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
          
          // Buffer polyfill - only needed for Web3
          if (id.includes('buffer')) {
            return 'buffer-polyfill';
          }
          
          // UI components - lazy load (Radix UI is heavy)
          if (id.includes('@radix-ui')) {
            return 'ui-vendor';
          }
          
          // Charts - lazy load (only if used)
          if (id.includes('recharts') || id.includes('d3-')) {
            return 'chart-vendor';
          }
          
          // Query - lazy load
          if (id.includes('@tanstack')) {
            return 'query-vendor';
          }
          
          // Lucide icons - lazy load (can be large)
          if (id.includes('lucide-react')) {
            return 'icons';
          }
          
          // Other vendor libraries
          if (id.includes('node_modules/')) {
            // Group smaller vendor libs together
            return 'vendor';
          }
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["@noble/curves"],
    include: [
      "@privy-io/react-auth",
      "react",
      "react-dom",
      "react/jsx-runtime",
      "scheduler", // CRITICAL: Scheduler must be pre-bundled with React
      "viem", // Pre-bundle viem to resolve circular deps
      "wagmi" // Pre-bundle wagmi (depends on viem)
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
