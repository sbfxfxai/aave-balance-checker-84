import React, { useEffect, useRef, useState } from 'react';
import { getSquareConfig } from '@/lib/square';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import styles from './SquarePaymentForm.module.css';

// Square SDK types (loaded from script tag)
interface SquareCardInstance {
  attach: (selector: string) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: Array<{ message: string }> }>;
  destroy?: () => void;
}

interface SquarePaymentsInstance {
  card: () => Promise<SquareCardInstance>;
}

declare global {
  interface Window {
    Square?: {
      payments: (applicationId: string, locationId: string) => SquarePaymentsInstance;
    };
  }
}

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [card, setCard] = useState<SquareCardInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  useEffect(() => {
    let isMounted = true;
    let cardInstance: SquareCardInstance | null = null;
    let retryCount = 0;
    const maxRetries = 5;

    // Dynamically load Square.js script (non-blocking)
    const loadSquareSDK = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        // Check if already loaded
        if (window.Square && typeof window.Square.payments === 'function') {
          resolve();
          return;
        }

        // Check if script is already being loaded
        const existingScript = document.querySelector('script[src*="square.js"]');
        if (existingScript) {
          existingScript.addEventListener('load', () => resolve());
          existingScript.addEventListener('error', () => reject(new Error('Failed to load Square SDK')));
          return;
        }

        // Load script dynamically
        const script = document.createElement('script');
        script.src = 'https://web.squarecdn.com/v1/square.js';
        script.crossOrigin = 'anonymous';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          if (window.Square && typeof window.Square.payments === 'function') {
            resolve();
          } else {
            reject(new Error('Square SDK loaded but not available'));
          }
        };
        script.onerror = () => reject(new Error('Failed to load Square SDK'));
        document.head.appendChild(script);
      });
    };

    const initializeSquare = async () => {
      try {
        console.log('[SquarePaymentForm] Starting initialization...');

        if (!isMounted) return;

        // Load Square SDK dynamically (non-blocking)
        await loadSquareSDK();
        console.log('[SquarePaymentForm] Square SDK loaded');

        const config = getSquareConfig();
        console.log('[SquarePaymentForm] Config:', {
          applicationId: config.applicationId?.substring(0, 10) + '...',
          locationId: config.locationId,
          environment: config.environment,
        });
        
        if (!config.applicationId || !config.locationId) {
          throw new Error('Square configuration missing');
        }

        if (!cardContainerRef.current) {
          console.warn('[SquarePaymentForm] Card container not ready');
          return;
        }

        console.log('[SquarePaymentForm] Initializing Square Payments Web SDK...');
        
        // Check if Square SDK is loaded
        if (!window.Square || typeof window.Square.payments !== 'function') {
          throw new Error('Square SDK not available after loading');
        }
        
        // Initialize Square Payments SDK using script tag version
        // This is more reliable than the npm package for production
        let paymentsInstance;
        try {
          paymentsInstance = window.Square.payments(config.applicationId, config.locationId);
          console.log('[SquarePaymentForm] Payments instance created:', {
            type: typeof paymentsInstance,
            hasCard: typeof paymentsInstance?.card === 'function',
          });
        } catch (err: unknown) {
          console.error('[SquarePaymentForm] Error creating payments instance:', err);
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          throw new Error(`Failed to create Square Payments instance: ${errorMessage}`);
        }

        if (!paymentsInstance) {
          throw new Error('Payments instance is null or undefined');
        }

        if (typeof paymentsInstance.card !== 'function') {
          console.error('[SquarePaymentForm] Payments instance methods:', Object.keys(paymentsInstance));
          throw new Error('Card method not available on payments instance. Check Square SDK initialization.');
        }

        // Create card instance
        try {
          cardInstance = await paymentsInstance.card();
          console.log('[SquarePaymentForm] Card instance created:', {
            type: typeof cardInstance,
            hasAttach: typeof cardInstance?.attach === 'function',
            hasTokenize: typeof cardInstance?.tokenize === 'function',
          });
        } catch (err: unknown) {
          console.error('[SquarePaymentForm] Error creating card instance:', err);
          const errorMessage = err instanceof Error ? err.message : 'Unknown error';
          throw new Error(`Failed to create card instance: ${errorMessage}`);
        }

        if (!cardInstance) {
          throw new Error('Failed to create Square card instance');
        }

        await cardInstance.attach('#sq-card');

        if (!isMounted) {
          if (typeof cardInstance.destroy === 'function') {
            cardInstance.destroy();
          }
          return;
        }

        console.log('[SquarePaymentForm] Card instance created and attached');
        setCard(cardInstance);
        setIsLoading(false);
        setError(null);
      } catch (error: unknown) {
        console.error('[SquarePaymentForm] Initialization error:', error);
        if (isMounted) {
          const errorMsg = `Failed to initialize Square: ${error instanceof Error ? error.message : 'Unknown error'}`;
          setError(errorMsg);
          onPaymentError(new Error(errorMsg));
          setIsLoading(false);
        }
      }
    };

    const checkAndInitialize = () => {
      if (!isMounted || amount <= 0) return;
      
      const containerReady = cardContainerRef.current;
      const elementReady = document.getElementById('sq-card');
      
      console.log('[SquarePaymentForm] Container check:', {
        containerReady: !!containerReady,
        elementReady: !!elementReady,
        retryCount,
        amount,
      });

      if (containerReady && elementReady) {
        console.log('[SquarePaymentForm] Container ready, initializing...');
        initializeSquare();
      } else if (retryCount < maxRetries) {
        retryCount++;
        console.log(`[SquarePaymentForm] Container not ready, retry ${retryCount}/${maxRetries}...`);
        setTimeout(checkAndInitialize, 100 * retryCount); // Exponential backoff
      } else {
        console.error('[SquarePaymentForm] Container still not ready after all retries');
        setError('Payment form container not available. Please refresh the page and try again.');
        onPaymentError(new Error('Payment form container not available. Please refresh the page and try again.'));
        setIsLoading(false);
      }
    };

    // Monitor iframe stability
    const stabilityCheck = setInterval(() => {
      if (!isMounted || !cardInstance) {
        clearInterval(stabilityCheck);
        return;
      }
      
      const iframe = document.querySelector('#sq-card iframe');
      if (!iframe) {
        console.warn('[SquarePaymentForm] Square iframe not found, may need re-initialization');
      }
    }, 1000);

    // Start initialization with a small delay to ensure DOM is rendered
    const initTimer = setTimeout(checkAndInitialize, 100);

    return () => {
      clearTimeout(initTimer);
      clearInterval(stabilityCheck);
      isMounted = false;
      if (cardInstance && typeof cardInstance.destroy === 'function') {
        try {
          cardInstance.destroy();
        } catch (e) {
          console.warn('[SquarePaymentForm] Error destroying card instance:', e);
        }
      }
    };

  }, [amount, onPaymentSuccess, onPaymentError]);

  const processTokenization = async () => {
    if (!card || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Add delay to ensure iframe is stable
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Check if card is still attached and valid
      if (!document.getElementById('sq-card')) {
        throw new Error('Payment form container not found');
      }

      console.log('[SquarePaymentForm] Starting tokenization...');
      const result = await card.tokenize();
      console.log('[SquarePaymentForm] Tokenize result:', result);

      if (result.status === 'OK' && result.token) {
        setRetryCount(0); // Reset retry count on success
        onPaymentSuccess(result.token);
      } else {
        const message =
          result.errors?.map((err) => err.message || 'Unknown error').join(', ') ||
          'Failed to tokenize card details';
        throw new Error(message);
      }
    } catch (error: unknown) {
      console.error('[SquarePaymentForm] Tokenization error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Payment submission failed';
      
      // Handle NS_BINDING_ABORTED specifically with retry
      if (errorMessage.includes('NS_BINDING_ABORTED') || errorMessage.includes('Binding aborted')) {
        if (retryCount < maxRetries) {
          console.log(`[SquarePaymentForm] Retrying tokenization (${retryCount + 1}/${maxRetries})`);
          setRetryCount(prev => prev + 1);
          setTimeout(() => {
            setIsSubmitting(false);
            processTokenization(); // Retry the tokenization
          }, 1000 * (retryCount + 1)); // Exponential backoff
          return;
        } else {
          setError('Payment was interrupted multiple times. Please refresh the page and try again.');
          onPaymentError(new Error('Payment form was interrupted. Please try again.'));
        }
      } else {
        setError(`Payment failed: ${errorMessage}`);
        onPaymentError(new Error(`Payment submission failed: ${errorMessage}`));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await processTokenization();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {isLoading && (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading payment form...</span>
        </div>
      )}
      
      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20">
          <p className="text-sm text-destructive font-medium mb-2">Payment form error</p>
          <p className="text-xs text-destructive/80">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            onClick={() => {
              setError(null);
              setIsLoading(true);
              // Force re-render to trigger useEffect
              window.location.reload();
            }}
          >
            Refresh Page
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Card Information</label>
        {/* Always render container so ref is available */}
        <div ref={cardContainerRef} id="square-card-container" className={styles.container}>
          <div id="sq-card" className={styles.sqInput} />
        </div>
        <div className="text-xs text-muted-foreground">
          Amount: ${amount.toFixed(2)}
        </div>
      </div>
      
      <Button type="submit" className="w-full" disabled={!card || isSubmitting}>
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
