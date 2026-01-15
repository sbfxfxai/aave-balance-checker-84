import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Declare gtag function for TypeScript
declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (command: 'config' | 'event' | 'js', targetId: string, config?: Record<string, unknown>) => void;
  }
}

/**
 * GoogleAnalytics component tracks page views for React Router navigation
 * This is necessary because React Router is a SPA and doesn't trigger full page loads
 */
export function GoogleAnalytics() {
  const location = useLocation();

  useEffect(() => {
    // Only track if gtag is available (loaded from index.html)
    if (typeof window !== 'undefined' && window.gtag) {
      // Track page view with current path
      window.gtag('config', 'G-HVZ8CTMR8M', {
        page_path: location.pathname + location.search,
        page_title: document.title,
      });
    }
  }, [location]);

  return null; // This component doesn't render anything
}

