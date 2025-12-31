import { AbstractSigner, Provider, TransactionRequest, TransactionResponse, TypedDataDomain, TypedDataField } from 'ethers';
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
        throw new Error('PrivySigner.signTransaction not fully implemented - prefer sendTransaction');
    }

    async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
        console.log('[PrivySigner] Sending transaction via @privy-io/node:', tx);

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
        const response = await this.privy.walletApi.ethereum.sendTransaction({
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
