import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Plugin to handle GMX SDK's broken internal dependencies
// The GMX SDK has broken relative imports that reference non-existent files
// Since we lazy-load the SDK at runtime, we provide stubs during build
const gmxSdkPlugin = (): Plugin => ({
  name: 'gmx-sdk-resolver',
  resolveId(id, importer) {
    // Handle GMX SDK's broken relative imports
    if (importer?.includes('@gmx-io/sdk') && (id.startsWith('../../configs/') || id.startsWith('../configs/'))) {
      // Mark as resolved with a virtual ID
      return `\0gmx-sdk-config-${id}`;
    }
    return null;
  },
  load(id) {
    // Provide empty stubs for missing GMX SDK config files
    if (id.startsWith('\0gmx-sdk-config-')) {
      // Return an empty export object - the actual configs are loaded at runtime
      return 'export default {};';
    }
    return null;
  },
});

// Plugin to handle ox package resolution
// Only resolve the main 'ox' import to ESM - let Vite handle subpaths via package.json exports
// This preserves proper export resolution for namespace exports like SignatureErc6492
const oxResolverPlugin = (): Plugin => ({
  name: 'ox-resolver',
  enforce: 'pre', // Must run before commonjs resolver
  resolveId(id) {
    // Only handle ox package main import - let Vite handle subpaths via package.json exports
    // This ensures namespace exports and other complex exports work correctly
    if (id === 'ox') {
      // Resolve to ESM version directly
      return path.resolve(__dirname, 'node_modules/ox/_esm/index.js');
    }
    // For subpaths (ox/erc6492, ox/erc8010, etc.), return null to let Vite
    // handle them through package.json exports field, which properly resolves
    // namespace exports and other complex export patterns
    return null;
  },
});


// https://vitejs.dev/config/
// Updated: Force rebuild for env vars
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    // Handle ox package resolution (must be before other resolvers)
    oxResolverPlugin(),
    // Handle GMX SDK's broken internal dependencies
    gmxSdkPlugin(),
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
    // Force ESM resolution for packages that have both CJS and ESM
    // This ensures 'ox' and other packages use their ESM versions
    conditions: ['import', 'module', 'browser', 'default'],
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
          // Temporarily disable minification to see clearer TDZ errors
          minify: process.env.NODE_ENV === "production" ? "esbuild" : false,
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
              // CRITICAL: Force .js extension for all output files (not .tsx)
              // This ensures proper MIME type and module loading
              entryFileNames: 'assets/[name]-[hash].js',
              chunkFileNames: 'assets/[name]-[hash].js',
              assetFileNames: 'assets/[name]-[hash].[ext]',
              // Use ES module format to avoid hoisting issues with SES lockdown
              format: 'es',
              // CRITICAL: Disable code splitting entirely to avoid SES TDZ errors
              // SES lockdown from wallet extensions causes TDZ errors when chunks load in wrong order
              // By inlining everything, we ensure all code loads synchronously in correct order
              inlineDynamicImports: true,
              // Preserve module structure to avoid TDZ errors
              preserveModules: false,
              // DISABLED: No manual chunks - everything inlined to avoid SES TDZ errors
              // All code will be inlined into a single bundle
              // This ensures correct load order and prevents TDZ errors from chunk dependencies
      },
    },
  },
  optimizeDeps: {
    // CRITICAL: Exclude buffer from optimization - it breaks when optimized/bundled
    // Buffer must be loaded as-is to prevent "fromByteArray" errors
    // Exclude GMX SDK - it has broken internal dependencies and is lazy-loaded at runtime
    exclude: ["@noble/curves", "buffer", "@gmx-io/sdk"],
    include: [
      // CRITICAL: React and ReactDOM must be pre-bundled and available first
      "react",
      "react-dom",
      "react/jsx-runtime",
      "scheduler", // CRITICAL: Scheduler must be pre-bundled with React
      "@privy-io/react-auth", // Privy depends on React, so include it after React
      "viem", // Pre-bundle viem to resolve circular deps
      "wagmi" // Pre-bundle wagmi (depends on viem)
      // NOTE: ox is handled by oxResolverPlugin to force ESM resolution
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
