import { ethers } from 'ethers';

async function testErgcTransfer() {
  console.log('Testing ERGC transfer from hub wallet...');
  
  const provider = new ethers.JsonRpcProvider('https://api.avax.network/ext/bc/C/rpc');
  
  // Hub wallet configuration (should match environment variables)
  const HUB_WALLET_PRIVATE_KEY = process.env.HUB_WALLET_PRIVATE_KEY;
  const HUB_WALLET_ADDRESS = '0x34c11928868d14bdD7Be55A0D9f9e02257240c24';
  const ERGC_CONTRACT = '0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B';
  const ERGC_SEND_TO_USER = ethers.parseUnits('100', 18);
  
  if (!HUB_WALLET_PRIVATE_KEY) {
    console.error('❌ HUB_WALLET_PRIVATE_KEY not found in environment');
    return;
  }
  
  try {
    const wallet = new ethers.Wallet(HUB_WALLET_PRIVATE_KEY, provider);
    const ergcContract = new ethers.Contract(ERGC_CONTRACT, [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
      'function decimals() view returns (uint8)'
    ], wallet);
    
    console.log('📍 Hub Wallet Address:', wallet.address);
    console.log('📍 ERGC Contract:', ERGC_CONTRACT);
    
    // Check current balance
    const balance = await ergcContract.balanceOf(wallet.address);
    console.log('💰 Current ERGC Balance:', ethers.formatUnits(balance, 18));
    
    // Check decimals
    const decimals = await ergcContract.decimals();
    console.log('🔢 ERGC Decimals:', decimals);
    
    // Test transfer to hub wallet itself (safe test)
    console.log('🧪 Testing transfer of 100 ERGC to hub wallet itself...');
    
    const tx = await ergcContract.transfer(wallet.address, ERGC_SEND_TO_USER);
    console.log('📤 Transaction submitted:', tx.hash);
    
    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed:', receipt.hash);
    console.log('⛽ Gas used:', receipt.gasUsed.toString());
    
    // Check new balance
    const newBalance = await ergcContract.balanceOf(wallet.address);
    console.log('💰 New ERGC Balance:', ethers.formatUnits(newBalance, 18));
    
    console.log('✅ ERGC transfer test successful!');
    
  } catch (error) {
    console.error('❌ ERGC transfer test failed:', error);
  }
}

testErgcTransfer().catch(console.error);
