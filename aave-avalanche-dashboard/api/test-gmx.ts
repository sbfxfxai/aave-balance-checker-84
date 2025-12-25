import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { avalanche } from 'viem/chains';
import { GmxSdk } from '@gmx-io/sdk';

const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const GMX_ROUTER = '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'GET') {
    return res.status(200).json({ 
      status: 'ready',
      message: 'POST with { privateKey, collateralUsd, leverage } to test GMX',
    });
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { privateKey, collateralUsd = 5, leverage = 2.5 } = req.body;
  
  if (!privateKey) {
    return res.status(400).json({ error: 'privateKey required' });
  }
  
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };
  
  try {
    log('[GMX Test] Starting...');
    log(`[GMX Test] Collateral: $${collateralUsd}, Leverage: ${leverage}x`);
    
    // Create viem clients
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    log(`[GMX Test] Wallet: ${account.address}`);
    
    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });
    
    const walletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });
    
    // Check balances
    const avaxBalance = await publicClient.getBalance({ address: account.address });
    log(`[GMX Test] AVAX balance: ${formatUnits(avaxBalance, 18)}`);
    
    const usdcBalance = await publicClient.readContract({
      address: USDC_CONTRACT as `0x${string}`,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [account.address],
    }) as bigint;
    log(`[GMX Test] USDC balance: ${formatUnits(usdcBalance, 6)}`);
    
    if (avaxBalance < parseUnits('0.02', 18)) {
      return res.status(400).json({ error: 'Insufficient AVAX for execution fee', logs });
    }
    
    if (usdcBalance < parseUnits(collateralUsd.toString(), 6)) {
      return res.status(400).json({ error: 'Insufficient USDC for collateral', logs });
    }
    
    // Fetch GMX market data
    log('[GMX Test] Fetching market data...');
    const [tokensRes, marketsRes] = await Promise.all([
      fetch('https://avalanche-api.gmxinfra.io/tokens'),
      fetch('https://avalanche-api.gmxinfra.io/markets'),
    ]);
    
    const tokensJson = await tokensRes.json() as { tokens: Array<{ symbol: string; address: string; decimals: number }> };
    const marketsJson = await marketsRes.json() as { markets: Array<{ isListed: boolean; indexToken: string; shortToken: string; marketToken: string }> };
    
    const btcToken = tokensJson.tokens.find(t => t.symbol === 'BTC');
    const usdcToken = tokensJson.tokens.find(t => t.symbol === 'USDC');
    
    if (!btcToken || !usdcToken) {
      return res.status(500).json({ error: 'Token not found', logs });
    }
    
    const btcUsdcMarket = marketsJson.markets.find(
      m => m.isListed && 
           m.indexToken.toLowerCase() === btcToken.address.toLowerCase() &&
           m.shortToken.toLowerCase() === usdcToken.address.toLowerCase()
    );
    
    if (!btcUsdcMarket) {
      return res.status(500).json({ error: 'Market not found', logs });
    }
    
    log(`[GMX Test] Market: ${btcUsdcMarket.marketToken}`);
    
    // Approve USDC
    const usdcAmount = parseUnits(collateralUsd.toString(), 6);
    const router = GMX_ROUTER as `0x${string}`;
    
    const allowance = await publicClient.readContract({
      address: USDC_CONTRACT as `0x${string}`,
      abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'allowance',
      args: [account.address, router],
    }) as bigint;
    
    log(`[GMX Test] Router allowance: ${formatUnits(allowance, 6)}`);
    
    if (allowance < usdcAmount) {
      log('[GMX Test] Approving USDC...');
      const approveTxHash = await walletClient.writeContract({
        address: USDC_CONTRACT as `0x${string}`,
        abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
        functionName: 'approve',
        args: [router, maxUint256],
      });
      log(`[GMX Test] Approval tx: ${approveTxHash}`);
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      log('[GMX Test] Approval confirmed');
    }
    
    // Initialize GMX SDK
    log('[GMX Test] Initializing SDK...');
    const sdk = new GmxSdk({
      chainId: 43114,
      rpcUrl: AVALANCHE_RPC,
      oracleUrl: 'https://avalanche-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
      walletClient: walletClient as any,
    });
    
    sdk.setAccount(account.address);
    log('[GMX Test] SDK initialized');
    
    // Track tx hash
    let submittedHash: `0x${string}` | null = null;
    
    // Override callContract
    const originalCallContract = sdk.callContract.bind(sdk);
    sdk.callContract = (async (
      contractAddress: `0x${string}`,
      abi: any,
      method: string,
      params: unknown[],
      opts?: { value?: bigint }
    ) => {
      log(`[GMX SDK] ${method} on ${contractAddress}`);
      
      if (method === 'multicall' && Array.isArray(params) && Array.isArray(params[0])) {
        const dataItems = params[0] as string[];
        let totalWntAmount = 0n;
        
        dataItems.forEach((data) => {
          if (typeof data === 'string' && data.toLowerCase().startsWith('0x7d39aaf1')) {
            if (data.length >= 138) {
              const amountHex = data.slice(74, 138);
              totalWntAmount += BigInt(`0x${amountHex}`);
            }
          }
        });
        
        if (totalWntAmount > 0n) {
          opts = { ...opts, value: (opts?.value || 0n) + totalWntAmount };
          log(`[GMX SDK] Execution fee: ${formatUnits(totalWntAmount, 18)} AVAX`);
        }
      }
      
      const h = await originalCallContract(contractAddress, abi, method, params, opts) as `0x${string}`;
      submittedHash = h;
      log(`[GMX SDK] Tx submitted: ${h}`);
      return h;
    }) as typeof sdk.callContract;
    
    // Execute order
    const leverageBps = BigInt(Math.floor(leverage * 10000));
    log(`[GMX Test] Submitting order: ${usdcAmount} USDC, ${leverageBps} bps leverage`);
    
    await sdk.orders.long({
      payAmount: usdcAmount,
      marketAddress: btcUsdcMarket.marketToken as `0x${string}`,
      payTokenAddress: usdcToken.address as `0x${string}`,
      collateralTokenAddress: usdcToken.address as `0x${string}`,
      allowedSlippageBps: 100,
      leverage: leverageBps,
      skipSimulation: true,
    });
    
    if (!submittedHash) {
      return res.status(500).json({ error: 'No tx hash captured', logs });
    }
    
    log(`[GMX Test] Waiting for confirmation...`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
    
    if (receipt.status !== 'success') {
      return res.status(500).json({ error: 'Transaction reverted', txHash: submittedHash, logs });
    }
    
    log(`[GMX Test] SUCCESS! Tx: ${submittedHash}`);
    
    return res.status(200).json({
      success: true,
      txHash: submittedHash,
      logs,
    });
    
  } catch (error) {
    log(`[GMX Test] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return res.status(500).json({
      error: error instanceof Error ? error.message : String(error),
      logs,
    });
  }
}
