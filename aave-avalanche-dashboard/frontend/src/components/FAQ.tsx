import React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

interface FAQItem {
  question: string;
  answer: React.ReactNode;
}

const faqData: FAQItem[] = [
  {
    question: 'What is TiltVault?',
    answer: (
      <div className="space-y-2">
        <p>
          TiltVault is a non-custodial decentralized finance (DeFi) protocol aggregator that provides a user interface for interacting with established, audited blockchain protocols on the Avalanche network.
        </p>
        <p>
          <strong>Architecture Type:</strong> Non-custodial protocol interface (similar to InstaDapp, Zapper, DeFi Saver)
        </p>
        <p>
          We are <strong>NOT</strong> a financial institution. We are a non-custodial software interface:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-4">
          <li>No custody of user funds</li>
          <li>No deposits in traditional banking sense</li>
          <li>Users control their own private keys</li>
          <li>Smart contracts, not accounts</li>
        </ul>
      </div>
    ),
  },
  {
    question: 'Which protocols does TiltVault integrate with?',
    answer: (
      <div className="space-y-3">
        <div>
          <h4 className="font-semibold mb-1">A. Aave Protocol (aave.com)</h4>
          <ul className="list-disc list-inside space-y-1 ml-4 text-sm">
            <li><strong>Purpose:</strong> Decentralized lending and borrowing</li>
            <li><strong>Total Value Locked (TVL):</strong> $10+ billion across all chains</li>
            <li><strong>Avalanche Contract:</strong> <a href="https://snowtrace.io/address/0x794a61358D6845594F94dc1DB02A252b5b4814aD" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">0x794a61358D6845594F94dc1DB02A252b5b4814aD</a></li>
            <li><strong>Audits:</strong> Trail of Bits, OpenZeppelin, ConsenSys Diligence, PeckShield</li>
            <li><strong>Documentation:</strong> <a href="https://docs.aave.com" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">docs.aave.com</a></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-1">B. GMX Protocol (gmx.io)</h4>
          <ul className="list-disc list-inside space-y-1 ml-4 text-sm">
            <li><strong>Purpose:</strong> Decentralized perpetual futures trading</li>
            <li><strong>Total Value Locked (TVL):</strong> $500+ million</li>
            <li><strong>Avalanche Contract:</strong> <a href="https://snowtrace.io/address/0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2</a></li>
            <li><strong>Audits:</strong> ABDK Consulting, Code4rena security reviews</li>
            <li><strong>Documentation:</strong> <a href="https://docs.gmx.io" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">docs.gmx.io</a></li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    question: 'How does payment processing work?',
    answer: (
      <div className="space-y-2">
        <p>
          <strong>Square Payment Integration</strong>
        </p>
        <ul className="list-disc list-inside space-y-1 ml-4">
          <li><strong>Processor:</strong> Square, Inc. (NYSE: SQ) - publicly traded fintech company</li>
          <li><strong>Purpose:</strong> Fiat-to-crypto on-ramp (USD → USDC stablecoin)</li>
          <li><strong>Merchant Status:</strong> Verified Square merchant account</li>
          <li><strong>Compliance:</strong> Square performs merchant verification and KYC</li>
        </ul>
        <div className="mt-3">
          <p className="font-semibold mb-1">User Payment Flow:</p>
          <ol className="list-decimal list-inside space-y-1 ml-4">
            <li>User pays via debit card (Square API)</li>
            <li>System generates non-custodial wallet OR user connects MetaMask</li>
            <li>USDC transferred to user's wallet address</li>
            <li>User's wallet interacts with Aave Protocol (lending/yield) or GMX Protocol (leveraged trading)</li>
          </ol>
        </div>
      </div>
    ),
  },
  {
    question: 'Is TiltVault non-custodial?',
    answer: (
      <div className="space-y-2">
        <p>
          <strong>Yes, TiltVault is completely non-custodial.</strong>
        </p>
        <p>
          Users maintain control of private keys and funds at all times. We are a software interface, not a custodian.
        </p>
        <p className="font-semibold mt-3">Key Distinction:</p>
        <p>
          We are a non-custodial interface. Users maintain control of private keys and funds at all times. This is equivalent to being a web browser for DeFi protocols.
        </p>
      </div>
    ),
  },
  {
    question: 'How can I verify transactions on-chain?',
    answer: (
      <div className="space-y-2">
        <p>
          All transactions are publicly visible and verifiable on-chain.
        </p>
        <div>
          <p className="font-semibold mb-1">Our Treasury Wallet (Publicly Verifiable):</p>
          <ul className="list-disc list-inside space-y-1 ml-4">
            <li><strong>Address:</strong> <a href="https://snowtrace.io/address/0xec80A2cB3652Ec599eFBf7Aac086d07F391A5e55" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">0xec80A2cB3652Ec599eFBf7Aac086d07F391A5e55</a></li>
            <li><strong>Network:</strong> Avalanche C-Chain (Chain ID: 43114)</li>
            <li><strong>Explorer:</strong> <a href="https://snowtrace.io" target="_blank" rel="noopener noreferrer" className="text-emerald-500 hover:underline">snowtrace.io</a></li>
          </ul>
        </div>
        <div className="mt-3">
          <p className="font-semibold mb-1">Smart Contract Addresses:</p>
          <ul className="list-disc list-inside space-y-1 ml-4 text-sm">
            <li><strong>USDC Token:</strong> 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E</li>
            <li><strong>Aave Pool:</strong> 0x794a61358D6845594F94dc1DB02A252b5b4814aD</li>
            <li><strong>GMX Router:</strong> 0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    question: 'What are the risks?',
    answer: (
      <div className="space-y-2">
        <p>
          <strong>Important Risk Disclosures:</strong>
        </p>
        <ul className="list-disc list-inside space-y-1 ml-4">
          <li>Cryptocurrency risks</li>
          <li>Smart contract risks</li>
          <li>No FDIC insurance</li>
          <li>No investment guarantees</li>
          <li>Automated leverage trading can result in total loss of capital</li>
          <li>Not investment advice</li>
        </ul>
        <p className="mt-3">
          Users maintain full control and responsibility for their funds and transactions.
        </p>
      </div>
    ),
  },
  {
    question: 'Is TiltVault similar to other DeFi platforms?',
    answer: (
      <div className="space-y-2">
        <p>
          TiltVault operates identically to these established, legitimate platforms:
        </p>
        <ul className="list-disc list-inside space-y-2 ml-4">
          <li>
            <strong>InstaDapp (instadapp.io)</strong> - DeFi protocol aggregator, integrates Aave, Compound, Maker, $1B+ in managed assets
          </li>
          <li>
            <strong>Zapper (zapper.xyz)</strong> - DeFi dashboard and aggregator, backed by Coinbase Ventures, millions of users
          </li>
          <li>
            <strong>DeFi Saver (defisaver.com)</strong> - Automated DeFi management, integrates multiple protocols, established since 2019
          </li>
          <li>
            <strong>1inch (1inch.io)</strong> - DeFi aggregator, $100B+ in trading volume, VC-backed, legitimate
          </li>
        </ul>
        <p className="mt-3">
          All of these services do exactly what TiltVault does: provide interfaces to interact with blockchain protocols.
        </p>
      </div>
    ),
  },
  {
    question: 'What technology does TiltVault use?',
    answer: (
      <div className="space-y-3">
        <div>
          <p className="font-semibold mb-1">Frontend:</p>
          <ul className="list-disc list-inside space-y-1 ml-4 text-sm">
            <li><strong>Hosting:</strong> Vercel (vercel.com)</li>
            <li><strong>DNS:</strong> Cloudflare</li>
            <li><strong>Framework:</strong> React/TypeScript</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold mb-1">Blockchain Integration:</p>
          <ul className="list-disc list-inside space-y-1 ml-4 text-sm">
            <li><strong>Web3 Libraries:</strong> ethers.js v6, viem</li>
            <li><strong>RPC Provider:</strong> Avalanche public RPC</li>
            <li><strong>Wallet Connection:</strong> WalletConnect, MetaMask, Privy</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold mb-1">Backend:</p>
          <ul className="list-disc list-inside space-y-1 ml-4 text-sm">
            <li><strong>Backend API:</strong> Vercel serverless functions (Node.js)</li>
            <li><strong>Webhook Processing:</strong> Square payment webhooks → blockchain execution</li>
          </ul>
        </div>
      </div>
    ),
  },
  {
    question: 'How is TiltVault different from phishing sites?',
    answer: (
      <div className="space-y-2">
        <p className="font-semibold mb-2">How We DIFFER from phishing sites:</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4">Phishing Sites</th>
                <th className="text-left py-2">TiltVault</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b">
                <td className="py-2 pr-4">Steal credentials</td>
                <td className="py-2">No credentials collected</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Fake services</td>
                <td className="py-2">Real blockchain protocols</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Drain wallets</td>
                <td className="py-2">Non-custodial (users control keys)</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">No real functionality</td>
                <td className="py-2">Verifiable on-chain transactions</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 pr-4">Hidden operators</td>
                <td className="py-2">Public documentation, verifiable contracts</td>
              </tr>
              <tr>
                <td className="py-2 pr-4">Untraceable</td>
                <td className="py-2">All transactions on public blockchain</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-semibold">Public Transparency:</p>
        <ul className="list-disc list-inside space-y-1 ml-4 text-sm">
          <li>Smart contract addresses published</li>
          <li>Transaction hashes verifiable</li>
          <li>Open-source blockchain interactions</li>
          <li>Public wallet addresses</li>
        </ul>
      </div>
    ),
  },
  {
    question: 'What regulatory compliance does TiltVault follow?',
    answer: (
      <div className="space-y-2">
        <p>
          <strong>Non-Custodial Status:</strong>
        </p>
        <p>
          We are <strong>NOT</strong> required to be:
        </p>
        <ul className="list-disc list-inside space-y-1 ml-4">
          <li>Licensed as a money transmitter (no custody)</li>
          <li>Registered as a broker-dealer (no investment advice)</li>
          <li>Licensed as a bank (no deposits)</li>
        </ul>
        <p className="mt-3">
          <strong>Legal Precedent:</strong> Non-custodial software is considered a tool, not a financial service provider (see: Uniswap, MetaMask, TrustWallet precedents).
        </p>
        <p className="mt-3">
          We provide clear risk disclosures including cryptocurrency risks, smart contract risks, no FDIC insurance, and no investment guarantees.
        </p>
      </div>
    ),
  },
];

export function FAQ() {
  return (
    <div className="w-full max-w-4xl mx-auto">
      <h3 className="text-lg font-semibold mb-4 text-center">Frequently Asked Questions</h3>
      <Accordion type="single" collapsible className="w-full">
        {faqData.map((item, index) => (
          <AccordionItem key={index} value={`item-${index}`}>
            <AccordionTrigger className="text-left text-sm sm:text-base">
              {item.question}
            </AccordionTrigger>
            <AccordionContent className="text-sm text-muted-foreground">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

