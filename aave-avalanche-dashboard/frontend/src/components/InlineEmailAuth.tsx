import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, ArrowRight, Loader2, CheckCircle, Wallet } from 'lucide-react';
import { toast } from 'sonner';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface InlineEmailAuthProps {
  onAuthSuccess: (email: string, walletAddress?: string) => void;
}

export function InlineEmailAuth({ onAuthSuccess }: InlineEmailAuthProps) {
  const { address, isConnected } = useAccount();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email) {
      toast.error('Please enter your email');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        throw new Error('Failed to send code');
      }

      toast.success('Code sent to your email!');
      setCodeSent(true);
    } catch (error) {
      toast.error('Failed to send code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!code || code.length !== 6) {
      toast.error('Please enter a 6-digit code');
      return;
    }

    setIsLoading(true);
    try {
      // Include wallet address if MetaMask is connected
      const walletAddress = isConnected && address ? address : undefined;
      
      const res = await fetch(`${API_BASE}/api/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, 
          code,
          walletAddress // Pass connected wallet address
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Invalid code');
      }

      toast.success('Account verified successfully!');
      
      // Store email for authentication
      const normalizedEmail = email.toLowerCase();
      localStorage.setItem('tiltvault_email', normalizedEmail);
      
      // Store wallet address if provided
      if (data.user?.walletAddress) {
        localStorage.setItem('tiltvault_wallet_address', data.user.walletAddress);
      }
      
      onAuthSuccess(normalizedEmail, data.user?.walletAddress);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid code');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* MetaMask Connection Status */}
      {isConnected && address && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-emerald-500" />
          <span className="text-sm text-emerald-600">
            MetaMask Connected: {address.slice(0, 6)}...{address.slice(-4)}
          </span>
        </div>
      )}
      
      {/* Email Input */}
      <form onSubmit={handleSendCode} className="space-y-4">
        <div>
          <Input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-lg"
            required
          />
        </div>
        
        <Button
          type="submit"
          disabled={isLoading || !email}
          className="w-full h-12 bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-700 hover:to-emerald-600 text-white font-semibold"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Sending...
            </>
          ) : (
            <>
              <Mail className="mr-2 h-5 w-5" />
              Request Code
              <ArrowRight className="ml-2 h-5 w-5" />
            </>
          )}
        </Button>
      </form>

      {/* Code Input */}
      <form onSubmit={handleVerifyCode} className="space-y-4">
        <div>
          <Input
            type="text"
            placeholder="Enter 6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className="h-12 text-lg text-center font-mono tracking-widest"
            required
            maxLength={6}
          />
        </div>
        
        <Button
          type="submit"
          disabled={isLoading || code.length !== 6 || !codeSent}
          className="w-full h-12 bg-gradient-to-r from-blue-600 to-emerald-500 hover:from-blue-700 hover:to-emerald-600 text-white font-semibold"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Verifying...
            </>
          ) : (
            <>
              <CheckCircle className="mr-2 h-5 w-5" />
              Verify Code
            </>
          )}
        </Button>
      </form>

      {codeSent && (
        <p className="text-sm text-muted-foreground text-center">
          Code sent! Check your email and enter the 6-digit code above.
        </p>
      )}
    </div>
  );
}
