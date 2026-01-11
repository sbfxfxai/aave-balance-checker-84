import { AbstractSigner, Provider, TransactionRequest, TransactionResponse, TypedDataDomain, TypedDataField } from 'ethers';
import { logger, LogCategory } from './logger';
import { errorTracker } from './errorTracker';

// Buffer is available globally in Node.js/Vercel environments
interface Buffer {
  toString(encoding?: 'utf-8' | 'utf8' | 'base64' | 'hex'): string;
  length: number;
}

declare const Buffer: {
  from(data: Uint8Array | ArrayLike<number> | ArrayBuffer, encoding?: string): Buffer;
  from(data: string, encoding: 'base64' | 'hex' | 'utf8' | 'utf-8'): Buffer;
  isBuffer(obj: any): boolean;
  new (data: string, encoding?: string): Buffer;
  prototype: Buffer;
};

// Dynamic import with error handling for PrivyClient
let PrivyClient: any = null;
let privyImportError: Error | null = null;
let initPromise: Promise<{ PrivyClient: any; error: Error | null }> | null = null;

async function initPrivyClient(): Promise<{ PrivyClient: any; error: Error | null }> {
  // Return cached result if available
  if (PrivyClient !== null || privyImportError !== null) {
    return { PrivyClient, error: privyImportError };
  }
  
  // If initialization is in progress, wait for it
  if (initPromise) {
    return initPromise;
  }
  
  // Start initialization
  initPromise = (async () => {
    try {
      // Try dynamic import to avoid static import issues
      const privyModule = await import('@privy-io/server-auth');
      PrivyClient = privyModule.PrivyClient;
      
      logger.info('Successfully imported PrivyClient', LogCategory.AUTH);
      return { PrivyClient, error: null };
    } catch (error) {
      privyImportError = error instanceof Error ? error : new Error(String(error));
      
      logger.error('Failed to import @privy-io/server-auth', LogCategory.AUTH, {}, privyImportError);
      
      errorTracker.trackAuthError(privyImportError, {
        stage: 'privy_signer_import',
        errorType: 'import_failure'
      });
      
      return { PrivyClient: null, error: privyImportError };
    } finally {
      initPromise = null;
    }
  })();
  
  return initPromise;
}

// Export async function to check if Privy is available
export async function isPrivyAvailable(): Promise<boolean> {
  if (privyImportError !== null) return false;
  if (PrivyClient !== null) return true;
  
  const result = await initPrivyClient();
  return result.PrivyClient !== null;
}

export async function getPrivyImportError(): Promise<Error | null> {
  if (privyImportError !== null) return privyImportError;
  if (PrivyClient !== null) return null;
  
  const result = await initPrivyClient();
  return result.error;
}

export interface PrivySignerOptions {
  chainId?: number;
  enableLogging?: boolean;
}

export class PrivySigner extends AbstractSigner {
  private privy: any;
  private walletId: string;
  private address: string;
  private options: PrivySignerOptions;

  constructor(walletId: string, address: string, provider?: Provider, options: PrivySignerOptions = {}) {
    super(provider);
    this.walletId = walletId;
    this.address = address;
    this.options = {
      chainId: options.chainId || 43114, // Default to Avalanche C-Chain
      enableLogging: options.enableLogging ?? true
    };
    
    if (this.options.enableLogging) {
      logger.info('PrivySigner created', LogCategory.AUTH, {
        walletId: this.walletId.substring(0, 8) + '...',
        address: this.address,
        chainId: this.options.chainId
      });
    }
  }

