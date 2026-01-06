# Branch Strategy

This document outlines the Git branch strategy for TiltVault production deployments.

## Branch Overview

### Main Branches

#### `main` (Production Branch)
- **Purpose**: What's live in production, always deployable
- **Status**: Protected - only merges from `staging` after thorough testing
- **Deployment**: Auto-deploys to production environment
- **Rules**:
  - Never commit directly to `main`
  - Only merge from `staging` via pull requests after thorough testing
  - All merges require code review
  - Tag releases (e.g., `v11-live`, `v12-live`) from this branch

#### `production` (Alternative Production Branch)
- **Purpose**: Alternative production tracking branch
- **Status**: Synced with current production code
- **Note**: `main` is the primary production branch for the standard workflow

#### `staging` (Pre-Production Testing)
- **Purpose**: Pre-production testing environment
- **Status**: Protected - merges from `development`
- **Deployment**: Deploys to staging environment for QA/testing
- **Rules**:
  - Merge from `development` when features are ready for testing
  - Run full test suite before merging to `production`
  - Used for final validation before production release

#### `development` (Feature Integration)
- **Purpose**: Where features are integrated before production
- **Status**: Active development branch
- **Deployment**: May deploy to development environment
- **Rules**:
  - Merge feature branches here
  - Run tests before merging to `staging`
  - Keep stable and deployable

### Legacy Branches

#### `exact-deployed-version`
- **Purpose**: Historical branch tracking deployed versions
- **Status**: Legacy - consider syncing with `production` and deprecating
- **Note**: Current production code is now tracked in `production` branch

## Workflow

### Feature Development Flow

```
Feature Branch → development → staging → main
```

1. **Create Feature Branch from Development**
   ```bash
   git checkout development
   git pull origin development
   git checkout -b feature/your-feature-name
   ```
   Example: `feature/new-swap-ui`, `feature/user-dashboard`, `feature/payment-integration`

2. **Develop & Commit**
   - Make changes
   - Commit with clear messages
   - Push to remote
   ```bash
   git add .
   git commit -m "feat: add new swap UI component"
   git push origin feature/your-feature-name
   ```

3. **Merge to Development** (when feature is ready)
   ```bash
   git checkout development
   git pull origin development
   git merge feature/your-feature-name
   git push origin development
   ```
   - Feature is now integrated into development
   - Run basic tests before merging

4. **Merge to Staging** (for testing environment)
   ```bash
   git checkout staging
   git pull origin staging
   git merge development
   git push origin staging
   ```
   - Deploys to staging environment
   - Run thorough testing here
   - QA validation happens in staging

5. **Merge to Main** (only after thorough testing passes)
   ```bash
   git checkout main
   git pull origin main
   git merge staging
   git push origin main
   git tag v12-live  # Tag the release
   git push origin v12-live
   ```
   - **Only merge after thorough testing in staging**
   - This deploys to production
   - Tag releases from this branch

### Hotfix Flow

For urgent production fixes:

```
Hotfix Branch → main → staging → development
```

1. **Create Hotfix Branch from Main**
   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/urgent-fix-name
   ```

2. **Fix & Test**
   - Make the fix
   - Test thoroughly
   - Commit and push

3. **Merge to Main** (urgent production fix)
   ```bash
   git checkout main
   git merge hotfix/urgent-fix-name
   git push origin main
   git tag v11.1-hotfix
   git push origin v11.1-hotfix
   ```

4. **Backport to Staging & Development**
   ```bash
   git checkout staging
   git merge main
   git push origin staging
   
   git checkout development
   git merge main
   git push origin development
   ```

## Branch Protection Rules (Recommended)

Set up branch protection on GitHub for:

### `main`
- Require pull request reviews (1+ reviewer)
- Require status checks to pass
- Require branches to be up to date
- Restrict pushes (no direct commits)
- Allow force pushes: ❌ No
- Allow deletions: ❌ No

### `staging`
- Require pull request reviews (1+ reviewer)
- Require status checks to pass
- Allow force pushes: ❌ No
- Allow deletions: ❌ No

### `development`
- Require status checks to pass
- Allow force pushes: ⚠️ Only for maintainers
- Allow deletions: ❌ No

## Tagging Strategy

### Production Releases
- Format: `v{version}-live` (e.g., `v11-live`, `v12-live`)
- Created from: `main` branch
- Purpose: Mark stable production releases

### Hotfixes
- Format: `v{version}.{patch}-hotfix` (e.g., `v11.1-hotfix`)
- Created from: `main` branch
- Purpose: Mark urgent production fixes

## Environment Mapping

| Branch      | Environment | URL                    | Purpose           |
|-------------|-------------|------------------------|-------------------|
| `main`      | Production  | https://www.tiltvault.com | Live user-facing |
| `staging`   | Staging     | https://staging.tiltvault.com | Pre-production testing |
| `development`| Development | https://dev.tiltvault.com | Feature integration |

## Best Practices

1. **Always pull before creating branches**
   ```bash
   git checkout {branch}
   git pull origin {branch}
   ```

2. **Keep branches up to date**
   - Regularly merge upstream changes
   - Rebase feature branches before merging

3. **Clear commit messages**
   - Use conventional commits format
   - Reference issue numbers
   - Describe what and why, not just what

4. **Test before merging**
   - Run tests locally
   - Check linting
   - Verify builds succeed

5. **Small, focused PRs**
   - One feature per PR
   - Easier to review and test
   - Faster to merge

6. **Document breaking changes**
   - Update CHANGELOG.md
   - Update README if needed
   - Notify team of breaking changes

## Quick Reference Commands

```bash
# Switch to main (production)
git checkout main
git pull origin main

# Create feature branch from development
git checkout development
git pull origin development
git checkout -b feature/new-feature

# Merge feature to development
git checkout development
git pull origin development
git merge feature/new-feature
git push origin development

# Promote to staging (for testing)
git checkout staging
git pull origin staging
git merge development
git push origin staging

# Promote to main (after thorough testing)
git checkout main
git pull origin main
git merge staging
git push origin main
git tag v12-live
git push origin v12-live
```

## Migration Notes

- `exact-deployed-version` branch contains the current production code
- `main` branch is the primary production branch
- `production` branch exists as an alternative tracking branch
- Going forward, use `main` as the primary production branch in the workflow
- Consider deprecating `exact-deployed-version` after confirming `main` is working correctly

## Feature Workflow Summary

**Standard Feature Development:**
1. Create feature branch from `development` (e.g., `feature/new-swap-ui`)
2. Develop and commit changes
3. Merge to `development` when ready
4. Merge to `staging` for testing environment
5. **Only merge to `main` after thorough testing passes**

**Key Principle:** Never merge to `main` without thorough testing in `staging` first.

