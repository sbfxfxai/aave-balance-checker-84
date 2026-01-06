# Aderyn Static Analysis Setup

## Overview

Aderyn is a free and open-source static analyzer for Solidity smart contracts. This guide explains how to run Aderyn audits on TiltVault contracts.

## Installation

### Linux/macOS (Recommended)

**Using cyfrinup (Recommended):**
```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/cyfrin/aderyn/releases/latest/download/aderyn-installer.sh | bash
```

**Using Homebrew (macOS):**
```bash
brew install cyfrin/tap/aderyn
```

**Using npm (Linux/macOS only):**
```bash
npm install -g @cyfrin/aderyn
```

**Note:** Aderyn does not support Windows directly. Use WSL, Docker, or a Linux/macOS environment.

### Windows Users

**Option 1: Use WSL (Windows Subsystem for Linux)**
```bash
# In WSL terminal
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/cyfrin/aderyn/releases/latest/download/aderyn-installer.sh | bash
```

**Option 2: Use Docker**
```bash
docker run -v $(pwd):/workspace cyfrin/aderyn
```

**Option 3: Use GitHub Actions** (see CI/CD section below)

## Running the Audit

### Basic Usage

Navigate to the contracts directory and run:

```bash
cd contracts
aderyn
```

This will:
1. Analyze all Solidity files in `src/`
2. Generate a `report.md` file with findings
3. Display results in the terminal

### Analyze Specific Files

```bash
aderyn src/TiltVaultManagerV2.sol
```

### Custom Output

```bash
# Save to specific file
aderyn --output audit-report.md

# JSON output
aderyn --format json --output audit-report.json
```

## Expected Output

Aderyn will generate a `report.md` file containing:

- **Detectors**: List of security issues found
- **Severity Levels**: Critical, High, Medium, Low, Informational
- **File Locations**: Exact line numbers of issues
- **Recommendations**: How to fix each issue

## Integration with CI/CD

### GitHub Actions

Create `.github/workflows/aderyn-audit.yml`:

```yaml
name: Aderyn Audit

on:
  push:
    branches: [ main, staging, development ]
  pull_request:
    branches: [ main, staging ]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Aderyn
        run: |
          curl --proto '=https' --tlsv1.2 -LsSf https://github.com/cyfrin/aderyn/releases/latest/download/aderyn-installer.sh | bash
          echo "$HOME/.cargo/bin" >> $GITHUB_PATH
      
      - name: Run Aderyn
        working-directory: ./contracts
        run: aderyn
      
      - name: Upload Report
        uses: actions/upload-artifact@v3
        with:
          name: aderyn-report
          path: contracts/report.md
```

## VS Code Integration

Install the Aderyn VS Code extension for real-time analysis:

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Aderyn"
4. Install "Aderyn" by Cyfrin

The extension provides:
- Inline diagnostics
- Tree view of vulnerabilities
- Real-time analysis as you code

## Running the First Audit

### Step 1: Install Aderyn

```bash
# Linux/macOS
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/cyfrin/aderyn/releases/latest/download/aderyn-installer.sh | bash

# Verify installation
aderyn --version
```

### Step 2: Navigate to Contracts

```bash
cd aave-avalanche-dashboard/contracts
```

### Step 3: Run Audit

```bash
aderyn
```

### Step 4: Review Report

```bash
# View the report
cat report.md

# Or open in editor
code report.md  # VS Code
# or
nano report.md
```

## What Aderyn Checks

Aderyn detects common Solidity vulnerabilities:

- **Reentrancy**: Unprotected external calls
- **Access Control**: Missing access modifiers
- **Integer Overflow/Underflow**: Unsafe arithmetic
- **Uninitialized Storage**: Uninitialized state variables
- **Unchecked External Calls**: Missing return value checks
- **Timestamp Dependence**: Block timestamp usage
- **Gas Optimization**: Inefficient code patterns
- **And many more...**

## Interpreting Results

### Severity Levels

- **Critical**: Immediate security risk, must fix
- **High**: Significant security risk, should fix
- **Medium**: Moderate risk, consider fixing
- **Low**: Minor issues, optional fixes
- **Informational**: Best practices, code quality

### Common Findings

**Reentrancy:**
- Fix: Use `nonReentrant` modifier or checks-effects-interactions pattern

**Access Control:**
- Fix: Add `onlyOwner` or `onlyAuthorized` modifiers

**Unchecked External Calls:**
- Fix: Check return values or use SafeERC20

**Gas Optimization:**
- Fix: Optimize loops, use events instead of storage

## Fixing Issues

1. **Review each finding** in `report.md`
2. **Understand the risk** - read the description
3. **Apply fixes** - follow recommendations
4. **Re-run audit** - verify fixes
5. **Document changes** - update code comments

## Continuous Auditing

### Pre-Commit Hook

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
cd contracts
aderyn
if [ $? -ne 0 ]; then
    echo "Aderyn found issues. Please review report.md"
    exit 1
fi
```

### Regular Audits

Run audits:
- Before each deployment
- After major changes
- Weekly/monthly reviews
- Before security audits

## Next Steps

1. **Install Aderyn** (Linux/macOS or WSL)
2. **Run first audit**: `cd contracts && aderyn`
3. **Review report.md** for findings
4. **Fix critical/high issues**
5. **Re-run audit** to verify fixes
6. **Set up CI/CD** for automated audits

## Additional Security Tools

### Mythril (Symbolic Execution)

Mythril performs deep symbolic execution analysis. See `MYTHRIL_SETUP.md` for details.

**Quick start:**
```bash
pip install mythril
cd contracts
npm run compile
npm run audit:mythril
```

### Combining Tools

For comprehensive security analysis, use multiple tools:
- **Aderyn**: Quick static analysis
- **Mythril**: Deep symbolic execution (see MYTHRIL_SETUP.md)
- **Slither**: Comprehensive static analysis
- **Manual review**: Human expertise

## Resources

- [Aderyn GitHub](https://github.com/Cyfrin/aderyn)
- [Aderyn Documentation](https://github.com/Cyfrin/aderyn#readme)
- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=Cyfrin.aderyn)
- [Mythril Documentation](https://mythril-classic.readthedocs.io/)
- [Mythril GitHub](https://github.com/ConsenSys/mythril)

## Notes

- Aderyn is a **static analyzer** - it finds potential issues but may have false positives
- Always **review findings manually** - not all issues are actual vulnerabilities
- **Combine with other tools**: Slither, Mythril, manual audits
- **Fix critical/high issues** before deployment
- **Document decisions** if you choose not to fix certain findings

