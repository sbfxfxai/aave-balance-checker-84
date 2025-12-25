import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  RefreshCw, 
  DollarSign, 
  Clock, 
  CheckCircle, 
  Wallet,
  ArrowRight,
  ExternalLink,
  Building2,
  Mail,
  Plus,
  Loader2,
  Copy,
  Check,
  Send,
  AlertCircle
} from 'lucide-react';
import { useSquareBalance, SquarePayment } from '@/hooks/useSquareBalance';
import { useBalance, useWalletClient } from 'wagmi';
import { formatUnits, parseUnits } from 'viem';
import { useToast } from '@/hooks/use-toast';
import { Wallet as EthersWallet, ethers } from 'ethers';

const USDC_ADDRESS = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' as const;
const HUB_WALLET = '0xec80A2cB3652Ec599eFBf7Aac086d07F391A5e55' as const;

export function AdminDashboard() {
  const { data: squareData, isLoading: squareLoading, refetch: refetchSquare } = useSquareBalance();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { toast } = useToast();

  // Wallet creation state
  const [walletEmail, setWalletEmail] = useState('');
  const [walletName, setWalletName] = useState('');
  const [walletAmount, setWalletAmount] = useState('');
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const [createdWallet, setCreatedWallet] = useState<{ address: string; mnemonic?: string } | null>(null);
  const [copiedAddress, setCopiedAddress] = useState(false);

  // USDC Transfer state
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [isTransferring, setIsTransferring] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const { data: walletClient } = useWalletClient();

  // Get USDC balance of hub wallet
  const { data: usdcBalance, isLoading: usdcLoading, refetch: refetchUsdc } = useBalance({
    address: HUB_WALLET,
    token: USDC_ADDRESS,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchSquare(), refetchUsdc()]);
    setIsRefreshing(false);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleCreateWallet = async () => {
    if (!walletEmail) {
      toast({ title: 'Email required', variant: 'destructive' });
      return;
    }

    setIsCreatingWallet(true);
    setCreatedWallet(null);

    try {
      // Generate wallet on frontend using ethers.js
      const wallet = EthersWallet.createRandom();
      const address = wallet.address;
      const mnemonic = wallet.mnemonic?.phrase || '';
      
      if (!mnemonic) {
        throw new Error('Failed to generate mnemonic');
      }

      // Send email via backend
      const response = await fetch('/api/wallet/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: walletEmail,
          name: walletName,
          wallet_address: address,
          mnemonic: mnemonic,
        }),
      });

      const data = await response.json();

      // Always show the created wallet
      setCreatedWallet({
        address: address,
        mnemonic: data.success ? undefined : mnemonic, // Only show mnemonic if email failed
      });

      if (data.success) {
        toast({ title: 'Wallet created!', description: `Details sent to ${walletEmail}` });
        // Clear form
        setWalletEmail('');
        setWalletName('');
        setWalletAmount('');
      } else {
        toast({ 
          title: 'Wallet created (email failed)', 
          description: data.error || 'Save the recovery phrase manually',
          variant: 'destructive'
        });
      }
    } catch (error) {
      toast({ title: 'Error', description: String(error), variant: 'destructive' });
    } finally {
      setIsCreatingWallet(false);
    }
  };

  const copyAddress = async (address: string) => {
    await navigator.clipboard.writeText(address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleUsdcTransfer = async () => {
    if (!transferTo || !transferAmount) {
      toast({ title: 'Enter recipient and amount', variant: 'destructive' });
      return;
    }

    if (!walletClient) {
      toast({ title: 'Connect wallet first', description: 'Connect the hub wallet to send USDC', variant: 'destructive' });
      return;
    }

    // Validate address
    if (!ethers.isAddress(transferTo)) {
      toast({ title: 'Invalid address', variant: 'destructive' });
      return;
    }

    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Invalid amount', variant: 'destructive' });
      return;
    }

    setIsTransferring(true);
    setLastTxHash(null);

    try {
      // USDC has 6 decimals
      const amountInUnits = parseUnits(transferAmount, 6);

      // ERC20 transfer function signature
      const transferData = `0xa9059cbb${transferTo.slice(2).padStart(64, '0')}${amountInUnits.toString(16).padStart(64, '0')}`;

      const hash = await walletClient.sendTransaction({
        to: USDC_ADDRESS,
        data: transferData as `0x${string}`,
        chain: { id: 43114, name: 'Avalanche', nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 }, rpcUrls: { default: { http: ['https://api.avax.network/ext/bc/C/rpc'] } } },
      });

      setLastTxHash(hash);
      toast({ 
        title: 'USDC Transfer Sent!', 
        description: `${amount} USDC to ${transferTo.slice(0, 8)}...` 
      });

      // Clear form
      setTransferTo('');
      setTransferAmount('');
      
      // Refresh balance
      setTimeout(() => refetchUsdc(), 3000);

    } catch (error: unknown) {
      console.error('Transfer error:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast({ title: 'Transfer failed', description: errorMessage, variant: 'destructive' });
    } finally {
      setIsTransferring(false);
    }
  };

  const usdcBalanceFormatted = usdcBalance 
    ? parseFloat(formatUnits(usdcBalance.value, usdcBalance.decimals)).toFixed(2)
    : '0.00';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Stack Admin Dashboard</h2>
          <p className="text-muted-foreground">Monitor deposits and USDC distribution</p>
        </div>
        <Button 
          variant="outline" 
          onClick={handleRefresh} 
          disabled={isRefreshing}
        >
          <RefreshCw className={isRefreshing ? 'h-4 w-4 mr-2 animate-spin' : 'h-4 w-4 mr-2'} />
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* USDC Hub Balance */}
        <Card className="p-6 bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-blue-500/20">
              <Wallet className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">USDC Hub Balance</p>
              <p className="text-2xl font-bold">
                {usdcLoading ? '...' : `$${usdcBalanceFormatted}`}
              </p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground font-mono truncate">
            {HUB_WALLET}
          </div>
          <a 
            href={`https://snowtrace.io/address/${HUB_WALLET}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline flex items-center gap-1 mt-2"
          >
            View on Snowtrace <ExternalLink className="h-3 w-3" />
          </a>
        </Card>

        {/* Square Completed (7d) */}
        <Card className="p-6 bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-green-500/20">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Cleared (7 days)</p>
              <p className="text-2xl font-bold">
                {squareLoading ? '...' : `$${squareData?.payments?.total_completed_7d?.toFixed(2) || '0.00'}`}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {squareData?.payments?.count_completed || 0} completed payments
          </p>
        </Card>

        {/* Square Pending */}
        <Card className="p-6 bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 border-yellow-500/20">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-yellow-500/20">
              <Clock className="h-5 w-5 text-yellow-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold">
                {squareLoading ? '...' : `$${squareData?.payments?.total_pending?.toFixed(2) || '0.00'}`}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {squareData?.payments?.count_pending || 0} pending payments
          </p>
        </Card>
      </div>

      {/* Flow Diagram */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Deposit Flow</h3>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <div className="text-center p-4 bg-muted/50 rounded-lg">
            <DollarSign className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <p className="text-sm font-medium">User Deposit</p>
            <p className="text-xs text-muted-foreground">Stack App</p>
          </div>
          <ArrowRight className="h-6 w-6 text-muted-foreground" />
          <div className="text-center p-4 bg-muted/50 rounded-lg">
            <Building2 className="h-8 w-8 mx-auto mb-2 text-blue-500" />
            <p className="text-sm font-medium">Square Banking</p>
            <p className="text-xs text-muted-foreground">5-15 min clear</p>
          </div>
          <ArrowRight className="h-6 w-6 text-muted-foreground" />
          <div className="text-center p-4 bg-muted/50 rounded-lg">
            <Wallet className="h-8 w-8 mx-auto mb-2 text-purple-500" />
            <p className="text-sm font-medium">USDC Hub</p>
            <p className="text-xs text-muted-foreground font-mono text-[10px]">
              {HUB_WALLET.slice(0, 6)}...{HUB_WALLET.slice(-4)}
            </p>
          </div>
          <ArrowRight className="h-6 w-6 text-muted-foreground" />
          <div className="text-center p-4 bg-muted/50 rounded-lg">
            <Wallet className="h-8 w-8 mx-auto mb-2 text-orange-500" />
            <p className="text-sm font-medium">User Wallet</p>
            <p className="text-xs text-muted-foreground">Trust Wallet</p>
          </div>
        </div>
      </Card>

      {/* Recent Payments */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pending Payments */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-yellow-500" />
            Pending Payments
          </h3>
          {squareLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : squareData?.payments?.pending && squareData.payments.pending.length > 0 ? (
            <div className="space-y-3">
              {squareData.payments.pending.map((payment: SquarePayment) => (
                <div 
                  key={payment.id} 
                  className="flex items-center justify-between p-3 bg-yellow-500/5 rounded-lg border border-yellow-500/20"
                >
                  <div>
                    <p className="font-medium">${payment.amount.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">
                      {payment.card_brand} •••• {payment.last_4}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs px-2 py-1 bg-yellow-500/20 text-yellow-600 rounded">
                      {payment.status}
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(payment.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No pending payments</p>
          )}
        </Card>

        {/* Completed Payments */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Recent Cleared Payments
          </h3>
          {squareLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : squareData?.payments?.completed && squareData.payments.completed.length > 0 ? (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {squareData.payments.completed.map((payment: SquarePayment) => (
                <div 
                  key={payment.id} 
                  className="flex items-center justify-between p-3 bg-green-500/5 rounded-lg border border-green-500/20"
                >
                  <div>
                    <p className="font-medium">${payment.amount.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">
                      {payment.card_brand} •••• {payment.last_4}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs px-2 py-1 bg-green-500/20 text-green-600 rounded">
                      CLEARED
                    </span>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(payment.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No recent payments</p>
          )}
        </Card>
      </div>

      {/* Wallet Creation */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Plus className="h-5 w-5 text-purple-500" />
          Create User Wallet
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div className="space-y-2">
            <Label htmlFor="wallet-email">Email *</Label>
            <Input
              id="wallet-email"
              type="email"
              placeholder="user@example.com"
              value={walletEmail}
              onChange={(e) => setWalletEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wallet-name">Name (optional)</Label>
            <Input
              id="wallet-name"
              type="text"
              placeholder="John Doe"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wallet-amount">Deposit Amount ($)</Label>
            <Input
              id="wallet-amount"
              type="number"
              placeholder="10.00"
              min="10"
              value={walletAmount}
              onChange={(e) => setWalletAmount(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button 
              onClick={handleCreateWallet} 
              disabled={isCreatingWallet || !walletEmail}
              className="w-full"
            >
              {isCreatingWallet ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  Create & Email
                </>
              )}
            </Button>
          </div>
        </div>
        
        {createdWallet && (
          <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm font-medium text-green-600 mb-2">✓ Wallet Created</p>
            <div className="flex items-center gap-2">
              <code className="text-xs bg-background px-2 py-1 rounded flex-1 truncate">
                {createdWallet.address}
              </code>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => copyAddress(createdWallet.address)}
              >
                {copiedAddress ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <a
                href={`https://snowtrace.io/address/${createdWallet.address}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View address on Snowtrace"
              >
                <Button variant="outline" size="sm">
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </a>
            </div>
            {createdWallet.mnemonic && (
              <div className="mt-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded">
                <p className="text-xs font-medium text-yellow-600 mb-1">⚠️ Email failed - Save this recovery phrase:</p>
                <code className="text-xs break-all">{createdWallet.mnemonic}</code>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* USDC Transfer */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Send className="h-5 w-5 text-blue-500" />
          Send USDC to User Wallet
        </h3>
        
        {!walletClient && (
          <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-600" />
            <p className="text-sm text-yellow-600">Connect the hub wallet ({HUB_WALLET.slice(0, 8)}...) to send USDC</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div className="space-y-2 md:col-span-1">
            <Label htmlFor="transfer-to">Recipient Address</Label>
            <Input
              id="transfer-to"
              type="text"
              placeholder="0x..."
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="transfer-amount">Amount (USDC)</Label>
            <Input
              id="transfer-amount"
              type="number"
              placeholder="1.00"
              min="0.01"
              step="0.01"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button 
              onClick={handleUsdcTransfer} 
              disabled={isTransferring || !walletClient || !transferTo || !transferAmount}
              className="w-full"
            >
              {isTransferring ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send USDC
                </>
              )}
            </Button>
          </div>
        </div>

        {lastTxHash && (
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm font-medium text-green-600 mb-1">✓ Transaction Sent</p>
            <a
              href={`https://snowtrace.io/tx/${lastTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline flex items-center gap-1"
            >
              View on Snowtrace <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        <div className="mt-4 text-xs text-muted-foreground">
          <p>Hub Balance: <span className="font-mono">${usdcBalanceFormatted} USDC</span></p>
        </div>
      </Card>

      {/* Square Account Info */}
      {squareData?.location && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Square Account</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Location</p>
              <p className="font-medium">{squareData.location.name}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Currency</p>
              <p className="font-medium">{squareData.location.currency}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Status</p>
              <p className="font-medium">{squareData.location.status}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Environment</p>
              <p className="font-medium capitalize">{squareData.environment}</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
