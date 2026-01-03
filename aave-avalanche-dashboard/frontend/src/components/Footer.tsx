import React from 'react';
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

