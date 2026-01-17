import { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    console.log('[TestERGC] Testing ERGC transfer to:', walletAddress);

    // Configuration
    const HUB_WALLET_PRIVATE_KEY = process.env.HUB_WALLET_PRIVATE_KEY;
    const ERGC_CONTRACT = process.env.ERGC_CONTRACT || '0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B';
    const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
    const ERGC_SEND_TO_USER = ethers.parseUnits('100', 18);

    if (!HUB_WALLET_PRIVATE_KEY) {
      return res.status(500).json({ error: 'HUB_WALLET_PRIVATE_KEY not configured' });
    }

    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    const ergcContract = new ethers.Contract(ERGC_CONTRACT, [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function decimals() view returns (uint8)'
    ], wallet);

    console.log('[TestERGC] Hub wallet address:', wallet.address);
    console.log('[TestERGC] ERGC contract:', ERGC_CONTRACT);

    // Check current balance
    const balance = await ergcContract.balanceOf(wallet.address);
    console.log('[TestERGC] Hub ERGC balance:', ethers.formatUnits(balance, 18));

    if (balance < ERGC_SEND_TO_USER) {
      return res.status(500).json({ 
        error: 'Insufficient ERGC in treasury wallet',
        balance: ethers.formatUnits(balance, 18),
        required: '100'
      });
    }

    // Check network
    const network = await provider.getNetwork();
    console.log('[TestERGC] Network chain ID:', network.chainId.toString());
    
    if (network.chainId !== BigInt(43114)) {
      return res.status(500).json({ 
        error: 'Wrong network',
        actual: network.chainId.toString(),
        expected: '43114'
      });
    }

    // Execute transfer
    console.log('[TestERGC] Executing ERGC transfer...');
    const tx = await ergcContract.transfer(walletAddress, ERGC_SEND_TO_USER);
    console.log('[TestERGC] Transaction submitted:', tx.hash);

    const receipt = await tx.wait(1);
    console.log('[TestERGC] Transaction confirmed:', receipt.hash);

    // Check new balance
    const newBalance = await ergcContract.balanceOf(wallet.address);
    console.log('[TestERGC] New hub ERGC balance:', ethers.formatUnits(newBalance, 18));

    // Check user balance
    const userBalance = await ergcContract.balanceOf(walletAddress);
    console.log('[TestERGC] User ERGC balance:', ethers.formatUnits(userBalance, 18));

    return res.status(200).json({
      success: true,
      message: 'ERGC transfer successful',
      txHash: tx.hash,
      explorerUrl: `https://snowtrace.io/tx/${tx.hash}`,
      hubBalance: ethers.formatUnits(newBalance, 18),
      userBalance: ethers.formatUnits(userBalance, 18)
    });

  } catch (error) {
    console.error('[TestERGC] Transfer failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
