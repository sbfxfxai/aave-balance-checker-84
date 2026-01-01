/**
 * Privy client utilities for wallet authentication and management
 */

export interface PrivyConfig {
  appId: string;
  appSecret: string;
  environment: 'development' | 'production';
}

export interface PrivyUser {
  id: string;
  email?: string;
  wallet?: {
    address: string;
    chainType: string;
  };
  createdAt: string;
  linkedAccounts: Array<{
    type: string;
    address: string;
  }>;
}

export interface PrivyAuthToken {
  token: string;
  expiresAt: string;
  user: PrivyUser;
}

class PrivyClient {
  private config: PrivyConfig;
  private baseUrl: string;

  constructor(config: PrivyConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'production' 
      ? 'https://api.privy.io/v1' 
      : 'https://api.privy.test/v1';
  }

  /**
   * Authenticate user with access token
   */
  async authenticateUser(accessToken: string): Promise<PrivyUser> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/authenticate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ accessToken })
      });

      if (!response.ok) {
        throw new Error(`Privy auth failed: ${response.status}`);
      }

      const data = await response.json();
      return data.user;
    } catch (error) {
      console.error('[Privy] Authentication error:', error);
      throw new Error('Failed to authenticate user with Privy');
    }
  }

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<PrivyUser | null> {
    try {
      const response = await fetch(`${this.baseUrl}/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`Failed to get user: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[Privy] Get user error:', error);
      throw new Error('Failed to retrieve user from Privy');
    }
  }

  /**
   * Create authentication session
   */
  async createAuthSession(userId: string): Promise<PrivyAuthToken> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/session`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId })
      });

      if (!response.ok) {
        throw new Error(`Failed to create auth session: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[Privy] Create session error:', error);
      throw new Error('Failed to create authentication session');
    }
  }

  /**
   * Link email to user
   */
  async linkEmail(userId: string, email: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/users/${userId}/link`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type: 'email',
          value: email
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to link email: ${response.status}`);
      }
    } catch (error) {
      console.error('[Privy] Link email error:', error);
      throw new Error('Failed to link email to user');
    }
  }

  /**
   * Verify wallet ownership
   */
  async verifyWalletOwnership(userId: string, walletAddress: string): Promise<boolean> {
    try {
      const user = await this.getUser(userId);
      if (!user) return false;

      // Check if wallet is linked to user
      const linkedWallet = user.linkedAccounts.find(
        account => account.type === 'wallet' && 
        account.address.toLowerCase() === walletAddress.toLowerCase()
      );

      return !!linkedWallet;
    } catch (error) {
      console.error('[Privy] Verify wallet error:', error);
      return false;
    }
  }

  /**
   * Get user's linked wallets
   */
  async getUserWallets(userId: string): Promise<string[]> {
    try {
      const user = await this.getUser(userId);
      if (!user) return [];

      return user.linkedAccounts
        .filter(account => account.type === 'wallet')
        .map(account => account.address);
    } catch (error) {
      console.error('[Privy] Get wallets error:', error);
      return [];
    }
  }
}

// Default Privy client instance
export const privyClient = new PrivyClient({
  appId: process.env.PRIVY_APP_ID || '',
  appSecret: process.env.PRIVY_APP_SECRET || '',
  environment: (process.env.PRIVY_ENVIRONMENT as any) || 'development'
});

// Convenience functions
export const privy = {
  authenticate: (token: string) => privyClient.authenticateUser(token),
  getUser: (userId: string) => privyClient.getUser(userId),
  createSession: (userId: string) => privyClient.createAuthSession(userId),
  linkEmail: (userId: string, email: string) => privyClient.linkEmail(userId, email),
  verifyWallet: (userId: string, wallet: string) => privyClient.verifyWalletOwnership(userId, wallet),
  getWallets: (userId: string) => privyClient.getUserWallets(userId)
};

// Middleware helper for API routes
export function createPrivyAuthMiddleware(required: boolean = true) {
  return async (req: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      if (required) {
        throw new Error('Authorization header required');
      }
      return null;
    }

    const token = authHeader.substring(7);
    try {
      const user = await privy.authenticate(token);
      return user;
    } catch (error) {
      if (required) {
        throw new Error('Invalid authentication token');
      }
      return null;
    }
  };
}
