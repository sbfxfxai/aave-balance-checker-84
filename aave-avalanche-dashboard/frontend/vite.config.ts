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
  },
  define: {
    global: "globalThis",
    "process.env": {},
  },
  build: {
    target: "es2020",
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Core React - needed immediately
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-core';
          }
          // Router - can be slightly deferred
          if (id.includes('react-router')) {
            return 'react-router';
          }
          // Web3 - heavy, lazy load
          if (id.includes('wagmi') || id.includes('viem') || id.includes('ethers') || id.includes('@wagmi')) {
            return 'web3-vendor';
          }
          // UI components - lazy load
          if (id.includes('@radix-ui')) {
            return 'ui-vendor';
          }
          // Charts - lazy load
          if (id.includes('recharts') || id.includes('d3-')) {
            return 'chart-vendor';
          }
          // Query - lazy load
          if (id.includes('@tanstack')) {
            return 'query-vendor';
          }
          // Lucide icons - lazy load
          if (id.includes('lucide-react')) {
            return 'icons';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  optimizeDeps: {
    exclude: ["@noble/curves"],
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
