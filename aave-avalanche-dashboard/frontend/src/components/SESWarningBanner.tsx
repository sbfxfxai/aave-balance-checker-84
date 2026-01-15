import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/**
 * SES Warning Banner Component
 * 
 * Displays a user-friendly warning when SES lockdown is detected from wallet extensions.
 * Provides guidance on potential compatibility issues and solutions.
 */
export function SESWarningBanner() {
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    // Check for SES detection flag
    const checkSES = () => {
      if (typeof window === 'undefined') return;

      const windowWithSES = window as Window & {
        __SES_DETECTED__?: boolean;
        lockdown?: unknown;
        harden?: unknown;
        __SES__?: unknown;
      };

      const sesDetected = 
        windowWithSES.__SES_DETECTED__ ||
        typeof windowWithSES.lockdown !== 'undefined' ||
        typeof windowWithSES.harden !== 'undefined' ||
        windowWithSES.__SES__;

      if (sesDetected && !isDismissed) {
        setIsVisible(true);

        // Track SES detection (anonymized)
        trackSESDetection().catch(() => {
          // Silently fail - tracking is non-critical
        });

        // Show toast notification
        toast({
          title: 'Wallet Extension Detected',
          description: 'A wallet extension with security hardening is active. Some features may have compatibility issues.',
          variant: 'default',
          duration: 5000,
        });
      }
    };

    // Check immediately and on mount
    checkSES();

    // Also check periodically in case SES is injected later
    const interval = setInterval(checkSES, 2000);
    return () => clearInterval(interval);
  }, [isDismissed, toast]);

  const handleDismiss = () => {
    setIsVisible(false);
    setIsDismissed(true);
    // Store dismissal in sessionStorage to persist across page navigations
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('ses_warning_dismissed', 'true');
    }
  };

  // Check sessionStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const dismissed = sessionStorage.getItem('ses_warning_dismissed');
      if (dismissed === 'true') {
        setIsDismissed(true);
      }
    }
  }, []);

  if (!isVisible || isDismissed) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500/10 border-b border-yellow-500/20 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
              Wallet Extension Security Detected
            </p>
            <p className="text-xs text-yellow-600/80 dark:text-yellow-400/80 mt-1">
              A wallet extension with security hardening (SES) is active. This may cause compatibility issues with some features.
              If you experience problems, try{' '}
              <button
                onClick={() => window.open('https://support.tiltvault.com/wallet-extensions', '_blank')}
                className="underline hover:text-yellow-700 dark:hover:text-yellow-300"
              >
                disabling conflicting extensions
              </button>
              {' '}or using an incognito window.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-yellow-600 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300 transition-colors"
            aria-label="Dismiss warning"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Track SES detection (anonymized)
 * Sends a non-identifying event to track SES detection prevalence
 */
async function trackSESDetection(): Promise<void> {
  try {
    // Only track once per session
    if (typeof window === 'undefined') return;
    const tracked = sessionStorage.getItem('ses_detection_tracked');
    if (tracked === 'true') return;

    // Send anonymized event
    await fetch('/api/security/ses-detection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: Date.now(),
        // No PII - just detection event
      }),
    });

    sessionStorage.setItem('ses_detection_tracked', 'true');
  } catch {
    // Silently fail - tracking is non-critical
  }
}
