import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';
const ARBITRUM_HUB_WALLET_PRIVATE_KEY = process.env.ARBITRUM_HUB_WALLET_PRIVATE_KEY || process.env.HUB_WALLET_PRIVATE_KEY || '';

// Amount of ETH to send for gas (0.001 ETH = ~$2-3, enough for multiple transactions)
const ETH_GAS_AMOUNT = ethers.parseEther('0.001');

async function getRedis(): Promise<Redis> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    throw new Error('Redis credentials not configured');
  }
  
  return new Redis({ url, token });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Initialize Redis for rate limiting
    const redis = await getRedis();
    const ratelimit = new Ratelimit({
      redis: redis as any,
      limiter: Ratelimit.slidingWindow(3, '60 s'), // 3 requests per minute
    });

    const { walletAddress } = req.body as { walletAddress: string };

    if (!walletAddress || !ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Rate limiting
    const identifier = `morpho-eth-gas:${walletAddress.toLowerCase()}`;
    const { success: rateLimitSuccess } = await ratelimit.limit(identifier);
    
    if (!rateLimitSuccess) {
      return res.status(429).json({ 
        error: 'Too many requests. Please wait a moment before requesting more ETH.' 
      });
    }

    // Validate hub wallet
    if (!ARBITRUM_HUB_WALLET_PRIVATE_KEY) {
      console.error('[MorphoEthGas] Hub wallet private key not configured');
      return res.status(500).json({ error: 'Service configuration error' });
    }

    const provider = new ethers.JsonRpcProvider(ARBITRUM_RPC);
    const hubWallet = new ethers.Wallet(ARBITRUM_HUB_WALLET_PRIVATE_KEY, provider);
    const normalizedAddress = ethers.getAddress(walletAddress);

    console.log('[MorphoEthGas] Sending ETH for gas to:', normalizedAddress);

    // Check hub wallet ETH balance
    const hubBalance = await provider.getBalance(hubWallet.address);
    console.log('[MorphoEthGas] Hub ETH balance:', ethers.formatEther(hubBalance));

    if (hubBalance < ETH_GAS_AMOUNT) {
      console.error('[MorphoEthGas] Insufficient ETH in hub wallet');
      return res.status(503).json({ 
        error: 'Insufficient ETH in service wallet. Please contact support.' 
      });
    }

    // Check user's current balance
    const userBalance = await provider.getBalance(normalizedAddress);
    console.log('[MorphoEthGas] User ETH balance:', ethers.formatEther(userBalance));

    // Check if user already has enough ETH (more than 0.0005 ETH)
    const minimumRequired = ethers.parseEther('0.0005');
    if (userBalance >= minimumRequired) {
      return res.status(200).json({
        success: true,
        message: 'You already have sufficient ETH for gas',
        currentBalance: ethers.formatEther(userBalance),
        txHash: null,
      });
    }

    // Send ETH
    const gasPrice = await provider.getFeeData();
    const tx = await hubWallet.sendTransaction({
      to: normalizedAddress,
      value: ETH_GAS_AMOUNT,
      gasPrice: gasPrice.gasPrice,
    });

    console.log('[MorphoEthGas] Transaction submitted:', tx.hash);
    
    // Wait for 1 confirmation
    const receipt = await tx.wait(1);

    if (!receipt || receipt.status !== 1) {
      console.error('[MorphoEthGas] Transaction failed:', tx.hash);
      return res.status(500).json({ error: 'Transaction failed on-chain' });
    }

    console.log('[MorphoEthGas] ✅ ETH sent successfully:', tx.hash);

    return res.status(200).json({
      success: true,
      message: 'ETH sent successfully for gas fees',
      amount: ethers.formatEther(ETH_GAS_AMOUNT),
      txHash: tx.hash,
      explorerUrl: `https://arbiscan.io/tx/${tx.hash}`,
    });
  } catch (error) {
    console.error('[MorphoEthGas] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
}
