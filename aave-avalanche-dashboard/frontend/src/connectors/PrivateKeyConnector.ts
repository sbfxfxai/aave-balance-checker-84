import { Wallet, ethers } from 'ethers';
import type { Connector } from 'wagmi';

// Custom connector implementation (wagmi v2 doesn't export Connector as a class)
// This is a standalone implementation that matches the Connector interface
export class PrivateKeyConnector {
  private wallet: Wallet | null = null;
  private provider: ethers.Provider;

  constructor({ provider }: { provider: ethers.Provider }) {
    this.provider = provider;
  }

  async connect() {
    const privateKey = localStorage.getItem('tiltvault_temp_private_key');
    
    if (!privateKey) {
      throw new Error('No private key found');
    }

    try {
      // Create wallet from private key
      this.wallet = new Wallet(privateKey, this.provider);
      
      // Clear the temporary storage
      localStorage.removeItem('tiltvault_temp_private_key');
      
      console.log('[PrivateKeyConnector] Connected with address:', this.wallet.address);
      
      return {
        account: this.wallet.address as `0x${string}`,
        chain: {
          id: 43114, // Avalanche
          unsupported: false,
        },
      };
    } catch (error) {
      console.error('[PrivateKeyConnector] Failed to connect:', error);
      localStorage.removeItem('tiltvault_temp_private_key');
      throw error;
    }
  }

  async disconnect() {
    this.wallet = null;
    console.log('[PrivateKeyConnector] Disconnected');
  }

  async getAccount() {
    return this.wallet?.address as `0x${string}` || undefined;
  }

  async getChainId() {
    return 43114; // Avalanche
  }

  async getProvider() {
    return this.provider;
  }

  async isAuthorized() {
    return !!this.wallet;
  }

  protected async onConnect() {
    // Called when connected
  }

  protected async onDisconnect() {
    // Called when disconnected
  }
}
