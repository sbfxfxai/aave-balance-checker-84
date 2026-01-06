# Upgradeable Contracts Guide

## Overview

Since smart contracts are **immutable** once deployed, we use **upgradeable contracts** with the **UUPS (Universal Upgradeable Proxy Standard)** pattern to enable future upgrades while preserving user data and state.

## Architecture

### UUPS Proxy Pattern

- **Proxy Contract**: The address users interact with (immutable)
- **Implementation Contract**: The actual logic (upgradeable)
- **Storage**: Preserved in the proxy, implementation can be swapped

### Benefits

✅ **Upgradeable Logic**: Fix bugs, add features, improve security  
✅ **Preserved State**: User data, balances, and authorizations remain intact  
✅ **Gas Efficient**: UUPS is more gas-efficient than Transparent Proxy  
✅ **Owner Control**: Only contract owner can upgrade  

## Contract Structure

### TiltVaultManagerV2.sol

- Uses OpenZeppelin's upgradeable contracts
- Inherits: `ReentrancyGuardUpgradeable`, `OwnableUpgradeable`, `UUPSUpgradeable`, `PausableUpgradeable`
- Initializes with `initialize()` instead of constructor
- Version tracking for upgrade history

## Deployment

### Initial Deployment

```bash
# Deploy to Fuji testnet (staging)
npm run deploy:upgradeable:fuji

# Deploy to Avalanche mainnet (production)
npm run deploy:upgradeable:avalanche
```

**Important Addresses:**
- **Proxy Address**: Use this in frontend/backend (users interact with this)
- **Implementation Address**: The actual contract logic
- **Admin Address**: Controls upgrades (initially the proxy itself)

### Deployment Output

```
Proxy Address (use this): 0x...
Implementation Address: 0x...
Admin Address: 0x...
```

**Save these addresses securely!**

## Upgrading Contracts

### Upgrade Process

1. **Test the upgrade on Fuji first**
   ```bash
   npm run upgrade:fuji
   ```

2. **Verify the upgrade works correctly**

3. **Upgrade on mainnet**
   ```bash
   npm run upgrade:avalanche
   ```

### Upgrade Script

The upgrade script:
- Reads proxy address from `deployment.json` or `PROXY_ADDRESS` env var
- Deploys new implementation
- Updates proxy to point to new implementation
- Preserves all state and user data

### After Upgrade

1. **Verify new implementation on Snowtrace**
   ```bash
   npx hardhat verify --network avalanche <NEW_IMPLEMENTATION_ADDRESS>
   ```

2. **Update version number** (if tracking versions)
   ```solidity
   // Call updateVersion() on the proxy
   await manager.updateVersion(2);
   ```

3. **Test all functionality**

4. **Update deployment.json** (automatically done by script)

## Storage Layout Rules

### ⚠️ CRITICAL: Storage Layout Preservation

When upgrading, you **MUST** preserve storage layout:

✅ **Allowed:**
- Add new state variables at the **end**
- Add new functions
- Modify function logic
- Add new events

❌ **NOT Allowed:**
- Remove state variables
- Reorder state variables
- Change variable types
- Insert variables in the middle

### Example: Adding New State Variable

```solidity
// ✅ CORRECT: Add at the end
contract TiltVaultManagerV2 {
    // ... existing variables ...
    uint256 public version;  // Existing
    uint256 public newFeature; // ✅ New variable at end
}

// ❌ WRONG: Inserting in middle
contract TiltVaultManagerV2 {
    mapping(address => bool) public isAuthorized;
    uint256 public newFeature; // ❌ Breaks storage layout!
    address public executor;
}
```

## Security Considerations

### Upgrade Authorization

- Only the **owner** can upgrade (via `_authorizeUpgrade()`)
- Use **multi-sig** for production owner address
- Consider **timelock** for upgrades (add if needed)

### Upgrade Process

1. **Test thoroughly** on testnet first
2. **Audit** new implementation before mainnet upgrade
3. **Announce** upgrades to users (if breaking changes)
4. **Monitor** after upgrade for issues

### Best Practices

