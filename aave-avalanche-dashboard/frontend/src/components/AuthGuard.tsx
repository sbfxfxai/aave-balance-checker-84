import { ReactNode } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { usePrivy } from '@privy-io/react-auth';
import { Navigation } from './Navigation';
import { Loader2, Wallet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useUsdcApy } from '@/hooks/useUsdcApy';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isConnected } = useAccount();
  const { authenticated, ready, login } = usePrivy();
  const { connect, connectors } = useConnect();
  const { displayApy } = useUsdcApy();

  // Show loading state while Privy is initializing
  if (!ready) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  // Check if user is authenticated (has linked email/Privy session OR wallet connected via wagmi)
  const isAuthenticated = authenticated || isConnected;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-subtle">
        <Navigation />
        <main className="max-w-2xl mx-auto p-8">
          <div className="space-y-6">
            {/* Hero Section */}
            <div className="text-center space-y-4">
              <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
                Banking that works as hard as you do
              </h1>
              <p className="text-muted-foreground text-lg">
                Earn <span className="font-semibold text-emerald-500">{displayApy}% APY</span> on savings. Optional managed Bitcoin exposure. Built on Aave—$70B+ secured.
              </p>
            </div>

            {/* Login Options */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Privy Email Login */}
              <Card className="p-6">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-3 rounded-full bg-gradient-primary">
                    <Wallet className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Email Wallet</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      Sign up with email to get a secure smart wallet
                    </p>
                    <Button
                      onClick={() => login()}
                      className="w-full"
                      size="lg"
                    >
                      Sign Up with Email
                    </Button>
                  </div>
                </div>
              </Card>

              {/* WalletConnect */}
              <Card className="p-6">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-3 rounded-full bg-gradient-primary">
                    <Wallet className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold mb-2">Wallet Connect</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                      Connect your existing MetaMask or other wallet
                    </p>
                    <Button
                      onClick={async () => {
                        try {
                          console.log('[AuthGuard] WalletConnect button clicked');
                          console.log('[AuthGuard] Available connectors:', connectors?.map(c => ({ id: c.id, name: c.name })) || 'none');
                          
                          if (!connectors || connectors.length === 0) {
                            console.error('[AuthGuard] No wallet connectors available');
                            toast.error('No wallet connectors available');
                            return;
                          }
                          
                          const walletConnectConnector = connectors.find(c => c.id === 'walletConnect');
                          console.log('[AuthGuard] WalletConnect connector found:', !!walletConnectConnector);
                          
                          if (walletConnectConnector) {
                            console.log('[AuthGuard] Attempting to connect with WalletConnect...');
                            connect({ 
                              connector: walletConnectConnector,
                              onError: (error) => {
                                console.error('[AuthGuard] WalletConnect connection error:', error);
                                toast.error(`Connection failed: ${error.message || 'Unknown error'}`);
                              },
                              onSuccess: () => {
                                console.log('[AuthGuard] WalletConnect connection successful');
                              }
                            });
                            
                            // Check if modal container exists after a short delay
                            setTimeout(() => {
                              // Check multiple possible selectors for WalletConnect modal
                              const selectors = [
                                'w3m-modal',
                                '[data-w3m-modal]',
                                '#walletconnect-wrapper',
                                '.walletconnect-modal',
                                'w3m-connect-button',
                                '[data-w3m-connect-button]',
                                'w3m-modal-backdrop',
                                '[id*="walletconnect"]',
                                '[class*="walletconnect"]',
                                '[class*="w3m"]'
                              ];
                              
                              let modalContainer: Element | null = null;
                              for (const selector of selectors) {
                                modalContainer = document.querySelector(selector);
                                if (modalContainer) {
                                  console.log(`[AuthGuard] Found modal container with selector: ${selector}`);
                                  break;
                                }
                              }
                              
                              // Also check body for any dynamically added elements
                              const bodyChildren = Array.from(document.body.children);
                              const walletConnectElements = bodyChildren.filter(el => 
                                el.tagName?.toLowerCase().includes('w3m') ||
                                el.id?.includes('walletconnect') ||
                                el.className?.toString().includes('walletconnect') ||
                                el.className?.toString().includes('w3m')
                              );
                              
                              console.log('[AuthGuard] Modal container check:', {
                                found: !!modalContainer,
                                element: modalContainer,
                                tagName: modalContainer?.tagName,
                                id: modalContainer?.id,
                                className: modalContainer?.className,
                                styles: modalContainer ? {
                                  display: window.getComputedStyle(modalContainer as Element).display,
                                  visibility: window.getComputedStyle(modalContainer as Element).visibility,
                                  opacity: window.getComputedStyle(modalContainer as Element).opacity,
                                  zIndex: window.getComputedStyle(modalContainer as Element).zIndex,
                                  position: window.getComputedStyle(modalContainer as Element).position
                                } : null,
                                walletConnectElementsInBody: walletConnectElements.length,
                                allBodyChildren: bodyChildren.map(el => ({ tag: el.tagName, id: el.id, className: el.className }))
                              });
                              
                              if (!modalContainer && walletConnectElements.length === 0) {
                                console.warn('[AuthGuard] ⚠️ WalletConnect modal container not found in DOM');
                                console.warn('[AuthGuard] This suggests the modal failed to inject. Check CSP and network errors.');
                                toast.error('WalletConnect modal failed to open. Check console for details.');
                              } else if (modalContainer) {
                                const styles = window.getComputedStyle(modalContainer as Element);
                                if (styles.display === 'none' || styles.visibility === 'hidden' || parseFloat(styles.opacity) === 0) {
                                  console.warn('[AuthGuard] ⚠️ Modal container found but is hidden:', {
                                    display: styles.display,
                                    visibility: styles.visibility,
                                    opacity: styles.opacity
                                  });
                                  toast.error('WalletConnect modal is hidden. This may be a CSS issue.');
                                } else {
                                  console.log('[AuthGuard] ✅ Modal container found and visible');
                                }
                              }
                            }, 1000); // Increased delay to 1 second
                          } else {
                            console.error('[AuthGuard] WalletConnect connector not found');
                            toast.error('WalletConnect not available');
                          }
                        } catch (error) {
                          console.error('[AuthGuard] Error connecting WalletConnect:', error);
                          toast.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                      }}
                      className="w-full"
                      size="lg"
                      variant="outline"
                    >
                      <Wallet className="mr-2 h-4 w-4" />
                      Connect Wallet
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </main>
        
        {/* Footer */}
        <footer className="border-t border-border/50 mt-16">
          <div className="container mx-auto px-4 py-6">
            <p className="text-center text-sm text-muted-foreground">
              TiltVault bridges traditional banking convenience with DeFi opportunities
            </p>
            <p className="text-center text-xs text-muted-foreground mt-2">
              High-yield savings via Aave • 2.5x leveraged Bitcoin positions • Simple, secure, designed for US users
            </p>
            <p className="text-center text-xs text-muted-foreground mt-2">
              Powered by Aave V3 • GMX • Avalanche C-Chain
            </p>
            <p className="text-center text-xs sm:text-sm text-muted-foreground mt-3">
              Support: <a href="mailto:support@tiltvault.com" className="text-emerald-500 hover:underline">support@tiltvault.com</a>
            </p>
          </div>
        </footer>
      </div>
    );
  }

  return <>{children}</>;
}
