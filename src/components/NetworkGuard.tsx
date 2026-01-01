import { useNetworkGuard } from '@/hooks/useNetworkGuard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Network guard component that displays a warning banner
 * when user is connected to the wrong network
 * Uses centralized switch logic from useNetworkGuard hook
 */
export function NetworkGuard() {
  const { isCorrectChain, isSwitching, chainId, switchToAvalanche } = useNetworkGuard();

  // Don't show anything if on correct chain or not connected
  if (isCorrectChain || !chainId) {
    return null;
  }

  const handleSwitch = () => {
    try {
      switchToAvalanche();
    } catch (error) {
      // Error handling is done in the hook
    }
  };

  return (
    <Alert className="mb-4 border-orange-500 bg-orange-50 dark:bg-orange-950/20">
      <AlertTriangle className="h-4 w-4 text-orange-600" />
      <AlertDescription className="flex items-center justify-between">
        <span className="text-sm">
          Wrong network detected. Please switch to <strong>Avalanche C-Chain</strong> to use this app.
        </span>
        <Button
          onClick={handleSwitch}
          disabled={isSwitching}
          size="sm"
          variant="outline"
          className="ml-4 border-orange-600 text-orange-700 hover:bg-orange-100"
        >
          {isSwitching ? (
            <>
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
              Switching...
            </>
          ) : (
            'Switch Network'
          )}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

