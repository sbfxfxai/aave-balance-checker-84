/**
 * Production Error Tracking System
 * Centralized error logging and monitoring for production issues
 */

interface ErrorContext {
  userId?: string;
  walletAddress?: string;
  requestId?: string;
  endpoint?: string;
  method?: string;
  userAgent?: string;
  timestamp: string;
  environment: string;
  version: string;
}

interface ErrorReport {
  error: Error | string;
  context: ErrorContext;
  stack?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'payment' | 'gmx' | 'auth' | 'api' | 'infrastructure' | 'user_error';
}

class ErrorTracker {
  private static instance: ErrorTracker;
  private isEnabled: boolean;
  private errorQueue: ErrorReport[] = [];
  private maxQueueSize = 100;
  
  private constructor() {
    this.isEnabled = process.env.NODE_ENV === 'production';
  }

  static getInstance(): ErrorTracker {
    if (!ErrorTracker.instance) {
      ErrorTracker.instance = new ErrorTracker();
    }
    return ErrorTracker.instance;
  }

  private getContext(request?: any): ErrorContext {
    return {
      userId: request?.userId || request?.user?.id,
      walletAddress: request?.walletAddress || request?.connectedAddress,
      requestId: request?.requestId || this.generateRequestId(),
      endpoint: request?.url || request?.path,
      method: request?.method,
      userAgent: request?.headers?.['user-agent'],
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0'
    };
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private categorizeError(error: Error, endpoint?: string): ErrorReport['category'] {
    const message = error.message.toLowerCase();
    
    if (message.includes('payment') || message.includes('square') || message.includes('transaction')) {
      return 'payment';
    }
    if (message.includes('gmx') || message.includes('trade') || message.includes('position')) {
      return 'gmx';
    }
    if (message.includes('auth') || message.includes('privy') || message.includes('wallet')) {
      return 'auth';
    }
    if (message.includes('timeout') || message.includes('network') || message.includes('fetch')) {
      return 'infrastructure';
    }
    if (message.includes('validation') || message.includes('invalid')) {
      return 'user_error';
    }
    
    return 'api';
  }

  private getSeverity(error: Error, category: ErrorReport['category']): ErrorReport['severity'] {
    // Critical errors that need immediate attention
    if (category === 'payment' || category === 'gmx') {
      return 'critical';
    }
    
    // High severity errors
    if (category === 'auth' || category === 'infrastructure') {
      return 'high';
    }
    
    // Medium severity errors
    if (category === 'api') {
      return 'medium';
    }
    
    // Low severity errors
    return 'low';
  }

  private async sendToMonitoring(errorReport: ErrorReport): Promise<void> {
    if (!this.isEnabled) return;

    try {
      // Send to monitoring service (you can integrate with Sentry, LogRocket, etc.)
      console.error('[ERROR TRACKER]', JSON.stringify(errorReport, null, 2));
      
      // Example: Send to external monitoring service
      // await fetch('https://your-monitoring-service.com/api/errors', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(errorReport)
      // });
      
    } catch (monitoringError) {
      console.error('[ERROR TRACKER] Failed to send error to monitoring:', monitoringError);
    }
  }

  private addToQueue(errorReport: ErrorReport): void {
    this.errorQueue.push(errorReport);
    
    // Keep queue size manageable
    if (this.errorQueue.length > this.maxQueueSize) {
      this.errorQueue.shift();
    }
  }

  public trackError(error: Error | string, request?: any, additionalContext?: Partial<ErrorContext>): void {
    if (!this.isEnabled) {
      // In development, just log to console
      console.error('[DEV ERROR]', error, additionalContext);
      return;
    }

    const errorObj = typeof error === 'string' ? new Error(error) : error;
    const context = { ...this.getContext(request), ...additionalContext };
    const category = this.categorizeError(errorObj, context.endpoint);
    const severity = this.getSeverity(errorObj, category);

    const errorReport: ErrorReport = {
      error: errorObj,
      context,
      stack: errorObj.stack,
      severity,
      category
    };

    this.addToQueue(errorReport);
    this.sendToMonitoring(errorReport);
  }

  public trackPaymentError(error: Error | string, paymentData?: any, request?: any): void {
    this.trackError(error, request, {
      category: 'payment',
      severity: 'critical',
      ...paymentData
    });
  }

  public trackGMXError(error: Error | string, tradeData?: any, request?: any): void {
    this.trackError(error, request, {
      category: 'gmx',
      severity: 'critical',
      ...tradeData
    });
  }

  public trackAuthError(error: Error | string, authData?: any, request?: any): void {
    this.trackError(error, request, {
      category: 'auth',
      severity: 'high',
      ...authData
    });
  }

  public getErrorStats(): {
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    recentErrors: ErrorReport[];
  } {
    const errorsByCategory: Record<string, number> = {};
    const errorsBySeverity: Record<string, number> = {};

    this.errorQueue.forEach(error => {
      errorsByCategory[error.category] = (errorsByCategory[error.category] || 0) + 1;
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
    });

    return {
      totalErrors: this.errorQueue.length,
      errorsByCategory,
      errorsBySeverity,
      recentErrors: this.errorQueue.slice(-10) // Last 10 errors
    };
  }

  public clearQueue(): void {
    this.errorQueue = [];
  }
}

export const errorTracker = ErrorTracker.getInstance();
