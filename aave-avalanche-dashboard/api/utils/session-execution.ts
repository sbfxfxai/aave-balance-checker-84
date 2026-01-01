/**
 * Session execution utilities for managing and executing trading sessions
 */

export interface TradingSession {
  id: string;
  userId: string;
  walletAddress: string;
  strategy: 'conservative' | 'aggressive';
  status: 'active' | 'paused' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  initialBalance: number;
  currentBalance: number;
  positions: Position[];
  settings: SessionSettings;
  metadata: Record<string, any>;
}

export interface Position {
  id: string;
  asset: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice?: number;
  pnl?: number;
  status: 'open' | 'closed';
  openTime: Date;
  closeTime?: Date;
}

export interface SessionSettings {
  maxPositions: number;
  riskPerTrade: number; // percentage
  stopLoss: number; // percentage
  takeProfit: number; // percentage
  maxDrawdown: number; // percentage
  rebalanceFrequency: number; // hours
}

export interface ExecutionResult {
  success: boolean;
  sessionId: string;
  action: string;
  result?: any;
  error?: string;
  timestamp: Date;
}

class SessionExecutor {
  private activeSessions: Map<string, TradingSession> = new Map();
  private executionQueue: Array<{ sessionId: string; action: string; data: any }> = [];

  /**
   * Create new trading session
   */
  async createSession(
    userId: string,
    walletAddress: string,
    strategy: 'conservative' | 'aggressive',
    initialBalance: number,
    settings: SessionSettings
  ): Promise<TradingSession> {
    const session: TradingSession = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      walletAddress,
      strategy,
      status: 'active',
      startTime: new Date(),
      initialBalance,
      currentBalance: initialBalance,
      positions: [],
      settings,
      metadata: {}
    };

