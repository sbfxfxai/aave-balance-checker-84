# Mythril Security Analysis Setup

## Overview

Mythril is an open-source symbolic execution tool for EVM bytecode that detects common vulnerabilities in smart contracts. It performs deep analysis by exploring all possible execution paths.

## Installation

### Prerequisites

- Python 3.8 or higher
- pip (Python package manager)

### Install Mythril

```bash
# Install Mythril
pip install mythril

# Or install all audit tools
cd contracts
pip install -r requirements-audit.txt
```

### Verify Installation

```bash
myth --version
```

## Running Mythril

### Quick Start

```bash
cd contracts

# Compile contracts first
npm run compile

# Run Mythril analysis
npm run audit:mythril
```

### Manual Analysis

```bash
# Analyze a specific contract
myth analyze src/TiltVaultManagerV2.sol

# With custom options
myth analyze src/TiltVaultManagerV2.sol \
  --execution-timeout 300 \
  --max-depth 12 \
  --solv 0.8.20
```

### Analyze Compiled Bytecode

```bash
# Analyze from artifact
myth analyze artifacts/contracts/src/TiltVaultManagerV2.sol/TiltVaultManagerV2.json
```

## Command Options

### Common Options

```bash
myth analyze <contract> \
  --execution-timeout 300    # Timeout in seconds (default: 300)
  --max-depth 12            # Maximum search depth (default: 12)
  --solv 0.8.20            # Solidity compiler version
  --format markdown         # Output format (markdown, json, text)
  --output report.md        # Output file
  --solver-timeout 10000   # Solver timeout in milliseconds
```

### Advanced Options

```bash
myth analyze <contract> \
  --transaction-count 2     # Number of transactions to analyze
  --unconstrained-storage   # Enable unconstrained storage analysis
  --call-depth-limit 3      # Maximum call depth
  --disable-dependency-pruning  # Disable dependency pruning
```

## Understanding Results

### Severity Levels

- **High**: Critical security issues (reentrancy, access control, etc.)
- **Medium**: Significant issues (unchecked calls, integer overflow, etc.)
- **Low**: Minor issues or code quality problems
- **Informational**: Best practices and recommendations

### Common Detections

**SWC-107 (Reentrancy):**
- **Issue**: External calls before state changes
- **Fix**: Use checks-effects-interactions pattern or `nonReentrant` modifier

**SWC-100 (Function Default Visibility):**
- **Issue**: Functions without explicit visibility
- **Fix**: Add `public`, `external`, `internal`, or `private`

**SWC-101 (Integer Overflow/Underflow):**
- **Issue**: Unsafe arithmetic operations
- **Fix**: Use SafeMath or Solidity 0.8+ built-in checks

**SWC-104 (Unchecked Call Return Value):**
- **Issue**: External calls without checking return values
- **Fix**: Check return values or use SafeERC20

**SWC-105 (Unprotected Ether Withdrawal):**
- **Issue**: Withdrawal functions without access control
- **Fix**: Add access control modifiers

**SWC-106 (Unprotected Selfdestruct):**
- **Issue**: Selfdestruct without access control
- **Fix**: Add access control or remove if not needed

**SWC-107 (Reentrancy):**
- **Issue**: Reentrancy vulnerabilities
- **Fix**: Use reentrancy guards

**SWC-108 (State Variable Default Visibility):**
- **Issue**: State variables without explicit visibility
- **Fix**: Add `public`, `internal`, or `private`

**SWC-109 (Uninitialized Storage Pointer):**
- **Issue**: Uninitialized storage pointers
- **Fix**: Initialize storage variables properly

**SWC-110 (Assert Violation):**
- **Issue**: Assert statements that can fail
- **Fix**: Use `require` for user input validation, `assert` for invariants

## Interpreting Reports

### Report Structure

```markdown
# Mythril Analysis Report

## SWC-107: Reentrancy
**Severity**: High
**Location**: TiltVaultManagerV2.sol:153
**Description**: External call before state change
**Recommendation**: Use checks-effects-interactions pattern
```

### False Positives

Mythril may report false positives:
- **Review manually**: Not all findings are actual vulnerabilities
- **Context matters**: Some patterns are safe in specific contexts
- **Verify with tests**: Write tests to verify behavior

## Integration

### Pre-Commit Hook

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
cd contracts
npm run compile
npm run audit:mythril
if [ $? -ne 0 ]; then
    echo "Mythril found issues. Review reports/ directory"
    exit 1
fi
```

### CI/CD Integration

See `.github/workflows/mythril-audit.yml` for GitHub Actions integration.

## Best Practices

### Before Deployment

1. **Run Mythril** on all contracts
2. **Review all findings** (especially High/Medium severity)
3. **Fix critical issues** before deployment
4. **Re-run analysis** after fixes
5. **Document decisions** if choosing not to fix

### Regular Audits

- Run before each deployment
- After major contract changes
- Weekly/monthly reviews
- Before security audits

### Combining Tools

Use multiple tools for comprehensive analysis:
- **Mythril**: Symbolic execution (deep analysis)
- **Aderyn**: Static analysis (quick checks)
- **Slither**: Static analysis (comprehensive)
- **Manual review**: Human expertise

## Troubleshooting

### "No bytecode found"

**Problem**: Contract not compiled  
**Solution**: Run `npm run compile` first

### "Timeout exceeded"

**Problem**: Analysis taking too long  
**Solution**: Increase `--execution-timeout` or reduce `--max-depth`

### "Solver timeout"

**Problem**: Constraint solver timing out  
**Solution**: Increase `--solver-timeout` or simplify contract logic

### "Import errors"

**Problem**: Cannot resolve imports  
**Solution**: Ensure all dependencies are installed and paths are correct

## Performance Tips

1. **Analyze incrementally**: Focus on changed contracts
2. **Use appropriate depth**: Lower depth for faster analysis
3. **Filter by severity**: Focus on High/Medium issues first
4. **Parallel analysis**: Run multiple contracts in parallel

## Example Workflow

```bash
# 1. Compile contracts
cd contracts
npm run compile

# 2. Run Mythril
npm run audit:mythril

# 3. Review reports
cat reports/mythril-TiltVaultManagerV2.md

# 4. Fix issues
# ... make code changes ...

# 5. Re-compile and re-analyze
npm run compile
npm run audit:mythril

# 6. Verify fixes
cat reports/mythril-TiltVaultManagerV2.md
```

## Resources

- [Mythril Documentation](https://mythril-classic.readthedocs.io/)
- [Mythril GitHub](https://github.com/ConsenSys/mythril)
- [SWC Registry](https://swcregistry.io/) - Smart Contract Weakness Classification

## Next Steps

1. **Install Mythril**: `pip install mythril`
2. **Run first analysis**: `cd contracts && npm run audit:mythril`
3. **Review reports**: Check `reports/` directory
4. **Fix critical issues**: Address High/Medium severity findings
5. **Set up CI/CD**: Enable automated audits

