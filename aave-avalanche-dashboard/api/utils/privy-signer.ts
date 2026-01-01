/**
 * Privy signer utilities for transaction signing and blockchain operations
 */

import { ethers } from 'ethers';

export interface PrivySignerConfig {
  appId: string;
  appSecret: string;
  environment: 'development' | 'production';
}

export interface TransactionRequest {
  to: string;
  value?: string;
  data?: string;
  gasLimit?: string;
  gasPrice?: string;
  nonce?: string;
}

export interface SignedTransaction {
  signature: string;
  transactionHash: string;
  from: string;
}

class PrivySigner {
  private config: PrivySignerConfig;
  private baseUrl: string;

  constructor(config: PrivySignerConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'production' 
      ? 'https://api.privy.io/v1' 
      : 'https://api.privy.test/v1';
  }

  /**
   * Sign transaction with user's wallet
   */
  async signTransaction(userId: string, walletAddress: string, transaction: TransactionRequest): Promise<SignedTransaction> {
    try {
      const response = await fetch(`${this.baseUrl}/wallets/${walletAddress}/sign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          transaction: {
            to: transaction.to,
            value: transaction.value || '0',
            data: transaction.data || '0x',
            gasLimit: transaction.gasLimit || '21000',
            gasPrice: transaction.gasPrice,
            nonce: transaction.nonce
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to sign transaction: ${response.status}`);
      }

      const result = await response.json();
      return {
        signature: result.signature,
        transactionHash: result.transactionHash,
        from: walletAddress
      };
    } catch (error) {
      console.error('[Privy Signer] Sign transaction error:', error);
      throw new Error('Failed to sign transaction with Privy');
    }
  }

  /**
   * Sign message with user's wallet
   */
  async signMessage(userId: string, walletAddress: string, message: string): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/wallets/${walletAddress}/sign-message`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          message: ethers.hashMessage(message)
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to sign message: ${response.status}`);
      }

      const result = await response.json();
      return result.signature;
    } catch (error) {
      console.error('[Privy Signer] Sign message error:', error);
      throw new Error('Failed to sign message with Privy');
    }
  }

  /**
   * Sign typed data (EIP-712)
   */
  async signTypedData(userId: string, walletAddress: string, typedData: any): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/wallets/${walletAddress}/sign-typed-data`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          typedData
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to sign typed data: ${response.status}`);
      }

      const result = await response.json();
      return result.signature;
    } catch (error) {
      console.error('[Privy Signer] Sign typed data error:', error);
      throw new Error('Failed to sign typed data with Privy');
    }
  }

  /**
   * Get wallet balance
   */
  async getBalance(walletAddress: string, chainId: string = '43114'): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/wallets/${walletAddress}/balance?chainId=${chainId}`, {
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get balance: ${response.status}`);
      }

      const result = await response.json();
      return result.balance;
    } catch (error) {
      console.error('[Privy Signer] Get balance error:', error);
      throw new Error('Failed to get wallet balance from Privy');
    }
  }

  /**
   * Send transaction
   */
  async sendTransaction(userId: string, walletAddress: string, transaction: TransactionRequest): Promise<string> {
    try {
      // First sign the transaction
      const signedTx = await this.signTransaction(userId, walletAddress, transaction);
      
      // Then broadcast it
      const response = await fetch(`${this.baseUrl}/wallets/${walletAddress}/send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId,
          signedTransaction: signedTx.signature,
          chainId: '43114' // Avalanche
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to send transaction: ${response.status}`);
      }

      const result = await response.json();
      return result.transactionHash;
    } catch (error) {
      console.error('[Privy Signer] Send transaction error:', error);
      throw new Error('Failed to send transaction with Privy');
    }
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(walletAddress: string, transaction: TransactionRequest): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/wallets/${walletAddress}/estimate-gas`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.appSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          transaction: {
            to: transaction.to,
            value: transaction.value || '0',
            data: transaction.data || '0x'
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to estimate gas: ${response.status}`);
      }

      const result = await response.json();
      return result.gasEstimate;
    } catch (error) {
      console.error('[Privy Signer] Estimate gas error:', error);
      throw new Error('Failed to estimate gas with Privy');
    }
  }
}

// Default Privy signer instance
export const privySigner = new PrivySigner({
  appId: process.env.PRIVY_APP_ID || '',
  appSecret: process.env.PRIVY_APP_SECRET || '',
  environment: (process.env.PRIVY_ENVIRONMENT as any) || 'development'
});

// Convenience functions
export const signer = {
  signTransaction: (userId: string, wallet: string, tx: TransactionRequest) => 
    privySigner.signTransaction(userId, wallet, tx),
  
  signMessage: (userId: string, wallet: string, message: string) => 
    privySigner.signMessage(userId, wallet, message),
  
  signTypedData: (userId: string, wallet: string, typedData: any) => 
    privySigner.signTypedData(userId, wallet, typedData),
  
  getBalance: (wallet: string, chainId?: string) => 
    privySigner.getBalance(wallet, chainId),
  
  sendTransaction: (userId: string, wallet: string, tx: TransactionRequest) => 
    privySigner.sendTransaction(userId, wallet, tx),
  
  estimateGas: (wallet: string, tx: TransactionRequest) => 
    privySigner.estimateGas(wallet, tx)
};

// Helper to create common transaction types
export const transactions = {
  // Simple ETH transfer
  transfer: (to: string, value: string): TransactionRequest => ({
    to,
    value: ethers.parseEther(value).toString(),
    data: '0x'
  }),

  // Contract interaction
  contractCall: (to: string, data: string, value: string = '0'): TransactionRequest => ({
    to,
    value,
    data
  }),

  // Token transfer
  tokenTransfer: (tokenAddress: string, to: string, amount: string): TransactionRequest => {
    const iface = new ethers.Interface(['function transfer(address to, uint256 amount)']);
    const data = iface.encodeFunctionData('transfer', [to, ethers.parseUnits(amount, 18)]);
    
    return {
      to: tokenAddress,
      data,
      value: '0'
    };
  }
};
