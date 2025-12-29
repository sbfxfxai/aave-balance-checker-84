import { AbstractSigner, Provider, TransactionRequest, TransactionResponse, TypedDataDomain, TypedDataField, hashMessage } from 'ethers';
import { PrivyClient } from '@privy-io/server-auth';
import { getPrivyClient } from './privy-client';

export class PrivySigner extends AbstractSigner {
    private privy: PrivyClient;
    private walletId: string;
    address: string;

    constructor(walletId: string, address: string, provider?: Provider) {
        super(provider);
        this.privy = getPrivyClient();
        this.walletId = walletId;
        this.address = address;
    }

    async getAddress(): Promise<string> {
        return this.address;
    }

    connect(provider: Provider | null): PrivySigner {
        return new PrivySigner(this.walletId, this.address, provider || undefined);
    }

    async signTransaction(tx: TransactionRequest): Promise<string> {
        // For MVP, we throw error as GMX SDK usually uses sendTransaction
        throw new Error('PrivySigner.signTransaction not fully implemented - prefer sendTransaction');
    }

    async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
        console.log('[PrivySigner] Sending transaction:', tx);

        // 1. Prepare transaction params for Privy
        const txParams: any = {
            to: tx.to,
            value: tx.value ? tx.value.toString() : '0x0',
            data: tx.data,
            chainId: 43114 // Avalanche C-Chain
        };

        if (tx.gasLimit) txParams.gasLimit = tx.gasLimit.toString();
        if (tx.maxFeePerGas) txParams.maxFeePerGas = tx.maxFeePerGas.toString();
        if (tx.maxPriorityFeePerGas) txParams.maxPriorityFeePerGas = tx.maxPriorityFeePerGas.toString();

        // 2. Execute via Privy
        // @ts-ignore - bypassing strict type check for MVP
        const response = await this.privy.walletApi.ethereum.sendTransaction({
            walletId: this.walletId,
            caip2: 'eip155:43114',
            transaction: txParams
        }) as any;

        console.log('[PrivySigner] Transaction sent:', response);

        // 3. Return a mock TransactionResponse that satisfies Ethers
        return {
            hash: response.transactionHash || response.hash,
            wait: async () => {
                if (this.provider) {
                    return this.provider.getTransactionReceipt(response.transactionHash || response.hash);
                }
                return null;
            }
        } as any;
    }

    async signMessage(message: string | Uint8Array): Promise<string> {
        const response = await this.privy.walletApi.ethereum.signMessage({
            walletId: this.walletId,
            message: typeof message === 'string' ? message : Buffer.from(message).toString('utf-8')
        });
        return response.signature;
    }

    async signTypedData(domain: TypedDataDomain, types: Record<string, TypedDataField[]>, value: Record<string, any>): Promise<string> {
        // Flatten structure based on lint feedback, using any cast to be safe
        const input: any = {
            walletId: this.walletId,
            domain,
            types,
            message: value
        };

        const response = await this.privy.walletApi.ethereum.signTypedData(input);
        return response.signature;
    }
}
