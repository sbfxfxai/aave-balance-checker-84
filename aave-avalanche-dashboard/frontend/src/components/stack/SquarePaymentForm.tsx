import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SquarePaymentService } from '@/lib/squarePaymentService';
import { ensureSquareConfigAvailable, getSquareConfig } from '@/lib/square';

interface SquarePaymentFormProps {
  amount: number; // Amount in dollars
  onPaymentSuccess: (nonce: string) => void;
  onPaymentError: (error: Error) => void;
}

export const SquarePaymentForm: React.FC<SquarePaymentFormProps> = ({
  amount,
  onPaymentSuccess,
  onPaymentError,
}) => {
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const squareServiceRef = useRef<SquarePaymentService | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initializeSquare = async () => {
      try {
        console.log('[SquarePaymentForm] Starting initialization...');

        if (!isMounted) return;

        const { squarePaymentService } = await import('@/lib/squarePaymentService');
        const config =
          (await ensureSquareConfigAvailable()) ??
          getSquareConfig();

        squareServiceRef.current = squarePaymentService;

        // Initialize Square service
        await squarePaymentService.initialize({
          applicationId: config.applicationId,
          locationId: config.locationId,
          environment: config.environment,
        });
        console.log('[SquarePaymentForm] Square service initialized');

        if (!isMounted) return;

        // Wait for container to be ready
        if (!cardContainerRef.current) {
          console.warn('[SquarePaymentForm] Card container not ready');
          return;
        }

        // Initialize card form
        await squarePaymentService.initializeCard('sq-card');
        console.log('[SquarePaymentForm] Card form initialized');

        if (isMounted) {
          setIsLoading(false);
        }
      } catch (error) {
        console.error('[SquarePaymentForm] Initialization error:', error);
        if (isMounted) {
          setIsLoading(false);
          const errorMessage = error instanceof Error ? error.message : 'Failed to initialize payment form';
          setError(errorMessage);
          onPaymentError(new Error(errorMessage));
        }
      }
    };

    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      initializeSquare();
    }, 100);

    return () => {
      clearTimeout(timer);
      isMounted = false;
      squareServiceRef.current?.destroy();
      squareServiceRef.current = null;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      console.log('[SquarePaymentForm] Starting tokenization...');
      const service = squareServiceRef.current ?? (await import('@/lib/squarePaymentService')).squarePaymentService;
      squareServiceRef.current = service;

      const token = await service.tokenizeCard();
      console.log('[SquarePaymentForm] Token received:', token.substring(0, 20) + '...');
      
      onPaymentSuccess(token);
    } catch (error) {
      console.error('[SquarePaymentForm] Tokenization error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Payment submission failed';
      setError(errorMessage);
      onPaymentError(new Error(errorMessage));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Square Card Container */}
      <div className="space-y-2">
        <label className="text-sm font-medium sr-only">Card Information</label>
        <div
          id="sq-card"
          ref={cardContainerRef}
          className="min-h-[200px] border rounded-lg p-4 bg-background"
        >
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading payment form...
              </span>
            </div>
          )}
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        className="w-full"
        disabled={isLoading || isSubmitting}
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          `Pay $${amount.toFixed(2)}`
        )}
      </Button>
    </form>
  );
};
