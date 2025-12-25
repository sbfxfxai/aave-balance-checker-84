// Test GMX with ethers.js (same as webhook)
const { ethers } = require('ethers');

const AVALANCHE_RPC = 'https://api.avax.network/ext/bc/C/rpc';
const USDC_CONTRACT = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const GMX_ROUTER = '0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68';
const GMX_EXCHANGE_ROUTER = '0x69C527fC77291722b52649E45c838e41be8Bf5d5';
const GMX_ORDER_VAULT = '0xD3D60D22D415Ad43b7E64B510D86a30f77d5A2d5';
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
  {
    name: 'createOrder',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'addresses', type: 'tuple', components: [
          { name: 'receiver', type: 'address' },
          { name: 'cancellationReceiver', type: 'address' },
          { name: 'callbackContract', type: 'address' },
          { name: 'uiFeeReceiver', type: 'address' },
          { name: 'market', type: 'address' },
          { name: 'initialCollateralToken', type: 'address' },
          { name: 'swapPath', type: 'address[]' },
        ]},
        { name: 'numbers', type: 'tuple', components: [
          { name: 'sizeDeltaUsd', type: 'uint256' },
          { name: 'initialCollateralDeltaAmount', type: 'uint256' },
          { name: 'triggerPrice', type: 'uint256' },
          { name: 'acceptablePrice', type: 'uint256' },
          { name: 'executionFee', type: 'uint256' },
          { name: 'callbackGasLimit', type: 'uint256' },
          { name: 'minOutputAmount', type: 'uint256' },
        ]},
        { name: 'orderType', type: 'uint8' },
        { name: 'decreasePositionSwapType', type: 'uint8' },
        { name: 'isLong', type: 'bool' },
        { name: 'shouldUnwrapNativeToken', type: 'bool' },
        { name: 'autoCancel', type: 'bool' },
        { name: 'referralCode', type: 'bytes32' },
      ]
    }],
    outputs: [{ name: '', type: 'bytes32' }]
  }
];

async function testGmx() {
  // Test wallet address: 0x0405c3398CF2ed3fCc34bBa38FDEa0EF0A16037C
  // Has $5 USDC and 0.03 AVAX
  
  const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
  const testAddress = '0x0405c3398CF2ed3fCc34bBa38FDEa0EF0A16037C';
  
  console.log('Testing GMX with ethers.js...\n');
  
  // Check balances
  const avaxBalance = await provider.getBalance(testAddress);
  console.log('AVAX balance:', ethers.formatEther(avaxBalance));
  
  const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, provider);
  const usdcBalance = await usdcContract.balanceOf(testAddress);
  console.log('USDC balance:', Number(usdcBalance) / 1_000_000);
  
  // Test encoding
  const iface = new ethers.Interface(GMX_EXCHANGE_ROUTER_ABI);
  
  const collateralUsd = 5;
  const leverage = 2.5;
  const positionSizeUsd = collateralUsd * leverage;
  const usdcAmount = BigInt(Math.floor(collateralUsd * 1_000_000));
  const sizeDeltaUsd = BigInt(Math.floor(positionSizeUsd * 1e30));
  const executionFee = ethers.parseEther('0.02');
  
  console.log('\nOrder params:');
  console.log('- Collateral:', collateralUsd, 'USDC');
  console.log('- Leverage:', leverage, 'x');
  console.log('- Position size:', positionSizeUsd, 'USD');
  console.log('- Execution fee:', ethers.formatEther(executionFee), 'AVAX');
  
  try {
    // Test encoding sendWnt
    const sendWntData = iface.encodeFunctionData('sendWnt', [GMX_ORDER_VAULT, executionFee]);
    console.log('\nsendWnt encoded:', sendWntData.slice(0, 20) + '...');
    
    // Test encoding sendTokens
    const sendTokensData = iface.encodeFunctionData('sendTokens', [USDC_CONTRACT, GMX_ORDER_VAULT, usdcAmount]);
    console.log('sendTokens encoded:', sendTokensData.slice(0, 20) + '...');
    
    // Test encoding createOrder
    const orderParams = {
      addresses: {
        receiver: testAddress,
        cancellationReceiver: testAddress,
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
    console.log('createOrder encoded:', createOrderData.slice(0, 20) + '...');
    console.log('createOrder length:', createOrderData.length, 'chars');
    
    console.log('\n✅ All encodings successful!');
    console.log('\nTo execute, need private key for wallet:', testAddress);
    
  } catch (error) {
    console.error('\n❌ Encoding error:', error.message);
  }
}

testGmx();