  private async ensurePrivyClient(): Promise<any> {
    if (!this.privy) {
      try {
        // Try to use the shared privy client from privy-client.ts
        const { getPrivyClient } = await import('./privy-client');
        this.privy = await getPrivyClient();
        
        if (this.options.enableLogging) {
          logger.info('PrivySigner: Using shared Privy client', LogCategory.AUTH);
        }
      } catch (sharedClientError) {
        // Fallback to local initialization
        if (this.options.enableLogging) {
          logger.warn('Shared Privy client unavailable, using local initialization', LogCategory.AUTH, {
            error: sharedClientError instanceof Error ? sharedClientError.message : String(sharedClientError)
          });
        }
        
        const result = await initPrivyClient();
        if (!result.PrivyClient) {
          const errorMsg = result.error?.message || 'Unknown Privy client initialization error';
          const error = new Error(`PrivySigner cannot be initialized: ${errorMsg}`);
          
          logger.error('PrivySigner initialization failed', LogCategory.AUTH, { 
            walletId: this.walletId.substring(0, 8) + '...',
            error: errorMsg 
          }, error);
          
          errorTracker.trackAuthError(error, {
            stage: 'privy_signer_init',
            walletId: this.walletId.substring(0, 8) + '...'
          });
          
          throw error;
        }
        
        // Initialize the client
        const { PRIVY_APP_ID, PRIVY_APP_SECRET } = process.env;
        if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) {
          throw new Error('Privy configuration missing: PRIVY_APP_ID and PRIVY_APP_SECRET required');
        }
        
        this.privy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);
        
        if (this.options.enableLogging) {
          logger.info('PrivySigner: Using local Privy client', LogCategory.AUTH);
        }
      }
    }
    return this.privy;
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  connect(provider: Provider | null): PrivySigner {
    return new PrivySigner(this.walletId, this.address, provider || undefined, this.options);
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    try {
      if (this.options.enableLogging) {
        logger.debug('PrivySigner: Signing transaction', LogCategory.AUTH, {
          walletId: this.walletId.substring(0, 8) + '...',
          to: tx.to,
          value: tx.value
        });
      }

      const privy = await this.ensurePrivyClient();

      const txParams: any = {
        to: tx.to,
        value: tx.value ? tx.value.toString() : '0x0',
        data: tx.data,
        chainId: tx.chainId || this.options.chainId
      };

      if (tx.gasLimit) txParams.gasLimit = tx.gasLimit.toString();
      if (tx.maxFeePerGas) txParams.maxFeePerGas = tx.maxFeePerGas.toString();
      if (tx.maxPriorityFeePerGas) txParams.maxPriorityFeePerGas = tx.maxPriorityFeePerGas.toString();

      const response = await privy.walletApi.ethereum.signTransaction({
        walletId: this.walletId,
        caip2: `eip155:${txParams.chainId}`,
        transaction: txParams
      });

      if (this.options.enableLogging) {
        logger.debug('PrivySigner: Transaction signed', LogCategory.AUTH, {
          walletId: this.walletId.substring(0, 8) + '...'
        });
      }

      return response.signature;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      logger.error('PrivySigner: signTransaction failed', LogCategory.AUTH, {
        walletId: this.walletId.substring(0, 8) + '...',
        to: tx.to,
        error: errorMsg
      }, error instanceof Error ? error : new Error(errorMsg));
      
      errorTracker.trackAuthError(error instanceof Error ? error : new Error(errorMsg), {
        stage: 'privy_sign_transaction',
        walletId: this.walletId.substring(0, 8) + '...'
      });
      
      throw error;
    }
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const startTime = Date.now();
    
    try {
      if (this.options.enableLogging) {
        logger.info('PrivySigner: Sending transaction', LogCategory.AUTH, {
          walletId: this.walletId.substring(0, 8) + '...',
          to: tx.to,
          value: tx.value,
          chainId: tx.chainId || this.options.chainId
        });
      }

      // Ensure Privy client is initialized
      const privy = await this.ensurePrivyClient();

      const chainId = tx.chainId || this.options.chainId;
      const txParams: any = {
        to: tx.to,
        value: tx.value ? tx.value.toString() : '0x0',
        data: tx.data,
        chainId
      };

      if (tx.gasLimit) txParams.gasLimit = tx.gasLimit.toString();
      if (tx.maxFeePerGas) txParams.maxFeePerGas = tx.maxFeePerGas.toString();
      if (tx.maxPriorityFeePerGas) txParams.maxPriorityFeePerGas = tx.maxPriorityFeePerGas.toString();

      // Using walletApi.ethereum.sendTransaction for @privy-io/server-auth
      const response = await privy.walletApi.ethereum.sendTransaction({
        walletId: this.walletId,
        caip2: `eip155:${chainId}`,
        transaction: txParams
      });

      const hash = response.transactionHash || response.hash;

      if (this.options.enableLogging) {
        logger.info('PrivySigner: Transaction sent', LogCategory.AUTH, {
          walletId: this.walletId.substring(0, 8) + '...',
          hash,
          duration: Date.now() - startTime
        });
      }

      // Create a proper TransactionResponse-like object
      const transactionResponse = {
        hash,
        to: tx.to,
        from: this.address,
        value: tx.value || '0x0',
        data: tx.data || '0x',
        chainId,
        gasLimit: tx.gasLimit,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        wait: async (confirmations?: number) => {
          if (!this.provider) {
            logger.warn('No provider available for transaction receipt', LogCategory.AUTH, { hash });
            return null;
          }
          
          try {
            const receipt = await this.provider.getTransactionReceipt(hash);
            if (confirmations && receipt) {
              const currentBlock = await this.provider.getBlockNumber();
              const confirmationsNeeded = currentBlock - receipt.blockNumber;
              if (confirmationsNeeded < confirmations) {
                // Wait for more confirmations
                await new Promise(resolve => setTimeout(resolve, 2000));
                return transactionResponse.wait(confirmations);
              }
            }
            return receipt;
          } catch (waitError) {
            logger.error('Failed to get transaction receipt', LogCategory.AUTH, { hash }, waitError instanceof Error ? waitError : new Error(String(waitError)));
            throw waitError;
          }
        }
      } as TransactionResponse;

      return transactionResponse;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      logger.error('PrivySigner: sendTransaction failed', LogCategory.AUTH, {
        walletId: this.walletId.substring(0, 8) + '...',
        to: tx.to,
        value: tx.value,
        duration: Date.now() - startTime,
        error: errorMsg
      }, error instanceof Error ? error : new Error(errorMsg));
      
      errorTracker.trackAuthError(error instanceof Error ? error : new Error(errorMsg), {
        stage: 'privy_send_transaction',
        walletId: this.walletId.substring(0, 8) + '...'
      });
      
      throw error;
    }
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    try {
      if (this.options.enableLogging) {
        logger.debug('PrivySigner: Signing message', LogCategory.AUTH, {
          walletId: this.walletId.substring(0, 8) + '...'
        });
      }

      const privy = await this.ensurePrivyClient();
      
      // Convert message to string safely
      let msg: string;
      if (typeof message === 'string') {
        msg = message;
      } else if (typeof Buffer !== 'undefined') {
        msg = Buffer.from(message).toString('utf-8');
      } else {
        msg = new TextDecoder().decode(message);
      }
      
      const response = await privy.walletApi.ethereum.signMessage({
        walletId: this.walletId,
        message: msg
      });
      
      if (this.options.enableLogging) {
        logger.debug('PrivySigner: Message signed', LogCategory.AUTH, {
          walletId: this.walletId.substring(0, 8) + '...'
        });
      }
      
      return response.signature;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      logger.error('PrivySigner: signMessage failed', LogCategory.AUTH, {
        walletId: this.walletId.substring(0, 8) + '...',
        error: errorMsg
      }, error instanceof Error ? error : new Error(errorMsg));
      
      errorTracker.trackAuthError(error instanceof Error ? error : new Error(errorMsg), {
        stage: 'privy_sign_message',
        walletId: this.walletId.substring(0, 8) + '...'
      });
      
      throw error;
    }
  }

  async signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, any>): Promise<string> {
    try {
      if (this.options.enableLogging) {
        logger.debug('PrivySigner: Signing typed data', LogCategory.AUTH, {
          walletId: this.walletId.substring(0, 8) + '...',
          domainName: domain.name
        });
      }

      const privy = await this.ensurePrivyClient();
      
      // Privy API may expect domain in a different format - using type assertion to match EIP-712 structure
      const response = await privy.walletApi.ethereum.signTypedData({
        walletId: this.walletId,
        domain: domain as any,
        types,
        message: value
      } as any);
      
      if (this.options.enableLogging) {
        logger.debug('PrivySigner: Typed data signed', LogCategory.AUTH, {
          walletId: this.walletId.substring(0, 8) + '...'
        });
      }
      
      return response.signature;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      logger.error('PrivySigner: signTypedData failed', LogCategory.AUTH, {
        walletId: this.walletId.substring(0, 8) + '...',
        domainName: domain.name,
        error: errorMsg
      }, error instanceof Error ? error : new Error(errorMsg));
      
      errorTracker.trackAuthError(error instanceof Error ? error : new Error(errorMsg), {
        stage: 'privy_sign_typed_data',
        walletId: this.walletId.substring(0, 8) + '...'
      });
      
      throw error;
    }
  }

  /**
   * Get the current status of the PrivySigner
   */
  getStatus(): {
    initialized: boolean;
    walletId: string;
    address: string;
    chainId: number;
    hasProvider: boolean;
  } {
    return {
      initialized: this.privy !== null,
      walletId: this.walletId,
      address: this.address,
      chainId: this.options.chainId,
      hasProvider: !!this.provider
    };
  }

  /**
   * Reset the internal Privy client (useful for testing or recovery)
   */
  reset(): void {
    this.privy = null;
    
    if (this.options.enableLogging) {
      logger.info('PrivySigner: Reset internal client', LogCategory.AUTH, {
        walletId: this.walletId.substring(0, 8) + '...'
      });
    }
  }
}
