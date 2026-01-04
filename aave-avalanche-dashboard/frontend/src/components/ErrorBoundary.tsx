import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    // Hide loading screen when error occurs
    if (typeof document !== 'undefined') {
      document.body.classList.add('tv-app-loaded');
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      // Ensure loading screen is hidden
      if (typeof document !== 'undefined') {
        document.body.classList.add('tv-app-loaded');
      }
      
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      return (
        <div className="min-h-screen bg-gradient-subtle flex items-center justify-center p-4">
          <Card className="p-8 max-w-md w-full">
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <AlertCircle className="h-12 w-12 text-destructive" />
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {this.state.error?.message || 'An unexpected error occurred'}
                </p>
                <Button onClick={this.handleReset} className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
              </div>
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="mt-4 text-left">
                  <summary className="text-xs text-muted-foreground cursor-pointer">
                    Error Details
                  </summary>
                  <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto">
                    {this.state.error.stack}
                  </pre>
                </details>
              )}
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

