import { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the connected user's wallet address from the request
    const { walletAddress } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'walletAddress is required' });
    }

    if (!ethers.isAddress(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }

    console.log('[TestTransfer] 🚀 Testing ERGC transfer from hub to user:', walletAddress);

    // Configuration
    const HUB_WALLET_PRIVATE_KEY = process.env.HUB_WALLET_PRIVATE_KEY;
    const ERGC_CONTRACT = process.env.ERGC_CONTRACT || '0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B';
    const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
    const ERGC_SEND_TO_USER = ethers.parseUnits('100', 18);

    if (!HUB_WALLET_PRIVATE_KEY) {
      return res.status(500).json({ error: 'HUB_WALLET_PRIVATE_KEY not configured in environment' });
    }

    console.log('[TestTransfer] 📡 Connecting to Avalanche network...');
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    const ergcContract = new ethers.Contract(ERGC_CONTRACT, [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function decimals() view returns (uint8)'
    ], wallet);

    console.log('[TestTransfer] 📍 Hub wallet address:', wallet.address);
    console.log('[TestTransfer] 📍 ERGC contract address:', ERGC_CONTRACT);
    console.log('[TestTransfer] 📍 Recipient address:', walletAddress);

    // Check initial balances
    console.log('[TestTransfer] 💰 Checking initial balances...');
    const hubBalanceBefore = await ergcContract.balanceOf(wallet.address);
    const userBalanceBefore = await ergcContract.balanceOf(walletAddress);
    
    console.log('[TestTransfer] 💰 Hub ERGC balance before:', ethers.formatUnits(hubBalanceBefore, 18));
    console.log('[TestTransfer] 💰 User ERGC balance before:', ethers.formatUnits(userBalanceBefore, 18));

    if (hubBalanceBefore < ERGC_SEND_TO_USER) {
      return res.status(500).json({ 
        error: 'Insufficient ERGC in hub wallet',
        hubBalance: ethers.formatUnits(hubBalanceBefore, 18),
        required: '100'
      });
    }

    // Check network
    console.log('[TestTransfer] 🔍 Validating Avalanche network...');
    const network = await provider.getNetwork();
    console.log('[TestTransfer] 🔍 Network chain ID:', network.chainId.toString());
    
    if (network.chainId !== BigInt(43114)) {
      return res.status(500).json({ 
        error: 'Wrong network - expected Avalanche C-Chain (43114)',
        actual: network.chainId.toString(),
        expected: '43114'
      });
    }

    // Execute the transfer
    console.log('[TestTransfer] 📤 Executing 100 ERGC transfer...');
    const tx = await ergcContract.transfer(walletAddress, ERGC_SEND_TO_USER, {
      gasLimit: 100000, // Set a reasonable gas limit
    });
    
    console.log('[TestTransfer] 📤 Transaction submitted:', tx.hash);
    console.log('[TestTransfer] 🔗 Explorer link: https://snowtrace.io/tx/' + tx.hash);

    // Wait for confirmation
    console.log('[TestTransfer] ⏳ Waiting for transaction confirmation...');
    const receipt = await tx.wait(1); // Wait for 1 confirmation
    
    if (!receipt || receipt.status === 0) {
      return res.status(500).json({
        error: 'Transaction failed (reverted)',
        txHash: tx.hash,
        explorerUrl: `https://snowtrace.io/tx/${tx.hash}`
      });
    }

    console.log('[TestTransfer] ✅ Transaction confirmed!');

    // Check final balances
    console.log('[TestTransfer] 💰 Checking final balances...');
    const hubBalanceAfter = await ergcContract.balanceOf(wallet.address);
    const userBalanceAfter = await ergcContract.balanceOf(walletAddress);
    
    console.log('[TestTransfer] 💰 Hub ERGC balance after:', ethers.formatUnits(hubBalanceAfter, 18));
    console.log('[TestTransfer] 💰 User ERGC balance after:', ethers.formatUnits(userBalanceAfter, 18));

    // Calculate the actual transfer amount
    const userReceived = ethers.formatUnits(userBalanceAfter - userBalanceBefore, 18);
    const hubSent = ethers.formatUnits(hubBalanceBefore - hubBalanceAfter, 18);

    console.log('[TestTransfer] 📊 Transfer summary:');
    console.log('[TestTransfer] 📊 - Hub sent:', hubSent, 'ERGC');
    console.log('[TestTransfer] 📊 - User received:', userReceived, 'ERGC');
    console.log('[TestTransfer] 📊 - Expected: 100 ERGC');

    return res.status(200).json({
      success: true,
      message: 'ERGC transfer completed successfully!',
      transferDetails: {
        from: wallet.address,
        to: walletAddress,
        amount: '100 ERGC',
        txHash: tx.hash,
        explorerUrl: `https://snowtrace.io/tx/${tx.hash}`,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber.toString(),
        balances: {
          hub: {
            before: ethers.formatUnits(hubBalanceBefore, 18),
            after: ethers.formatUnits(hubBalanceAfter, 18),
            sent: hubSent
          },
          user: {
            before: ethers.formatUnits(userBalanceBefore, 18),
            after: ethers.formatUnits(userBalanceAfter, 18),
            received: userReceived
          }
        }
      }
    });

  } catch (error) {
    console.error('[TestTransfer] ❌ Transfer failed:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}
