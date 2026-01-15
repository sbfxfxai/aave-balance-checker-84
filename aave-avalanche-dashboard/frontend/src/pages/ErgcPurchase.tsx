import React, { useState, useEffect } from 'react';
import { ErgcPurchaseModal } from '@/components/ErgcPurchaseModal';
import { Navigation } from '@/components/Navigation';
import { Footer } from '@/components/Footer';
import { Zap, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function ErgcPurchase() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 mb-6">
              <Zap className="h-8 w-8 text-purple-500" />
            </div>
            <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Get ERGC Tokens
            </h1>
            <p className="text-xl text-muted-foreground mb-8">
              Unlock free transfers on TiltVault with 100+ ERGC
            </p>
          </div>

          {/* Purchase Options */}
          <div className="grid md:grid-cols-2 gap-6 mb-12">
            {/* Direct Purchase */}
            <Card className="card-gradient border-border">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-500/20 text-green-500">
                    RECOMMENDED
                  </span>
                  <span className="text-xs text-muted-foreground">Easy</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Buy Direct from TiltVault</h3>
                <div className="mb-4">
                  <div className="text-3xl font-bold text-purple-400 mb-1">$1.00</div>
                  <div className="text-sm text-muted-foreground">for 100 ERGC (fixed price)</div>
                </div>
                <ul className="space-y-2 mb-6 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Instant delivery to your wallet</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>No price uncertainty</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>No gas fees or slippage</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Perfect for beginners</span>
                  </li>
                </ul>
                <Button
                  onClick={() => setIsModalOpen(true)}
                  className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
                  size="lg"
                >
                  Buy 100 ERGC for $1
                </Button>
              </CardContent>
            </Card>

            {/* DEX Purchase */}
            <Card className="border-border">
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-2 py-1 text-xs font-semibold rounded-full bg-orange-500/20 text-orange-500">
                    ADVANCED
                  </span>
                  <span className="text-xs text-muted-foreground">Traders</span>
                </div>
                <h3 className="text-xl font-semibold mb-2">Buy on Exchange (DEX)</h3>
                <div className="mb-4">
                  <div className="text-3xl font-bold text-orange-400 mb-1">Variable</div>
                  <div className="text-sm text-muted-foreground">Market price (potential savings or profit)</div>
                </div>
                <ul className="space-y-2 mb-6 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Could buy for less than $1</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span>Token could appreciate in value</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-orange-500">⚠</span>
                    <span>Requires crypto wallet knowledge</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-orange-500">⚠</span>
                    <span>Gas fees on Avalanche</span>
                  </li>
                </ul>
                <a
                  href="https://app.uniswap.org/explore/pools/avalanche/0x3c83d0058e9d1652534be264dba75cfcc2e1d48a3ff1d2c3611a194a361a16ee"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <Button
                    variant="outline"
                    className="w-full border-orange-500/30 text-orange-500 hover:bg-orange-500/10"
                    size="lg"
                  >
                    Trade on Trader Joe
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </a>
              </CardContent>
            </Card>
          </div>

          {/* Benefits Section */}
          <Card className="card-gradient border-border mb-12">
            <CardContent className="p-6">
              <h3 className="text-xl font-semibold mb-4">Why Hold 100+ ERGC?</h3>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  <strong className="text-foreground">Free Transfers:</strong> Holding 100+ ERGC makes deposits over $100 <strong className="text-green-400">completely FREE</strong> - no platform fees!
                </p>
                <p>
                  This creates a strong incentive to buy and hold ERGC tokens. You can purchase ERGC directly from TiltVault for a fixed price, or trade on decentralized exchanges if you prefer.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      <Footer />

      {/* Purchase Modal */}
      <ErgcPurchaseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

