// Type declaration for @privy-io/react-auth
// This helps TypeScript resolve types when package.json "exports" prevents direct resolution
// The types exist at dist/dts/index.d.ts but TypeScript can't resolve them due to exports configuration
declare module '@privy-io/react-auth' {
  // Use a type-only import to reference the actual types
  type PrivyModule = typeof import('@privy-io/react-auth/dist/dts/index');
  export * from '@privy-io/react-auth/dist/dts/index';
}