    this.activeSessions.set(session.id, session);
    console.log(`[SessionExecutor] Created session ${session.id} for user ${userId}`);

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): TradingSession | null {
    return this.activeSessions.get(sessionId) || null;
  }

  /**
   * Get all sessions for user
   */
  getUserSessions(userId: string): TradingSession[] {
    return Array.from(this.activeSessions.values())
      .filter(session => session.userId === userId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  /**
   * Execute trading action
   */
  async executeAction(
    sessionId: string,
    action: string,
    data: any
  ): Promise<ExecutionResult> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        sessionId,
        action,
        error: 'Session not found',
        timestamp: new Date()
      };
    }

    if (session.status !== 'active') {
      return {
        success: false,
        sessionId,
        action,
        error: `Session is ${session.status}`,
        timestamp: new Date()
      };
    }

    try {
      let result: any;

      switch (action) {
        case 'open_position':
          result = await this.openPosition(session, data);
          break;
        case 'close_position':
          result = await this.closePosition(session, data.positionId);
          break;
        case 'rebalance':
          result = await this.rebalanceSession(session);
          break;
        case 'pause':
          result = await this.pauseSession(session);
          break;
        case 'resume':
          result = await this.resumeSession(session);
          break;
        case 'close':
          result = await this.closeSession(session);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      return {
        success: true,
        sessionId,
        action,
        result,
        timestamp: new Date()
      };
    } catch (error) {
      console.error(`[SessionExecutor] Action ${action} failed:`, error);
      return {
        success: false,
        sessionId,
        action,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date()
      };
    }
  }

  /**
   * Open new position
   */
  private async openPosition(session: TradingSession, data: {
    asset: string;
    side: 'long' | 'short';
    size: number;
    entryPrice: number;
  }): Promise<Position> {
    // Validate position size and risk
    const positionValue = data.size * data.entryPrice;
    const riskAmount = positionValue * (session.settings.riskPerTrade / 100);
    
    if (riskAmount > session.currentBalance * (session.settings.maxDrawdown / 100)) {
      throw new Error('Position size exceeds risk limits');
    }

    if (session.positions.filter(p => p.status === 'open').length >= session.settings.maxPositions) {
      throw new Error('Maximum positions reached');
    }

    const position: Position = {
      id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      asset: data.asset,
      side: data.side,
      size: data.size,
      entryPrice: data.entryPrice,
      currentPrice: data.entryPrice,
      status: 'open',
      openTime: new Date()
    };

    session.positions.push(position);
    console.log(`[SessionExecutor] Opened position ${position.id} in session ${session.id}`);

    return position;
  }

  /**
   * Close position
   */
  private async closePosition(session: TradingSession, positionId: string): Promise<Position> {
    const position = session.positions.find(p => p.id === positionId);
    if (!position || position.status !== 'open') {
      throw new Error('Position not found or already closed');
    }

    // Mock close price - in real implementation, get from oracle
    const closePrice = position.currentPrice || position.entryPrice;
    const pnl = position.side === 'long' 
      ? (closePrice - position.entryPrice) * position.size
      : (position.entryPrice - closePrice) * position.size;

    position.currentPrice = closePrice;
    position.pnl = pnl;
    position.status = 'closed';
    position.closeTime = new Date();

    // Update session balance
    session.currentBalance += pnl;

    console.log(`[SessionExecutor] Closed position ${positionId} with PnL: ${pnl}`);
    return position;
  }

  /**
   * Rebalance session
   */
  private async rebalanceSession(session: TradingSession): Promise<void> {
    // Check for positions that hit stop loss or take profit
    for (const position of session.positions.filter(p => p.status === 'open')) {
      if (!position.currentPrice) continue;

      const pnlPercent = ((position.currentPrice - position.entryPrice) / position.entryPrice) * 100;
      
      if (position.side === 'long') {
        if (pnlPercent <= -session.settings.stopLoss || pnlPercent >= session.settings.takeProfit) {
          await this.closePosition(session, position.id);
        }
      } else {
        if (pnlPercent >= session.settings.stopLoss || pnlPercent <= -session.settings.takeProfit) {
          await this.closePosition(session, position.id);
        }
      }
    }

    console.log(`[SessionExecutor] Rebalanced session ${session.id}`);
  }

  /**
   * Pause session
   */
  private async pauseSession(session: TradingSession): Promise<void> {
    session.status = 'paused';
    console.log(`[SessionExecutor] Paused session ${session.id}`);
  }

  /**
   * Resume session
   */
  private async resumeSession(session: TradingSession): Promise<void> {
    session.status = 'active';
    console.log(`[SessionExecutor] Resumed session ${session.id}`);
  }

  /**
   * Close session
   */
  private async closeSession(session: TradingSession): Promise<void> {
    // Close all open positions
    const openPositions = session.positions.filter(p => p.status === 'open');
    for (const position of openPositions) {
      await this.closePosition(session, position.id);
    }

    session.status = 'completed';
    session.endTime = new Date();
    console.log(`[SessionExecutor] Closed session ${session.id}`);
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): {
    totalPnL: number;
    winRate: number;
    totalTrades: number;
    openPositions: number;
    duration: number;
  } | null {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    const closedPositions = session.positions.filter(p => p.status === 'closed');
    const winningTrades = closedPositions.filter(p => (p.pnl || 0) > 0);
    const totalPnL = closedPositions.reduce((sum, p) => sum + (p.pnl || 0), 0);
    const winRate = closedPositions.length > 0 ? winningTrades.length / closedPositions.length : 0;
    const openPositions = session.positions.filter(p => p.status === 'open').length;
    const duration = session.endTime 
      ? session.endTime.getTime() - session.startTime.getTime()
      : Date.now() - session.startTime.getTime();

    return {
      totalPnL,
      winRate,
      totalTrades: closedPositions.length,
      openPositions,
      duration
    };
  }

  /**
   * Clean up old sessions
   */
  cleanupOldSessions(olderThanHours: number = 24): void {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    
    for (const [sessionId, session] of this.activeSessions) {
      if (session.endTime && session.endTime < cutoff) {
        this.activeSessions.delete(sessionId);
        console.log(`[SessionExecutor] Cleaned up old session ${sessionId}`);
      }
    }
  }
}

// Default session executor instance
export const sessionExecutor = new SessionExecutor();

// Convenience functions
export const sessions = {
  create: (userId: string, wallet: string, strategy: string, balance: number, settings: SessionSettings) =>
    sessionExecutor.createSession(userId, wallet, strategy as any, balance, settings),
  
  get: (sessionId: string) => sessionExecutor.getSession(sessionId),
  getUserSessions: (userId: string) => sessionExecutor.getUserSessions(userId),
  execute: (sessionId: string, action: string, data: any) =>
    sessionExecutor.executeAction(sessionId, action, data),
  
  getStats: (sessionId: string) => sessionExecutor.getSessionStats(sessionId),
  cleanup: (olderThanHours?: number) => sessionExecutor.cleanupOldSessions(olderThanHours)
};
