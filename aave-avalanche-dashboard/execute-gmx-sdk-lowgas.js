// Execute GMX trade using SDK with 1.01 gwei max gas
const { createWalletClient, createPublicClient, http, parseUnits, formatUnits, maxUint256 } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { avalanche } = require('viem/chains');
const { GmxSdk } = require('@gmx-io/sdk');

const AVALANCHE_RPC = 'https://api.avax.network/ext/bc/C/rpc';
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const GMX_ROUTER = '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68';

async function executeGmxWithSdk() {
  const privateKey = '0x7bb42e857622a1e7cd7fb6e039b786060f8f65eb2da1783cc207577c96c7a0e0';
  const collateralUsd = 5;
  const leverage = 2.5;
  
  console.log('Executing GMX BTC Long with SDK (1.01 gwei max gas)...\n');
  
  try {
    const account = privateKeyToAccount(privateKey);
    console.log(`Wallet: ${account.address}`);
    
    // Create custom transport with low gas
    const maxGas = parseUnits('1.01', 9); // 1.01 gwei
    
    const publicClient = createPublicClient({
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });
    
    // Create wallet client with gas overrides - wrap writeContract to force low gas
    const baseWalletClient = createWalletClient({
      account,
      chain: avalanche,
      transport: http(AVALANCHE_RPC),
    });
    
    // Wrap the wallet client to force 1.01 gwei on all transactions
    const walletClient = {
      ...baseWalletClient,
      writeContract: async (args) => {
        console.log('[WalletClient] Forcing 1.01 gwei gas...');
        return baseWalletClient.writeContract({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
        });
      },
      sendTransaction: async (args) => {
        console.log('[WalletClient] Forcing 1.01 gwei gas on sendTransaction...');
        return baseWalletClient.sendTransaction({
          ...args,
          maxFeePerGas: maxGas,
          maxPriorityFeePerGas: maxGas,
        });
      },
    };
    
    // Check balances
    const avaxBalance = await publicClient.getBalance({ address: account.address });
    console.log(`AVAX balance: ${formatUnits(avaxBalance, 18)}`);
    
    const usdcBalance = await publicClient.readContract({
      address: USDC_CONTRACT,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [account.address],
    });
    console.log(`USDC balance: ${formatUnits(usdcBalance, 6)}\n`);
    
    // Fetch market data
    console.log('Fetching market data...');
    const [tokensRes, marketsRes] = await Promise.all([
      fetch('https://avalanche-api.gmxinfra.io/tokens'),
      fetch('https://avalanche-api.gmxinfra.io/markets'),
    ]);
    
    const tokensJson = await tokensRes.json();
    const marketsJson = await marketsRes.json();
    
    const btcToken = tokensJson.tokens.find(t => t.symbol === 'BTC');
    const usdcToken = tokensJson.tokens.find(t => t.symbol === 'USDC');
    
    const btcUsdcMarket = marketsJson.markets.find(
      m => m.isListed && 
           m.indexToken.toLowerCase() === btcToken.address.toLowerCase() &&
           m.shortToken.toLowerCase() === usdcToken.address.toLowerCase()
    );
    
    console.log(`Market: ${btcUsdcMarket.marketToken}\n`);
    
    // Approve USDC to Router
    const usdcAmount = parseUnits(collateralUsd.toString(), 6);
    const allowance = await publicClient.readContract({
      address: USDC_CONTRACT,
      abi: [{ name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }],
      functionName: 'allowance',
      args: [account.address, GMX_ROUTER],
    });
    
    if (allowance < usdcAmount) {
      console.log('Approving USDC to Router...');
      const approveTxHash = await walletClient.writeContract({
        address: USDC_CONTRACT,
        abi: [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }],
        functionName: 'approve',
        args: [GMX_ROUTER, maxUint256],
        maxFeePerGas: maxGas,
        maxPriorityFeePerGas: maxGas,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTxHash });
      console.log('USDC approved\n');
    } else {
      console.log('USDC already approved\n');
    }
    
    // Initialize GMX SDK
    console.log('Initializing GMX SDK...');
    const sdk = new GmxSdk({
      chainId: 43114,
      rpcUrl: AVALANCHE_RPC,
      oracleUrl: 'https://avalanche-api.gmxinfra.io',
      subsquidUrl: 'https://gmx.squids.live/gmx-synthetics-avalanche/graphql',
      walletClient: walletClient,
    });
    
    sdk.setAccount(account.address);
    console.log('SDK initialized\n');
    
    // Track tx hash
    let submittedHash = null;
    
    // Override callContract to add low gas and capture hash
    const originalCallContract = sdk.callContract.bind(sdk);
    sdk.callContract = async (contractAddress, abi, method, params, opts) => {
      console.log(`[SDK] Calling ${method}...`);
      
      // Extract sendWnt amounts for execution fee
      let totalWntAmount = 0n;
      if (method === 'multicall' && Array.isArray(params) && Array.isArray(params[0])) {
        const dataItems = params[0];
        dataItems.forEach((data) => {
          if (typeof data === 'string' && data.toLowerCase().startsWith('0x7d39aaf1')) {
            if (data.length >= 138) {
              const amountHex = data.slice(74, 138);
              totalWntAmount += BigInt(`0x${amountHex}`);
            }
          }
        });
        
        if (totalWntAmount > 0n) {
          console.log(`[SDK] Execution fee: ${formatUnits(totalWntAmount, 18)} AVAX`);
        }
      }
      
      // Force low gas price (1.01 gwei) and add execution fee as value
      const finalOpts = {
        ...opts,
        value: (opts?.value || 0n) + totalWntAmount,
        maxFeePerGas: maxGas,
        maxPriorityFeePerGas: maxGas,
        gas: 2000000n, // Fixed gas limit
      };
      
      console.log(`[SDK] Using max gas: 1.01 gwei, gasLimit: 2M`);
      
      const h = await originalCallContract(contractAddress, abi, method, params, finalOpts);
      submittedHash = h;
      console.log(`[SDK] Tx submitted: ${h}`);
      return h;
    };
    
    // Execute order
    const leverageBps = BigInt(Math.floor(leverage * 10000));
    console.log('Submitting GMX order...');
    
    await sdk.orders.long({
      payAmount: usdcAmount,
      marketAddress: btcUsdcMarket.marketToken,
      payTokenAddress: usdcToken.address,
      collateralTokenAddress: usdcToken.address,
      allowedSlippageBps: 100,
      leverage: leverageBps,
      skipSimulation: true,
    });
    
    if (!submittedHash) {
      throw new Error('No tx hash captured');
    }
    
    console.log('\nWaiting for confirmation...');
    const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
    
    if (receipt.status === 'success') {
      console.log(`\n✅ GMX order confirmed!`);
      console.log(`Transaction: https://snowtrace.io/tx/${submittedHash}`);
    } else {
      console.log('\n❌ Transaction reverted');
      console.log('Receipt:', JSON.stringify(receipt, null, 2));
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.cause) {
      console.error('Cause:', error.cause.message || error.cause);
    }
  }
}

executeGmxWithSdk();
