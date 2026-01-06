# Security Audit Tools Summary

## Overview

TiltVault contracts are analyzed using multiple security tools for comprehensive vulnerability detection.

## Tools Configured

### 1. Aderyn (Static Analysis)
- **Type**: Static analyzer
- **Speed**: Fast
- **Coverage**: 50+ detectors
- **Best for**: Quick checks, CI/CD integration

**Setup**: See `AUDIT_SETUP.md`

**Run**:
```bash
# Linux/macOS/WSL
cd contracts
aderyn
```

**GitHub Actions**: ✅ Automated on push/PR

---

### 2. Mythril (Symbolic Execution)
- **Type**: Symbolic execution
- **Speed**: Slower (deep analysis)
- **Coverage**: Explores all execution paths
- **Best for**: Deep vulnerability detection

**Setup**: See `MYTHRIL_SETUP.md`

**Run**:
```bash
# Install first
pip install mythril

# Then run
cd contracts
npm run compile
npm run audit:mythril
```

**GitHub Actions**: ✅ Automated on push/PR

**Note**: Windows requires Visual C++ Build Tools. Use WSL or GitHub Actions.

---

## Quick Start

### Run All Audits

```bash
cd contracts

# 1. Compile contracts
npm run compile

# 2. Run Aderyn (Linux/macOS/WSL)
aderyn

# 3. Run Mythril
npm run audit:mythril
```

### View Reports

- **Aderyn**: `contracts/report.md`
- **Mythril**: `contracts/reports/mythril-*.md`

## Automated Audits

Both tools run automatically via GitHub Actions:
- On push to `main`, `staging`, `development`
- On pull requests
- Reports uploaded as artifacts
- PR comments with findings

## Severity Levels

Both tools classify findings by severity:

- **Critical/High**: Must fix before deployment
- **Medium**: Should fix, significant risk
- **Low**: Consider fixing, minor risk
- **Informational**: Best practices, code quality

## Best Practices

1. **Run before deployment**: Always audit before deploying to mainnet
2. **Fix critical/high issues**: Address serious vulnerabilities immediately
3. **Review manually**: Not all findings are actual vulnerabilities
4. **Combine tools**: Use multiple tools for comprehensive coverage
5. **Document decisions**: If choosing not to fix, document why

## Workflow

```
1. Make contract changes
2. Compile contracts (npm run compile)
3. Run Aderyn (aderyn)
4. Run Mythril (npm run audit:mythril)
5. Review all findings
6. Fix critical/high issues
7. Re-run audits to verify fixes
8. Deploy only after all critical issues resolved
```

## Resources

- [Aderyn GitHub](https://github.com/Cyfrin/aderyn)
- [Mythril GitHub](https://github.com/ConsenSys/mythril)
- [SWC Registry](https://swcregistry.io/) - Smart Contract Weakness Classification

