# Security Policy

## Supported Versions

We actively support and provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| v6.x    | :white_check_mark: |
| v5.x    | :white_check_mark: |
| < v5    | :x:                |

## Reporting a Vulnerability

**⚠️ IMPORTANT: Do not report security vulnerabilities through public GitHub issues.**

### How to Report

If you discover a security vulnerability, please report it through one of the following channels:

1. **Email (Preferred)**: security@tiltvault.com
2. **GitHub Security Advisory**: Use the "Report a vulnerability" button on the Security tab

### What to Include

When reporting a vulnerability, please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)
- Your contact information

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution**: Depends on severity (see below)

### Severity Levels

#### Critical
- **Response Time**: Immediate
- **Resolution Target**: 24-48 hours
- **Examples**: 
  - Funds at risk
  - Private key exposure
  - Unauthorized access to user accounts
  - Smart contract vulnerabilities

#### High
- **Response Time**: Within 24 hours
- **Resolution Target**: 1 week
- **Examples**:
  - Data exposure
  - Authentication bypass
  - Payment processing issues

#### Medium
- **Response Time**: Within 48 hours
- **Resolution Target**: 2 weeks
- **Examples**:
  - Information disclosure
  - CSRF vulnerabilities
  - XSS vulnerabilities

#### Low
- **Response Time**: Within 1 week
- **Resolution Target**: 1 month
- **Examples**:
  - Minor information leaks
  - Best practice violations

## Security Best Practices

### For Users

1. **Never share your private keys or seed phrases**
2. **Always verify transaction details before confirming**
3. **Use hardware wallets for large amounts**
4. **Keep your software updated**
5. **Be cautious of phishing attempts**

### For Developers

1. **Follow secure coding practices**
2. **Never commit secrets or private keys**
3. **Use environment variables for sensitive data**
4. **Review all dependencies for vulnerabilities**
5. **Run security tests before deploying**

## Responsible Disclosure

We follow responsible disclosure practices:

1. **Do not publicly disclose vulnerabilities** until they are fixed
2. **Allow reasonable time** for us to address the issue
3. **Work with us** to coordinate disclosure timing
4. **Credit will be given** to security researchers who responsibly report vulnerabilities

## Security Updates

Security updates will be:

- Released as soon as possible after fixing
- Documented in release notes
- Tagged with security labels
- Communicated to affected users

## Bug Bounty

Currently, we do not have a formal bug bounty program. However, we appreciate responsible disclosure and may provide recognition or rewards for significant security findings.

## Contact

For security-related questions or concerns:

- **Email**: security@tiltvault.com
- **GitHub**: Use the Security tab to report vulnerabilities

## Acknowledgments

We thank the security researchers and community members who help keep TiltVault secure through responsible disclosure.

