import { AbstractSigner, Provider, TransactionRequest, TransactionResponse, TypedDataDomain, TypedDataField } from 'ethers';

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

async function initPrivyClient() {
  if (PrivyClient !== null || privyImportError !== null) {
    return { PrivyClient, error: privyImportError };
  }

  try {
    // Try dynamic import to avoid static import issues
    const privyModule = await import('@privy-io/server-auth');
    PrivyClient = privyModule.PrivyClient;
    console.log('[PrivySigner] Successfully imported PrivyClient');
    return { PrivyClient, error: null };
  } catch (error) {
    privyImportError = error instanceof Error ? error : new Error(String(error));
    console.error('[PrivySigner] Failed to import @privy-io/server-auth:', privyImportError.message);
    return { PrivyClient: null, error: privyImportError };
  }
}

import { getPrivyClient } from './privy-client';

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

export class PrivySigner extends AbstractSigner {
    private privy: any;
    private walletId: string;
    address: string;

    constructor(walletId: string, address: string, provider?: Provider) {
        super(provider);
        this.walletId = walletId;
        this.address = address;
        // Privy client will be initialized lazily when needed
    }

    private async ensurePrivyClient(): Promise<any> {
        if (!this.privy) {
            try {
                const result = await initPrivyClient();
                if (!result.PrivyClient) {
                    const errorMsg = result.error?.message || 'Unknown Privy client initialization error';
                    console.error('[PrivySigner] PrivyClient initialization failed:', errorMsg);
                    throw new Error(`PrivySigner cannot be initialized: ${errorMsg}`);
                }
                // Import and call async getPrivyClient
                const { getPrivyClient } = await import('./privy-client.js');
                this.privy = await getPrivyClient();
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error('[PrivySigner] Failed to ensure PrivyClient:', errorMsg);
                throw new Error(`PrivySigner cannot be initialized: ${errorMsg}`);
            }
        }
        return this.privy;
    }

    async getAddress(): Promise<string> {
        return this.address;
    }

    connect(provider: Provider | null): PrivySigner {
        return new PrivySigner(this.walletId, this.address, provider || undefined);
    }

    async signTransaction(tx: TransactionRequest): Promise<string> {
        throw new Error('PrivySigner.signTransaction not fully implemented - prefer sendTransaction');
    }

    async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
        console.log('[PrivySigner] Sending transaction via @privy-io/node:', tx);

        // Ensure Privy client is initialized
        const privy = await this.ensurePrivyClient();

        const txParams: any = {
            to: tx.to,
            value: tx.value ? tx.value.toString() : '0x0',
            data: tx.data,
            chainId: 43114
        };

        if (tx.gasLimit) txParams.gasLimit = tx.gasLimit.toString();
        if (tx.maxFeePerGas) txParams.maxFeePerGas = tx.maxFeePerGas.toString();
        if (tx.maxPriorityFeePerGas) txParams.maxPriorityFeePerGas = tx.maxPriorityFeePerGas.toString();

        // Using walletApi.ethereum.sendTransaction for @privy-io/server-auth
        const response = await privy.walletApi.ethereum.sendTransaction({
            walletId: this.walletId,
            caip2: 'eip155:43114',
            transaction: txParams
        }) as any;

        console.log('[PrivySigner] Transaction response:', response);

        const hash = response.transactionHash || response.hash;

        return {
            hash: hash,
            wait: async () => {
                if (this.provider) {
                    return this.provider.getTransactionReceipt(hash);
                }
                return null;
            }
        } as any;
    }

    async signMessage(message: string | Uint8Array): Promise<string> {
        const msg = typeof message === 'string' ? message : Buffer.from(message).toString('utf-8');
        const response = await this.privy.walletApi.ethereum.signMessage({
            walletId: this.walletId,
            message: msg
        });
        return response.signature;
    }

    async signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, any>): Promise<string> {
        // Privy API may expect domain in a different format - using type assertion to match EIP-712 structure
        const response = await this.privy.walletApi.ethereum.signTypedData({
            walletId: this.walletId,
            domain: domain as any,
            types,
            message: value
        } as any);
        return response.signature;
    }
}
