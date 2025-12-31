import React from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Mail, Shield, Zap } from 'lucide-react';
import { toast } from 'sonner';

/**
 * PrivyLogin component for email-based authentication
 * Provides a simple "Sign up with email" experience
 */
export function PrivyLogin() {
    const { login, authenticated, ready, user, logout } = usePrivy();
    const { wallets } = useWallets();

    // Get the user's Privy smart wallet address (Ethereum only, filter out Solana)
    const isEthereumAddress = (addr: string | undefined | null): boolean => {
        return !!addr && addr.startsWith('0x') && addr.length === 42;
    };
    
    // Find Privy smart wallet with Ethereum address
    const smartWallet = wallets.find(w => 
        w.walletClientType === 'privy' && isEthereumAddress(w.address)
    );
    
    // Fallback to user wallet if Privy smart wallet not found
    const walletAddress = smartWallet?.address || 
        (isEthereumAddress(user?.wallet?.address) ? user?.wallet?.address : undefined);
    
    // Log wallet detection for debugging
    if (authenticated && ready) {
        console.log('[PrivyLogin] Wallet detection:', {
            smartWalletFound: !!smartWallet,
            smartWalletAddress: smartWallet?.address,
            userWalletAddress: user?.wallet?.address,
            selectedWalletAddress: walletAddress,
            totalWallets: wallets.length,
            walletTypes: wallets.map(w => ({ type: w.walletClientType, address: w.address }))
        });
    }

    // Associate user with wallet on successful authentication (WITH SIGNATURE)
    // CRITICAL: Wait for wallet to be ready before attempting association
    React.useEffect(() => {
        if (authenticated && user && walletAddress && ready) {
            // CRITICAL: Validate wallet address is NOT hub wallet
            const HUB_WALLET_ADDRESS = '0xec80A2cB3652Ec599eFBf7Aac086d07F391A5e55';
            if (walletAddress.toLowerCase() === HUB_WALLET_ADDRESS.toLowerCase()) {
                console.error('[PrivyLogin] ❌ CRITICAL ERROR: Cannot associate hub wallet address!');
                console.error('[PrivyLogin] Hub wallet:', HUB_WALLET_ADDRESS);
                console.error('[PrivyLogin] Detected wallet:', walletAddress);
                console.error('[PrivyLogin] This should be the user\'s Privy smart wallet, not the hub wallet!');
                return; // Don't proceed with hub wallet association
            }
            
            // CRITICAL: Only proceed if we have a Privy smart wallet available for signing
            // This prevents duplicate association attempts (one without signature, one with)
            if (!smartWallet) {
                console.log('[PrivyLogin] ⏳ Waiting for Privy smart wallet to be ready...');
                return; // Wait for wallet to be ready
            }
            
            const associateUser = async () => {
                try {
                    // CRITICAL: Generate signature to prove wallet ownership
                    const message = `TiltVault Wallet Association\n\nWallet: ${walletAddress}\nUser: ${user.id}\nTimestamp: ${Date.now()}`;
                    console.log('[PrivyLogin] 🔐 Generating signature for wallet association...');
                    console.log('[PrivyLogin] Wallet address:', walletAddress);
                    console.log('[PrivyLogin] Privy User ID:', user.id);
                    console.log('[PrivyLogin] Message to sign:', message);
                    
                    let signature = '';
                    try {
                        // Try to sign with Privy smart wallet first
                        if (smartWallet) {
                            console.log('[PrivyLogin] Signing with Privy smart wallet...');
                            signature = await smartWallet.sign(message);
                            console.log('[PrivyLogin] ✅ Signature generated:', signature.slice(0, 20) + '...');
                        } else {
                            // Fallback: try to find any wallet that can sign
                            const activeWallet = wallets.find(w => w.address === walletAddress);
                            if (activeWallet) {
                                console.log('[PrivyLogin] Signing with active wallet...');
                                signature = await activeWallet.sign(message);
                                console.log('[PrivyLogin] ✅ Signature generated:', signature.slice(0, 20) + '...');
                            } else {
                                console.warn('[PrivyLogin] ⚠️ No wallet found for signing - will attempt association without signature');
                            }
                        }
                    } catch (signError) {
                        console.error('[PrivyLogin] ❌ Signature generation failed:', signError);
                        console.warn('[PrivyLogin] ⚠️ Will attempt association without signature (fallback)');
                        // Continue without signature as fallback
                    }

                    const requestBody: { walletAddress: string; privyUserId: string; signature?: string; message?: string } = {
                        walletAddress,
                        privyUserId: user.id,
                    };

                    // Only include signature if we successfully generated one
                    if (signature) {
                        requestBody.signature = signature;
                        requestBody.message = message;
                        console.log('[PrivyLogin] ✅ Sending association request WITH signature');
                    } else {
                        console.warn('[PrivyLogin] ⚠️ Sending association request WITHOUT signature (fallback mode)');
                    }

                    const response = await fetch('/api/wallet/associate-user', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(requestBody),
                    });

                    if (response.ok) {
                        const result = await response.json();
                        if (result.signatureVerified) {
                            console.log('[PrivyLogin] ✅✅✅ SIGNATURE VERIFIED by backend');
                            console.log('[PrivyLogin] ✅ Wallet ownership cryptographically confirmed');
                            console.log('[PrivyLogin] ✅ Association completed with signature verification');
                            console.log('[PrivyLogin] Wallet:', walletAddress);
                            console.log('[PrivyLogin] Privy User ID:', user.id);
                        } else if (signature) {
                            console.warn('[PrivyLogin] ⚠️ Signature sent but backend did not verify (unexpected)');
                        } else {
                            console.log('[PrivyLogin] ✅ User associated with wallet successfully (implicit association - no signature)');
                        }
                    } else {
                        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                        console.error('[PrivyLogin] ❌ Failed to associate user with wallet:', errorData);
                        if (errorData.error?.includes('signature')) {
                            console.error('[PrivyLogin] ❌ Signature verification failed - wallet association rejected');
                            console.error('[PrivyLogin] Error details:', errorData.details);
                        }
                    }
                } catch (error) {
                    console.error('[PrivyLogin] ❌ Error associating user:', error);
                }
            };

            associateUser();
        }
    }, [authenticated, user, walletAddress, smartWallet, wallets, ready]);

    if (!ready) {
        return (
            <Card className="w-full max-w-md mx-auto bg-slate-900/50 border-slate-800">
                <CardContent className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
                </CardContent>
            </Card>
        );
    }

    if (authenticated && user) {
        return (
            <Card className="w-full max-w-md mx-auto bg-slate-900/50 border-slate-800">
                <CardHeader>
                    <CardTitle className="text-emerald-400 flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        Connected
                    </CardTitle>
                    <CardDescription>
                        Your automated trading wallet is ready
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="p-3 rounded-lg bg-slate-800/50">
                        <p className="text-sm text-slate-400">Email</p>
                        <p className="text-white font-mono">{user.email?.address || 'N/A'}</p>
                    </div>
                    {walletAddress && (
                        <div className="p-3 rounded-lg bg-slate-800/50">
                            <p className="text-sm text-slate-400">Smart Wallet</p>
                            <p className="text-white font-mono text-sm">
                                {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                            </p>
                        </div>
                    )}
                    <Button onClick={logout} variant="outline" className="w-full">
                        Sign Out
                    </Button>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="w-full max-w-md mx-auto bg-slate-900/50 border-slate-800">
            <CardHeader className="text-center">
                <CardTitle className="text-2xl text-white">
                    Start Investing
                </CardTitle>
                <CardDescription className="text-slate-400">
                    Sign up with email for fully automated crypto investing
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Benefits */}
                <div className="space-y-3">
                    <div className="flex items-center gap-3 text-sm text-slate-300">
                        <Zap className="h-4 w-4 text-emerald-500" />
                        <span>Automated DeFi strategies</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-300">
                        <Shield className="h-4 w-4 text-emerald-500" />
                        <span>Non-custodial - you own your funds</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-300">
                        <Mail className="h-4 w-4 text-emerald-500" />
                        <span>No wallet setup required</span>
                    </div>
                </div>

                <Button
                    onClick={login}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-6 text-lg"
                >
                    <Mail className="mr-2 h-5 w-5" />
                    Sign Up with Email
                </Button>

                <p className="text-xs text-center text-slate-500">
                    By signing up, you agree to our Terms of Service and Privacy Policy
                </p>
            </CardContent>
        </Card>
    );
}

export default PrivyLogin;