- ✅ Always test upgrades on testnet first
- ✅ Preserve storage layout
- ✅ Use version tracking
- ✅ Document all changes
- ✅ Keep old implementation addresses for rollback reference
- ✅ Use multi-sig for owner
- ✅ Consider timelock for critical upgrades

## Rollback Plan

If an upgrade has issues:

1. **Pause the contract** (if pause function exists)
   ```solidity
   await manager.pause();
   ```

2. **Deploy previous version** as new implementation
   ```bash
   # Revert to previous implementation
   npm run upgrade:avalanche
   # (with previous version code)
   ```

3. **Verify rollback works**

4. **Unpause** when ready
   ```solidity
   await manager.unpause();
   ```

## Version Tracking

The contract includes version tracking:

```solidity
uint256 public version;

function updateVersion(uint256 newVersion) external onlyOwner {
    uint256 oldVersion = version;
    version = newVersion;
    emit VersionUpdated(oldVersion, newVersion);
}
```

**After each upgrade:**
```javascript
await manager.updateVersion(2); // Increment version
```

## Testing Upgrades

### Local Testing

```bash
# 1. Deploy initial version
npx hardhat run scripts/deploy-upgradeable.js --network hardhat

# 2. Make changes to contract

# 3. Upgrade
npx hardhat run scripts/upgrade.js --network hardhat

# 4. Verify state is preserved
```

### Testnet Testing

```bash
# 1. Deploy to Fuji
npm run deploy:upgradeable:fuji

# 2. Test functionality

# 3. Make changes

# 4. Upgrade on Fuji
npm run upgrade:fuji

# 5. Verify everything works

# 6. Deploy to mainnet (if ready)
npm run deploy:upgradeable:avalanche
```

## Migration from Non-Upgradeable

If you have a non-upgradeable contract deployed:

### Option 1: Deploy New Upgradeable Contract

1. Deploy new upgradeable contract
2. Migrate users (they need to re-authorize)
3. Update frontend/backend to use new address

### Option 2: Keep Both (Not Recommended)

- Keep old contract for existing users
- Use new upgradeable contract for new users
- More complex to maintain

## Environment Variables

Required for deployment:

```bash
# .env.development / .env.staging / .env.production
DEPLOYER_PRIVATE_KEY=your-private-key
EXECUTOR_ADDRESS=backend-executor-address
AVALANCHE_RPC_URL=your-rpc-url
SNOWTRACE_API_KEY=your-api-key
```

For upgrades:

```bash
PROXY_ADDRESS=0x... # Or set in deployment.json
```

## Troubleshooting

### "Storage layout incompatible"

**Problem**: Changed storage layout incorrectly  
**Solution**: Revert changes, add variables only at the end

### "Upgrade failed"

**Problem**: Various reasons (gas, permissions, etc.)  
**Solution**: Check error message, verify owner address, ensure sufficient gas

### "Implementation not verified"

**Problem**: New implementation not verified on explorer  
**Solution**: Run verification script after upgrade

## Dependencies

Required packages:

```json
{
  "@openzeppelin/contracts-upgradeable": "^5.0.0",
  "@openzeppelin/hardhat-upgrades": "^3.0.0"
}
```

Install:
```bash
cd contracts
npm install
```

## Quick Reference

### Deploy
```bash
npm run deploy:upgradeable:fuji      # Testnet
npm run deploy:upgradeable:avalanche # Mainnet
```

### Upgrade
```bash
npm run upgrade:fuji      # Testnet
npm run upgrade:avalanche # Mainnet
```

### Verify
```bash
npx hardhat verify --network avalanche <IMPLEMENTATION_ADDRESS>
```

## Important Notes

⚠️ **Never lose the proxy address** - this is what users interact with  
⚠️ **Always test on testnet first**  
⚠️ **Preserve storage layout** when upgrading  
⚠️ **Use multi-sig** for production owner  
⚠️ **Document all upgrades** with version numbers  

## Next Steps

1. Install dependencies: `cd contracts && npm install`
2. Deploy to Fuji testnet: `npm run deploy:upgradeable:fuji`
3. Test thoroughly
4. Deploy to mainnet: `npm run deploy:upgradeable:avalanche`
5. Set up multi-sig for owner address
6. Document proxy address in frontend/backend configs

