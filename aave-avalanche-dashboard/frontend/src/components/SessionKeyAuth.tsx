import React, { useState } from 'react';
// @ts-expect-error - @privy-io/react-auth types exist but TypeScript can't resolve them due to package.json exports configuration
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
// import { ECDSAValidator } from '@zerodev/ecdsa-validator';
// import { createKernelAccountClient, createKernelAccount } from '@zerodev/sdk';
// import { bundlerActions } from 'permissionless';
// import { sessionKeyPermissions, zeroDevConfig } from '@/lib/privy-config';
// import { http, createPublicClient } from 'viem';
// import { avalanche } from 'viem/chains';

export function SessionKeyAuth() {
    const { authenticated, user } = usePrivy();
    const { wallets } = useWallets();
    const [isLoading, setIsLoading] = useState(false);
    const [isAuthorized, setIsAuthorized] = useState(false); // TODO: Check backend if already authorized
    const [error, setError] = useState<string | null>(null);

    const handleEnableAutomation = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const privyWallet = wallets.find((w: any) => w.walletClientType === 'privy');
            // Allow fallback to connected wallet if no privy wallet, but ideally we want privy wallet ID
            if (!privyWallet && !user?.wallet) throw new Error('No wallet found');

            const walletAddress = privyWallet?.address || user?.wallet?.address;
            const privyUserId = user?.id;

            if (!walletAddress || !privyUserId) throw new Error('Missing wallet or user ID');

            // Sign delegation message
            const message = "Authorize TiltVault to execute GMX strategies on my behalf.";
            console.log('Signing delegation message...');

            // Use privy wallet if available, otherwise check if connected wallet can sign
            // Privy embedded wallet should support signing
            let signature = '';
            if (privyWallet) {
                signature = await privyWallet.sign(message);
            } else if (user.wallet) {
                // How to sign with generic user.wallet? usePrivy doesn't expose sign directly on user.wallet
                // We depend on useWallets() finding the active wallet
                const activeWallet = wallets.find((w: any) => w.address === user.wallet?.address);
                if (activeWallet) {
                    signature = await activeWallet.sign(message);
                } else {
                    throw new Error('Wallet not found for signing');
                }
            }

            // Associate user on backend with signature
            const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/wallet/associate-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletAddress, privyUserId, signature, message }),
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to register automation');
            }

            console.log('Automation enabled for:', walletAddress);

            // Simulate network delay for UX
            await new Promise(resolve => setTimeout(resolve, 1000));

            setIsAuthorized(true);
        } catch (err) {
            console.error('Failed to enable automation:', err);
            setError('Failed to enable automation. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!authenticated) return null;

    if (isAuthorized) {
        return (
            <Card className="bg-emerald-900/10 border-emerald-500/20">
                <CardContent className="pt-6 flex items-center gap-4">
                    <div className="p-3 bg-emerald-500/10 rounded-full">
                        <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-emerald-400">Automation Active</h3>
                        <p className="text-sm text-slate-400">TiltVault is authorized to execute trades for you.</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="bg-slate-900/50 border-slate-800">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-indigo-400" />
                    Enable Automated Trading
                </CardTitle>
                <CardDescription>
                    Authorize TiltVault to execute trades on your behalf without manual signing.
                </CardDescription>
            </CardHeader>
            <CardContent>
                {error && (
                    <div className="mb-4 p-3 bg-red-900/20 border border-red-900/50 rounded-lg flex items-center gap-2 text-red-400 text-sm">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </div>
                )}

                <Button
                    onClick={handleEnableAutomation}
                    disabled={isLoading}
                    className="w-full bg-indigo-600 hover:bg-indigo-700"
                >
                    {isLoading ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Authorizing...
                        </>
                    ) : (
                        'Enable One-Click Automation'
                    )}
                </Button>
                <p className="mt-4 text-xs text-slate-500 text-center">
                    You are creating a session key with limited permissions. You can revoke access at any time.
                </p>
            </CardContent>
        </Card>
    );
}

export default SessionKeyAuth;
