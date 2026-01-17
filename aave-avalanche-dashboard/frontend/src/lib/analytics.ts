/**
 * Analytics system for tracking wallet connections and user behavior
 * Provides visibility into conversion funnel and performance metrics
 */

interface ConnectionEvent {
  event: 'wallet_connected' | 'wallet_connection_failed' | 'wallet_disconnected';
  connector: string;
  connectorType: 'injected' | 'walletConnect' | 'privy';
  timestamp: number;
  error?: string;
  userAgent?: string;
  walletAddress?: string;
}

interface NetworkEvent {
  event: 'network_switched' | 'network_switch_failed';
  fromChain?: number;
  toChain: number;
  timestamp: number;
  error?: string;
}

interface PerformanceEvent {
  event: 'rpc_request' | 'rpc_request_failed' | 'rpc_timeout';
  chainId: number;
  method: string;
  duration: number;
  timestamp: number;
  error?: string;
}

class Analytics {
  private isDev = import.meta.env.DEV;
  private events: (ConnectionEvent | NetworkEvent | PerformanceEvent)[] = [];
  private batchSize = 10;
  private flushInterval = 5000; // 5 seconds

  constructor() {
    // Flush events periodically
    if (!this.isDev) {
      setInterval(() => this.flush(), this.flushInterval);
    }
  }

  /**
   * Track wallet connection events
   */
  trackConnection(event: ConnectionEvent) {
    const enrichedEvent = {
      ...event,
      userAgent: navigator.userAgent,
      url: window.location.href,
      sessionId: this.getSessionId(),
    };

    this.events.push(enrichedEvent);
    
    // Log to console in development
    if (this.isDev) {
      console.log('[Analytics] Connection Event:', enrichedEvent);
    }

    // Flush immediately for connection events (they're critical)
    if (event.event.includes('failed')) {
      this.flush();
    }
  }

  /**
   * Track network switching events
   */
  trackNetwork(event: NetworkEvent) {
    const enrichedEvent = {
      ...event,
      userAgent: navigator.userAgent,
      url: window.location.href,
      sessionId: this.getSessionId(),
    };

    this.events.push(enrichedEvent);
    
    if (this.isDev) {
      console.log('[Analytics] Network Event:', enrichedEvent);
    }
  }

  /**
   * Track RPC performance
   */
  trackRPC(event: PerformanceEvent) {
    const enrichedEvent = {
      ...event,
      userAgent: navigator.userAgent,
      url: window.location.href,
      sessionId: this.getSessionId(),
    };

    this.events.push(enrichedEvent);
    
    if (this.isDev) {
      console.log('[Analytics] RPC Event:', enrichedEvent);
    }
  }

  /**
   * Get or create session ID
   */
  private getSessionId(): string {
    let sessionId = sessionStorage.getItem('analytics_session_id');
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      sessionStorage.setItem('analytics_session_id', sessionId);
    }
    return sessionId;
  }

  /**
   * Send events to analytics endpoint
   */
  private async flush() {
    if (this.events.length === 0) return;

    const eventsToSend = this.events.splice(0, this.batchSize);
    
    try {
      // Send to your analytics endpoint
      await fetch('/api/analytics/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events: eventsToSend }),
      });
      
      if (this.isDev) {
        console.log('[Analytics] Flushed events:', eventsToSend.length);
      }
    } catch (error) {
      console.error('[Analytics] Failed to flush events:', error);
      // Re-add events to try again later
      this.events.unshift(...eventsToSend);
    }
  }

  /**
   * Get connection statistics (for debugging)
   */
  getConnectionStats() {
    const connectionEvents = this.events.filter(e => 
      e.event.includes('wallet_connected') || e.event.includes('wallet_connection_failed')
    );
    
    const successful = connectionEvents.filter(e => e.event === 'wallet_connected').length;
    const failed = connectionEvents.filter(e => e.event === 'wallet_connection_failed').length;
    
    return {
      total: connectionEvents.length,
      successful,
      failed,
      successRate: successful > 0 ? (successful / (successful + failed)) * 100 : 0,
      connectors: this.getConnectorStats(),
    };
  }

  /**
   * Get connector usage statistics
   */
  private getConnectorStats() {
    const stats: Record<string, { successful: number; failed: number }> = {};
    
    this.events
      .filter((e): e is ConnectionEvent => e.event.includes('wallet_'))
      .forEach(event => {
        const connector = event.connector;
        if (!stats[connector]) {
          stats[connector] = { successful: 0, failed: 0 };
        }
        
        if (event.event === 'wallet_connected') {
          stats[connector].successful++;
        } else if (event.event === 'wallet_connection_failed') {
          stats[connector].failed++;
        }
      });
    
    return stats;
  }

  /**
   * Track RPC performance statistics
   */
  getRPCStats() {
    const rpcEvents = this.events.filter((e): e is PerformanceEvent => e.event.includes('rpc_'));
    
    const stats = {
      total: rpcEvents.length,
      failed: rpcEvents.filter(e => e.event.includes('failed')).length,
      timeouts: rpcEvents.filter(e => e.event.includes('timeout')).length,
      averageDuration: 0,
      batchEfficiency: this.calculateBatchEfficiency(rpcEvents),
      chains: {} as Record<number, { total: number; failed: number; avgDuration: number; batchEfficiency: number }>,
    };

    if (rpcEvents.length > 0) {
      const totalDuration = rpcEvents.reduce((sum, e) => sum + (e.duration || 0), 0);
      stats.averageDuration = totalDuration / rpcEvents.length;
    }

    // Per-chain stats
    rpcEvents.forEach(event => {
      const chainId = event.chainId;
      if (!stats.chains[chainId]) {
        stats.chains[chainId] = { total: 0, failed: 0, avgDuration: 0, batchEfficiency: 0 };
      }
      
      stats.chains[chainId].total++;
      if (event.event.includes('failed') || event.event.includes('timeout')) {
        stats.chains[chainId].failed++;
      }
    });

    return stats;
  }

  /**
   * Calculate batch efficiency (how many requests were batched vs individual)
   */
  private calculateBatchEfficiency(rpcEvents: PerformanceEvent[]): number {
    // This would be enhanced with actual batch tracking
    // For now, estimate based on request patterns
    const batchableMethods = ['eth_getBalance', 'eth_getBlock', 'eth_call'];
    const batchableRequests = rpcEvents.filter(e => 
      batchableMethods.some(method => e.method.includes(method))
    ).length;
    
    return rpcEvents.length > 0 ? (batchableRequests / rpcEvents.length) * 100 : 0;
  }
}

// Export singleton instance
export const analytics = new Analytics();

// Make analytics available globally for debugging
if (typeof window !== 'undefined') {
  (window as unknown as { tiltvaultAnalytics: Analytics }).tiltvaultAnalytics = analytics;
}

// Export types for use in components
export type { ConnectionEvent, NetworkEvent, PerformanceEvent };
