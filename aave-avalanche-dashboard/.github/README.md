# GitHub Repository Configuration

This directory contains all GitHub-specific configuration files for automated workflows, issue templates, and repository management.

## Files Overview

### Issue Templates
- `ISSUE_TEMPLATE/bug_report.md` - Template for bug reports
- `ISSUE_TEMPLATE/feature_request.md` - Template for feature requests
- `ISSUE_TEMPLATE/security.md` - Template for security vulnerability reports

### Pull Request Template
- `PULL_REQUEST_TEMPLATE.md` - Standard PR template with checklist

### Workflows (GitHub Actions)
- `workflows/ci.yml` - Continuous Integration (linting, testing, building)
- `workflows/security.yml` - Security scanning (npm audit, CodeQL, dependency review)
- `workflows/release.yml` - Automated release creation on version tags
- `workflows/dependency-review.yml` - Dependency review for PRs

### Configuration
- `dependabot.yml` - Automated dependency updates
- `CODE_OF_CONDUCT.md` - Community code of conduct
- `CONTRIBUTING.md` - Contribution guidelines

### Root Files
- `../SECURITY.md` - Security policy and vulnerability reporting

## Setup Instructions

### 1. Enable GitHub Features

Go to repository Settings and enable:

- ✅ **Issues**: Enable (for bug tracking)
- ✅ **Wikis**: Enable (for documentation)
- ✅ **Projects**: Enable (for project management)
- ✅ **Discussions**: Optional (for community Q&A)
- ✅ **Releases**: Enable (for version management)

### 2. Configure Branch Protection

Settings → Branches → Add rule for `main`:

- ✅ Require a pull request before merging
- ✅ Require approvals (1 minimum)
- ✅ Require status checks to pass
- ✅ Require branches to be up to date
- ✅ Include administrators

### 3. Enable Security Features

Settings → Security:

- ✅ Enable dependency graph
- ✅ Enable Dependabot alerts
- ✅ Enable Dependabot security updates
- ✅ Enable Code scanning (if available)

### 4. Configure Dependabot

The `dependabot.yml` file is already configured. Dependabot will:

- Check for updates weekly (Mondays at 9 AM)
- Create PRs for security updates
- Limit to 5 open PRs per ecosystem
- Ignore major version updates for critical packages

### 5. GitHub Actions

All workflows are configured and will run automatically:

- **CI**: Runs on every push/PR (linting, testing, building)
- **Security**: Runs on push/PR and weekly (vulnerability scanning)
- **Release**: Runs when version tags are pushed (creates GitHub releases)
- **Dependency Review**: Runs on PRs (reviews dependency changes)

## Manual Steps Required

1. **Enable GitHub Actions**: Go to Settings → Actions → General → Allow all actions
2. **Set up Secrets** (if needed for CI/CD):
   - `VITE_SQUARE_APPLICATION_ID` (for build)
   - `VITE_SQUARE_API_URL` (for build)
3. **Review and merge** the initial PR with these files
4. **Test workflows** by creating a test PR

## What's Automated

✅ **Dependency Updates**: Dependabot creates PRs for security and version updates  
✅ **CI/CD**: Automatic testing and building on every push  
✅ **Security Scanning**: Weekly vulnerability scans  
✅ **Release Management**: Automatic release creation from tags  
✅ **Code Quality**: Linting and type checking  
✅ **Issue Templates**: Structured bug reports and feature requests  

## Next Steps

1. Review the configuration files
2. Adjust settings as needed for your workflow
3. Enable branch protection rules
4. Test the workflows with a sample PR
5. Monitor Dependabot PRs and security alerts

