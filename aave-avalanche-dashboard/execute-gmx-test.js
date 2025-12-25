// Execute GMX trade with the test wallet
const { ethers } = require('ethers');

const AVALANCHE_RPC = 'https://api.avax.network/ext/bc/C/rpc';
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const GMX_ROUTER = '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68'; // SyntheticsRouter
const GMX_EXCHANGE_ROUTER = '0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2'; // Correct from SDK
const GMX_ORDER_VAULT = '0xD3D60D22d415aD43b7e64b510D86A30f19B1B12C'; // Correct from SDK
const GMX_BTC_MARKET = '0xFb02132333A79C8B5Bd0b64E3AbccA5f7fAf2937';
const GMX_ORDER_TYPE_MARKET_INCREASE = 2;

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const GMX_EXCHANGE_ROUTER_ABI = [
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
  'function sendWnt(address receiver, uint256 amount) external payable',
  'function sendTokens(address token, address receiver, uint256 amount) external payable',
  'function createOrder(((address receiver, address cancellationReceiver, address callbackContract, address uiFeeReceiver, address market, address initialCollateralToken, address[] swapPath) addresses, (uint256 sizeDeltaUsd, uint256 initialCollateralDeltaAmount, uint256 triggerPrice, uint256 acceptablePrice, uint256 executionFee, uint256 callbackGasLimit, uint256 minOutputAmount) numbers, uint8 orderType, uint8 decreasePositionSwapType, bool isLong, bool shouldUnwrapNativeToken, bool autoCancel, bytes32 referralCode) params) external payable returns (bytes32)',
];

// GMX Router ABI for plugin approval
const GMX_ROUTER_ABI = [
  'function approvePlugin(address plugin) external',
  'function approvedPlugins(address account, address plugin) view returns (bool)',
];

async function executeGmx() {
  const privateKey = '0x7bb42e857622a1e7cd7fb6e039b786060f8f65eb2da1783cc207577c96c7a0e0';
  const collateralUsd = 5;
  const leverage = 2.5;
  const positionSizeUsd = collateralUsd * leverage;
  
  console.log('Executing GMX BTC Long...\n');
  console.log(`Collateral: $${collateralUsd}`);
  console.log(`Leverage: ${leverage}x`);
  console.log(`Position size: $${positionSizeUsd}\n`);
  
  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    console.log(`Wallet: ${wallet.address}`);
    
    // Check balances
    const avaxBalance = await provider.getBalance(wallet.address);
    console.log(`AVAX balance: ${ethers.formatEther(avaxBalance)}`);
    
    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, wallet);
    const usdcBalance = await usdcContract.balanceOf(wallet.address);
    console.log(`USDC balance: ${Number(usdcBalance) / 1_000_000}\n`);
    
    const executionFee = ethers.parseEther('0.02');
    const usdcAmount = BigInt(Math.floor(collateralUsd * 1_000_000));
    
    if (avaxBalance < executionFee) {
      throw new Error('Insufficient AVAX for execution fee');
    }
    
    if (usdcBalance < usdcAmount) {
      throw new Error('Insufficient USDC for collateral');
    }
    
    // Approve USDC to Router
    const allowance = await usdcContract.allowance(wallet.address, GMX_ROUTER);
    if (allowance < usdcAmount) {
      console.log('Approving USDC to Router...');
      const approveTx = await usdcContract.approve(GMX_ROUTER, ethers.MaxUint256);
      await approveTx.wait();
      console.log('USDC approved\n');
    } else {
      console.log('USDC already approved\n');
    }
    
    // Approve ExchangeRouter as plugin on SyntheticsRouter
    const routerContract = new ethers.Contract(GMX_ROUTER, GMX_ROUTER_ABI, wallet);
    console.log('Approving ExchangeRouter as plugin...');
    try {
      const pluginTx = await routerContract.approvePlugin(GMX_EXCHANGE_ROUTER, {
        maxFeePerGas: ethers.parseUnits('1.01', 'gwei'),
        maxPriorityFeePerGas: ethers.parseUnits('1.01', 'gwei'),
        gasLimit: 100000n,
      });
      console.log('Plugin tx submitted:', pluginTx.hash);
      await pluginTx.wait();
      console.log('Plugin approved\n');
    } catch (e) {
      console.log('Plugin approval error:', e.message.slice(0, 100) + '...\n');
    }
    
    // Build GMX order
    const exchangeRouter = new ethers.Contract(GMX_EXCHANGE_ROUTER, GMX_EXCHANGE_ROUTER_ABI, wallet);
    const iface = new ethers.Interface(GMX_EXCHANGE_ROUTER_ABI);
    
    const sizeDeltaUsd = BigInt(Math.floor(positionSizeUsd * 1e30));
    
    const sendWntData = iface.encodeFunctionData('sendWnt', [GMX_ORDER_VAULT, executionFee]);
    const sendTokensData = iface.encodeFunctionData('sendTokens', [USDC_CONTRACT, GMX_ORDER_VAULT, usdcAmount]);
    
    const orderParams = {
      addresses: {
        receiver: wallet.address,
        cancellationReceiver: wallet.address,
        callbackContract: ethers.ZeroAddress,
        uiFeeReceiver: ethers.ZeroAddress,
        market: GMX_BTC_MARKET,
        initialCollateralToken: USDC_CONTRACT,
        swapPath: [],
      },
      numbers: {
        sizeDeltaUsd: sizeDeltaUsd,
        initialCollateralDeltaAmount: usdcAmount,
        triggerPrice: 0n,
        acceptablePrice: ethers.MaxUint256,
        executionFee: executionFee,
        callbackGasLimit: 0n,
        minOutputAmount: 0n,
      },
      orderType: GMX_ORDER_TYPE_MARKET_INCREASE,
      decreasePositionSwapType: 0,
      isLong: true,
      shouldUnwrapNativeToken: false,
      autoCancel: false,
      referralCode: ethers.ZeroHash,
    };
    
    const createOrderData = iface.encodeFunctionData('createOrder', [orderParams]);
    
    // Use max gas price of 1.01 gwei to keep costs low
    // Skip gas estimation by providing fixed gasLimit
    const maxGasPrice = ethers.parseUnits('1.01', 'gwei');
    console.log('Submitting GMX order (max gas: 1.01 gwei, gasLimit: 2M)...');
    const tx = await exchangeRouter.multicall(
      [sendWntData, sendTokensData, createOrderData],
      { 
        value: executionFee,
        maxFeePerGas: maxGasPrice,
        maxPriorityFeePerGas: maxGasPrice,
        gasLimit: 2000000n, // Fixed gas limit to skip estimation
      }
    );
    
    console.log(`Transaction submitted: ${tx.hash}`);
    console.log('Waiting for confirmation...');
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log(`\n✅ GMX order confirmed!`);
      console.log(`Transaction: https://snowtrace.io/tx/${tx.hash}`);
    } else {
      console.log('\n❌ Transaction reverted');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
  }
}

executeGmx();
