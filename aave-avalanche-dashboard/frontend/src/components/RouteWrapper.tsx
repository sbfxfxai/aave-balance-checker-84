import { Suspense, lazy, ReactNode } from 'react';
import { ErgcPurchaseModalProvider } from '@/contexts/ErgcPurchaseModalContext';

// Lazy load Web3Providers and AuthGuard together (they're always used together)
const Web3Providers = lazy(() =>
  import("./Web3Providers").then((m) => ({ default: m.Web3Providers }))
);

const AuthGuard = lazy(() =>
  import("./AuthGuard").then((m) => ({ default: m.AuthGuard }))
);

// Minimal fallback while providers load
const ProviderFallback = () => (
  <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
    <div className="animate-pulse bg-muted h-10 w-32 rounded-md" />
  </div>
);

interface RouteWrapperProps {
  children: ReactNode;
}

/**
 * RouteWrapper - Lazy loads Web3Providers and AuthGuard per route
 * 
 * This ensures Web3 dependencies are only loaded when a route is accessed,
 * not on initial page load. This significantly reduces initial bundle size.
 */
export function RouteWrapper({ children }: RouteWrapperProps) {
  return (
    <Suspense fallback={<ProviderFallback />}>
      <Web3Providers>
        <ErgcPurchaseModalProvider>
          <Suspense fallback={<ProviderFallback />}>
            <AuthGuard>
              {children}
            </AuthGuard>
          </Suspense>
        </ErgcPurchaseModalProvider>
      </Web3Providers>
    </Suspense>
  );
}

