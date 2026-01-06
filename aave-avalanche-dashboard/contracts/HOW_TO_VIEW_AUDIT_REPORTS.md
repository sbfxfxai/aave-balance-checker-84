# How to View Audit Reports

## GitHub Actions Reports

### Accessing Reports

1. **Go to GitHub Repository**
   - Navigate to: https://github.com/sbfxfxai/aave-balance-checker-84

2. **View Actions**
   - Click on the "Actions" tab
   - You'll see two workflows:
     - **Aderyn Static Analysis** - Quick static analysis
     - **Mythril Security Analysis** - Deep symbolic execution

3. **View Latest Run**
   - Click on the most recent workflow run
   - Scroll down to "Artifacts" section
   - Download the reports:
     - `aderyn-report` - Contains `report.md`
     - `mythril-reports` - Contains `mythril-*.md` files

4. **View in PR Comments**
   - If you have a pull request open, the workflows will automatically comment with findings

### Manual Trigger

To trigger audits manually:

1. Go to Actions tab
2. Select "Aderyn Static Analysis" or "Mythril Security Analysis"
3. Click "Run workflow" button
4. Select branch (staging/development/main)
5. Click "Run workflow"
6. Wait for completion (usually 2-5 minutes)
7. Download artifacts

## Report Structure

### Aderyn Report (`report.md`)

```markdown
# Aderyn Analysis Report

## Summary
- Total Issues: X
- Critical: X
- High: X
- Medium: X
- Low: X
- Informational: X

## Detectors

### [Detector Name]
**Severity**: High
**File**: TiltVaultManagerV2.sol
**Line**: 153
**Description**: Issue description
**Recommendation**: How to fix
```

### Mythril Report (`mythril-*.md`)

```markdown
# Mythril Analysis Report

## SWC-107: Reentrancy
**Severity**: High
**Location**: TiltVaultManagerV2.sol:153
**Description**: External call before state change
**Recommendation**: Use checks-effects-interactions pattern
```

## Expected Findings

Based on the contract code, you may see:

### Common Issues to Expect

1. **Reentrancy** (if not properly guarded)
   - Check: All external calls use `nonReentrant` modifier

2. **Access Control**
   - Check: All admin functions have `onlyOwner` modifier

3. **Integer Overflow/Underflow**
   - Check: Using Solidity 0.8.20+ (built-in checks)

4. **Unchecked External Calls**
   - Check: Using SafeERC20 for token transfers

5. **Uninitialized Storage**
   - Check: All state variables initialized

## Next Steps After Reviewing Reports

1. **Review all findings** - Especially Critical/High severity
2. **Fix critical issues** - Address before deployment
3. **Document decisions** - If choosing not to fix, explain why
4. **Re-run audits** - Verify fixes worked
5. **Deploy** - Only after all critical issues resolved

## Quick Links

- **GitHub Actions**: https://github.com/sbfxfxai/aave-balance-checker-84/actions
- **Aderyn Workflow**: https://github.com/sbfxfxai/aave-balance-checker-84/actions/workflows/aderyn-audit.yml
- **Mythril Workflow**: https://github.com/sbfxfxai/aave-balance-checker-84/actions/workflows/mythril-audit.yml

