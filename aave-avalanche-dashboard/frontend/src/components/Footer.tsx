import React from 'react';
import { Zap, ExternalLink, KeyRound } from 'lucide-react';
import { FAQ } from './FAQ';

export function Footer() {
  return (
    <footer className="border-t border-border/50 mt-16 bg-background/50">
      <div className="container mx-auto px-4 py-6">
        {/* FAQ Section */}
        <div id="faq" className="mb-8">
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
          {/* Powered By Section with Logos */}
          <div className="flex flex-col items-center gap-3 pt-4 border-t border-border/30">
            <p className="text-xs text-muted-foreground mb-3">Powered by</p>
            <div className="flex flex-wrap items-center justify-center gap-3 md:gap-4">
              {/* Square */}
              <a
                href="https://squareup.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-10 px-4 rounded-lg bg-white hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
                title="Square - Payment Processing"
              >
                <img
                  src="/square-logo.png"
                  alt="Square"
                  className="h-5 w-auto max-w-[60px] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent && !parent.querySelector('.fallback-text')) {
                      const fallback = document.createElement('span');
                      fallback.className = 'fallback-text text-xs font-semibold text-gray-800';
                      fallback.textContent = 'Square';
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </a>
              
              {/* Aave */}
              <a
                href="https://aave.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-10 px-4 rounded-lg bg-white hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
                title="Aave - DeFi Lending"
              >
                <img
                  src="/aave-logo.png"
                  alt="Aave"
                  className="h-5 w-auto max-w-[60px] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent && !parent.querySelector('.fallback-text')) {
                      const fallback = document.createElement('span');
                      fallback.className = 'fallback-text text-xs font-semibold text-gray-800';
                      fallback.textContent = 'Aave';
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </a>
              
              {/* GMX */}
              <a
                href="https://gmx.io"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-10 px-4 rounded-lg bg-white hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
                title="GMX - Decentralized Trading"
              >
                <img
                  src="/gmx-logo.jpg"
                  alt="GMX"
                  className="h-5 w-auto max-w-[60px] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent && !parent.querySelector('.fallback-text')) {
                      const fallback = document.createElement('span');
                      fallback.className = 'fallback-text text-xs font-semibold text-gray-800';
                      fallback.textContent = 'GMX';
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </a>
              
              {/* Avalanche */}
              <a
                href="https://avax.network"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-10 px-4 rounded-lg bg-white hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
                title="Avalanche - Blockchain Network"
              >
                <img
                  src="/avalanche-logo.png"
                  alt="Avalanche"
                  className="h-5 w-auto max-w-[60px] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent && !parent.querySelector('.fallback-text')) {
                      const fallback = document.createElement('span');
                      fallback.className = 'fallback-text text-xs font-semibold text-gray-800';
                      fallback.textContent = 'Avalanche';
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </a>
              
              {/* Privy */}
              <a
                href="https://privy.io"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-10 px-4 rounded-lg bg-white hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
                title="Privy - Wallet Infrastructure"
              >
                <img
                  src="/privy-logo.png"
                  alt="Privy"
                  className="h-5 w-auto max-w-[60px] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent && !parent.querySelector('.fallback-text')) {
                      const fallback = document.createElement('span');
                      fallback.className = 'fallback-text text-xs font-semibold text-gray-800';
                      fallback.textContent = 'Privy';
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </a>
              
              {/* Trader Joe */}
              <a
                href="https://traderjoexyz.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-10 px-4 rounded-lg bg-white hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
                title="Trader Joe - DEX"
              >
                <img
                  src="/trader-joe-logo.png"
                  alt="Trader Joe"
                  className="h-5 w-auto max-w-[60px] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent && !parent.querySelector('.fallback-text')) {
                      const fallback = document.createElement('span');
                      fallback.className = 'fallback-text text-xs font-semibold text-gray-800';
                      fallback.textContent = 'Trader Joe';
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </a>
              
              {/* CoinGecko */}
              <a
                href="https://coingecko.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center h-10 px-4 rounded-lg bg-white hover:bg-gray-50 transition-colors shadow-sm border border-gray-200"
                title="CoinGecko - Price Data"
              >
                <img
                  src="/coingecko-logo.png"
                  alt="CoinGecko"
                  className="h-5 w-auto max-w-[60px] object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const parent = e.currentTarget.parentElement;
                    if (parent && !parent.querySelector('.fallback-text')) {
                      const fallback = document.createElement('span');
                      fallback.className = 'fallback-text text-xs font-semibold text-gray-800';
                      fallback.textContent = 'CoinGecko';
                      parent.appendChild(fallback);
                    }
                  }}
                />
              </a>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            ⚠️ This product involves risk. Automated leverage trading can result in total loss of capital. Not investment advice.
          </p>
          <p className="text-center text-xs sm:text-sm text-muted-foreground">
            Support: <a href="mailto:support@tiltvault.com" className="text-emerald-500 hover:underline">support@tiltvault.com</a>
          </p>
          
          {/* Account Recovery Link */}
          <div className="flex justify-center pt-2">
            <a
              href="https://dashboard.privy.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-emerald-500 transition-colors"
              title="Access your Privy account recovery, export keys, and troubleshoot wallet issues"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Account Recovery & Wallet Keys</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

