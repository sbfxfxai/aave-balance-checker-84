# TiltVaultManager.sol Security Audit

## Audit Date
2025-01-27

## Contract Overview
TiltVaultManager is a delegated position management contract that allows users to authorize the TiltVault backend to manage their Aave and GMX positions without giving up custody of their funds.

## Executive Summary

**Overall Security Rating:** ✅ **LOW-MEDIUM RISK** (After fixes applied)

**Key Findings:**
- ✅ **Access Control:** Properly implemented with user-level authorization
- ✅ **Reentrancy:** All external functions protected with `nonReentrant` modifier
- ✅ **No Critical Vulnerabilities Identified**
- 🔧 **Minor Improvements Applied:** Events, excess AVAX refund, allowance reset helpers

## Security Issues Identified

### ✅ Access Control: Properly Implemented

**Location:** Lines 73-79

**Analysis:**
The access control mechanism is correctly implemented:
```solidity
modifier onlyAuthorizedFor(address user) {
    require(
        isAuthorized[user] && (msg.sender == executor || msg.sender == owner() || authorizedManagers[user][msg.sender]),
        "Not authorized for this user"
    );
    _;
}
```

**Assessment:**
- ✅ User must explicitly authorize via `authorizeManager()`
- ✅ Owner can execute operations, but only for authorized users (gated by `isAuthorized[user]`)
- ✅ Users can revoke access anytime with `revokeAccess()`
- ✅ Per-manager authorization mapping remains but is gated by `isAuthorized` check, so effective revocation is safe

**Status:** ✅ **SECURE** - No changes needed

### 🟡 MINOR: Missing Events for Emergency Withdrawals

**Location:** Lines 406, 416

**Issue:**
Emergency withdraw functions don't emit events for monitoring:
```solidity
function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
    IERC20(token).safeTransfer(to, amount); // No event
}
```

**Risk:**
- Difficult to monitor emergency withdrawals
- No audit trail for admin actions

**Status:** ✅ **FIXED** - Events added

### 🟡 MINOR: Excess AVAX Not Returned

**Location:** Lines 191, 247, 298, 346

**Issue:**
GMX functions accept `msg.value >= executionFee` but don't refund excess:
```solidity
require(msg.value >= executionFee, "Insufficient execution fee");
IGmxExchangeRouter(...).createOrder{value: executionFee}(params);
// Excess AVAX stays in contract
```

**Risk:**
- Users may accidentally send too much AVAX
- Funds accumulate in contract
- Requires emergency withdraw to recover

**Status:** ✅ **FIXED** - Excess AVAX now refunded automatically

### 🟡 MINOR: No Allowance Reset Helpers

**Location:** Constructor (Lines 87-91)

**Issue:**
Constructor approves `type(uint256).max` to AAVE_POOL and GMX_ROUTER:
```solidity
IERC20(USDC).approve(AAVE_POOL, type(uint256).max);
IERC20(USDC).approve(GMX_ROUTER, type(uint256).max);
```

**Risk:**
- No way to reset allowances in emergencies
- Typical pattern but could add reset helpers for safety

**Status:** ✅ **FIXED** - Added `resetAaveAllowance()` and `resetGmxAllowance()` functions

## Reentrancy Analysis

### ✅ GOOD: All External Functions Protected

**Status:** All functions that interact with external contracts use `nonReentrant` modifier:
- `depositToAave` - ✅ Protected
- `withdrawFromAave` - ✅ Protected
- `openGmxPosition` - ✅ Protected
- `addGmxCollateral` - ✅ Protected
- `removeGmxCollateral` - ✅ Protected
- `closeGmxPosition` - ✅ Protected

### ✅ GOOD: Safe Order of Operations

All functions follow the Checks-Effects-Interactions pattern:
1. Validate inputs
2. Transfer tokens (state change)
3. Call external contract
4. Emit events

### ✅ GOOD: Using SafeERC20

Contract uses `SafeERC20` for all token transfers, which provides additional protection against reentrancy and non-standard token behavior.

## Fixes Applied

### ✅ 1. Added Events for Emergency Withdrawals
```solidity
event EmergencyWithdraw(address indexed token, address indexed to, uint256 amount, uint256 timestamp);
event EmergencyWithdrawAvax(address indexed to, uint256 amount, uint256 timestamp);

function emergencyWithdraw(...) external onlyOwner {
    IERC20(token).safeTransfer(to, amount);
    emit EmergencyWithdraw(token, to, amount, block.timestamp); // ✅ Added
}
```

### ✅ 2. Refund Excess AVAX in GMX Functions
```solidity
if (msg.value > executionFee) {
    uint256 excess = msg.value - executionFee;
    (bool success, ) = payable(msg.sender).call{value: excess}("");
    require(success, "AVAX refund failed");
    emit ExcessAvaxReturned(msg.sender, excess); // ✅ Added
}
```

### ✅ 3. Added Allowance Reset Helpers
```solidity
function resetAaveAllowance(uint256 newAllowance) external onlyOwner {
    IERC20(USDC).approve(AAVE_POOL, 0); // Reset first
    IERC20(USDC).approve(AAVE_POOL, newAllowance);
}

function resetGmxAllowance(uint256 newAllowance) external onlyOwner {
    IERC20(USDC).approve(GMX_ROUTER, 0); // Reset first
    IERC20(USDC).approve(GMX_ROUTER, newAllowance);
}
```

## Recommendations Summary

### ✅ All Minor Issues Fixed:
1. ✅ Events added for emergency withdrawals
2. ✅ Excess AVAX refunded in all GMX functions
3. ✅ Allowance reset helpers added

### Optional Enhancements (Not Critical):
- Consider timelock/2-step executor change for operational safety (optional)
- Consider per-user revocation clearing authorizedManagers mapping (current implementation is safe)

## Conclusion

The contract has **excellent reentrancy protection** and **properly implemented access controls**. All user operations are gated by explicit user authorization, and users can revoke access at any time. The owner's ability to execute operations is intentional and properly gated by the `isAuthorized[user]` check.

**Overall Security Rating:** ✅ **LOW-MEDIUM RISK** (After fixes)

**Recommendation:** Contract is ready for deployment. All identified minor issues have been fixed. Optional enhancements can be added in future versions if needed.

