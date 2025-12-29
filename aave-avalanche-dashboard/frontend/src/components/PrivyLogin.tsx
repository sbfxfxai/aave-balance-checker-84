import React from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Mail, Shield, Zap } from 'lucide-react';

/**
 * PrivyLogin component for email-based authentication
 * Provides a simple "Sign up with email" experience
 */
export function PrivyLogin() {
    const { login, authenticated, ready, user, logout } = usePrivy();
    const { wallets } = useWallets();

    // Get the user's smart wallet address
    const smartWallet = wallets.find(w => w.walletClientType === 'privy');
    const walletAddress = smartWallet?.address || user?.wallet?.address;

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
