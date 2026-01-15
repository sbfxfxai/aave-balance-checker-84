import React, { Suspense, lazy } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PrivyAuthProvider } from "@/components/PrivyAuthProvider";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { SESWarningBanner } from "@/components/SESWarningBanner";

// Lazy load routes for code splitting
const DashboardWithWeb3 = lazy(() => import("./pages/DashboardWithWeb3"));
const StackApp = lazy(() => import("./pages/StackApp"));
// CRITICAL: Lazy load GMX Integration with error handling for TDZ errors
// SES lockdown from wallet extensions can cause Temporal Dead Zone errors
const GmxIntegration = lazy(() => 
  import("./pages/GmxIntegration").catch((err: Error) => {
    console.error('[App] Failed to load GMX Integration:', err);
    // Return a fallback component if GMX SDK fails to load
    const FallbackComponent = () => (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">GMX Integration Unavailable</h2>
          <p className="text-muted-foreground mb-4">
            There was an error loading the GMX integration. This may be caused by a browser extension
            (like MetaMask) enforcing strict JavaScript semantics.
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            Try disabling browser extensions or using an incognito window.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
          >
            Reload Page
          </button>
        </div>
      </div>
    );
    return Promise.resolve({ default: FallbackComponent });
  })
);
const MonitoringDashboard = lazy(() => import("./pages/MonitoringDashboard"));
const ErgcPurchase = lazy(() => import("./pages/ErgcPurchase"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Lazy load RouteWrapper (includes Web3Providers + AuthGuard)
const RouteWrapper = lazy(() =>
  import("./components/RouteWrapper").then((m) => ({ default: m.RouteWrapper }))
);

// Optimized loading fallback - renders immediately to improve LCP
const PageLoader = () => (
  <div className="min-h-screen bg-gradient-subtle">
    {/* Header skeleton - matches actual header structure */}
    <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-primary w-10 h-10"></div>
            <div>
              <div className="h-7 w-32 bg-gradient-primary bg-clip-text text-transparent animate-pulse"></div>
              <div className="h-4 w-24 bg-muted mt-1 rounded animate-pulse"></div>
            </div>
          </div>
        </div>
      </div>
    </header>

    {/* Main content skeleton */}
    <main className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    </main>

    {/* Footer skeleton - matches actual footer */}
    <footer className="border-t border-border/50 mt-16">
      <div className="container mx-auto px-4 py-6">
        <p className="text-center text-sm text-muted-foreground">
          Powered by Aave V3 • Avalanche C-Chain • Trader Joe
        </p>
      </div>
    </footer>
  </div>
);

const App = () => (
  <ErrorBoundary>
    <PrivyAuthProvider>
      <TooltipProvider>
        <SESWarningBanner />
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <GoogleAnalytics />
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route 
                path="/" 
                element={
                  <RouteWrapper>
                    <DashboardWithWeb3 />
                  </RouteWrapper>
                } 
              />
              <Route
                path="/stack"
                element={
                  <RouteWrapper>
                    <StackApp />
                  </RouteWrapper>
                }
              />
              <Route
                path="/gmx"
                element={
                  <ErrorBoundary fallback={
                    <div className="min-h-screen bg-gradient-subtle flex items-center justify-center p-4">
                      <div className="text-center max-w-md">
                        <h2 className="text-2xl font-bold mb-4">GMX Integration Unavailable</h2>
                        <p className="text-muted-foreground mb-4">
                          The GMX integration failed to load. This may be due to a browser extension conflict
                          (such as MetaMask with SES lockdown enabled).
                        </p>
                        <p className="text-sm text-muted-foreground mb-4">
                          Try opening this page in incognito mode or disabling wallet extensions.
                        </p>
                        <button 
                          onClick={() => window.location.reload()} 
                          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                        >
                          Retry
                        </button>
                      </div>
                    </div>
                  }>
                    <RouteWrapper>
                      <GmxIntegration />
                    </RouteWrapper>
                  </ErrorBoundary>
                }
              />
              <Route
                path="/monitoring"
                element={
                  <RouteWrapper>
                    <MonitoringDashboard />
                  </RouteWrapper>
                }
              />
              <Route
                path="/ergc"
                element={
                  <RouteWrapper>
                    <ErgcPurchase />
                  </RouteWrapper>
                }
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </PrivyAuthProvider>
  </ErrorBoundary>
);

export default App;
