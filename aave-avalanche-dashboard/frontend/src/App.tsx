import React, { Suspense, lazy } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthGuard } from "@/components/AuthGuard";
import { PrivyAuthProvider } from "@/components/PrivyAuthProvider";

// Lazy load routes for code splitting
const DashboardWithWeb3 = lazy(() => import("./pages/DashboardWithWeb3"));
const StackApp = lazy(() => import("./pages/StackApp"));
const GmxIntegration = lazy(() => import("./pages/GmxIntegration"));
const NotFound = lazy(() => import("./pages/NotFound"));

const Web3Providers = lazy(() =>
  import("./components/Web3Providers").then((m) => ({ default: m.Web3Providers }))
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
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={
                <Web3Providers>
                  <AuthGuard>
                    <DashboardWithWeb3 />
                  </AuthGuard>
                </Web3Providers>
              } />
              <Route
                path="/stack"
                element={
                  <Web3Providers>
                    <AuthGuard>
                      <StackApp />
                    </AuthGuard>
                  </Web3Providers>
                }
              />
              <Route
                path="/gmx"
                element={
                  <Web3Providers>
                    <AuthGuard>
                      <GmxIntegration />
                    </AuthGuard>
                  </Web3Providers>
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
