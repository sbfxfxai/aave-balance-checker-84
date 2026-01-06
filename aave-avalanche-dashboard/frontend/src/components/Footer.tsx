import React from 'react';
import { Zap, ExternalLink } from 'lucide-react';
import { FAQ } from './FAQ';

export function Footer() {
  return (
    <footer className="border-t border-border/50 mt-16 bg-background/50">
      <div className="container mx-auto px-4 py-6">
        {/* FAQ Section */}
        <div className="mb-8">
          <FAQ />
        </div>

        {/* Footer Content */}
        <div className="border-t border-border/30 pt-6 space-y-3">
          {/* ERGC Link - Always Visible */}
          <div className="flex justify-center mb-4">
            <a
              href="https://app.uniswap.org/explore/pools/avalanche/0x3c83d0058e9d1652534be264dba75cfcc2e1d48a3ff1d2c3611a194a361a16ee"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 hover:border-purple-500/50 hover:bg-purple-500/20 transition-colors text-sm font-medium text-purple-400 hover:text-purple-300"
            >
              <Zap className="h-4 w-4" />
              <span>Get ERGC on Uniswap (AVAX → ERGC)</span>
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
          <div className="text-center mb-2">
            <p className="text-xs text-purple-400/80">
              <span className="font-medium">Fee Discount:</span> Holding 100+ ERGC = <span className="font-bold text-purple-300">56% discount</span> on TiltVault platform fees
            </p>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            TiltVault bridges traditional banking convenience with DeFi opportunities
          </p>
          <p className="text-center text-xs text-muted-foreground">
            High-yield savings via Aave • 2.5x leveraged Bitcoin positions • Simple, secure, designed for US users
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Powered by Aave V3 • GMX • Avalanche C-Chain
          </p>
          <p className="text-center text-xs text-muted-foreground">
            ⚠️ This product involves risk. Automated leverage trading can result in total loss of capital. Not investment advice.
          </p>
          <p className="text-center text-xs sm:text-sm text-muted-foreground">
            Support: <a href="mailto:support@tiltvault.com" className="text-emerald-500 hover:underline">support@tiltvault.com</a>
          </p>
        </div>
      </div>
    </footer>
  );
}

