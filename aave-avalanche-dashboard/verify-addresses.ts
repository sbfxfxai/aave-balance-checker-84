/**
 * Address Verification Script
 * Verifies all addresses used in conservative flow
 */

import { ethers } from 'ethers';

const addresses = {
  USDC_CONTRACT: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  AAVE_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  USER_WALLET: '0x5c71B7Be6AaC81B3b1a8b88aDF475DDE24293c67',
  HUB_WALLET: '0x34c11928868d14bdD7Be55A0D9f9e02257240c24',
};

console.log('==========================================');
console.log('Address Verification');
console.log('==========================================\n');

Object.entries(addresses).forEach(([name, address]) => {
  const isValid = ethers.isAddress(address);
  const checksum = isValid ? ethers.getAddress(address) : 'INVALID';
  const match = checksum.toLowerCase() === address.toLowerCase();
  
  console.log(`${name}:`);
  console.log(`  Address:     ${address}`);
  console.log(`  Valid:       ${isValid ? '✅ YES' : '❌ NO'}`);
  console.log(`  Checksum:    ${checksum}`);
  console.log(`  Matches:     ${match ? '✅ YES' : '❌ NO'}`);
  console.log('');
});

// Verify critical flow addresses
console.log('==========================================');
console.log('Flow Verification');
console.log('==========================================\n');

console.log('executeAaveFromHubWallet function:');
console.log(`  USDC Contract:  ${addresses.USDC_CONTRACT}`);
console.log(`  Aave Pool:      ${addresses.AAVE_POOL}`);
console.log(`  Hub Wallet:     ${addresses.HUB_WALLET} (signer)`);
console.log(`  User Wallet:    ${addresses.USER_WALLET} (onBehalfOf - receives aTokens)`);
console.log('');

// Verify they're different
if (addresses.USER_WALLET.toLowerCase() === addresses.HUB_WALLET.toLowerCase()) {
  console.log('❌ ERROR: User wallet and Hub wallet are the same!');
} else {
  console.log('✅ User wallet and Hub wallet are different');
}

console.log('\n==========================================');
console.log('Verification Complete');
console.log('==========================================');

