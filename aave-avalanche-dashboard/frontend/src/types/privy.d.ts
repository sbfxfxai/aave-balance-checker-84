/**
 * Type declaration for @privy-io/react-auth
 * 
 * This module declaration helps TypeScript resolve types when package.json "exports" 
 * prevents direct type resolution. The types exist at dist/dts/index.d.ts but 
 * TypeScript can't resolve them due to the package's exports configuration.
 * 
 * This declaration re-exports all types and values from the actual type definitions.
 */
declare module '@privy-io/react-auth' {
  export * from '@privy-io/react-auth/dist/dts/index';
}

