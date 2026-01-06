# Branch Strategy

This document outlines the Git branch strategy for TiltVault production deployments.

## Branch Overview

### Main Branches

#### `production` (Primary Production Branch)
- **Purpose**: What's live in production, always deployable
- **Status**: Protected - only merges from `staging` after thorough testing
- **Deployment**: Auto-deploys to production environment
- **Rules**:
  - Never commit directly to `production`
  - Only merge from `staging` via pull requests
  - All merges require code review
  - Tag releases (e.g., `v11-live`, `v12-live`) from this branch

#### `main` (Legacy/Alternative Production)
- **Purpose**: Historical main branch (kept for compatibility)
- **Status**: May be used as alternative production branch
- **Note**: Consider `production` as the primary production branch going forward

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
Feature Branch → development → staging → production
```

1. **Create Feature Branch**
   ```bash
   git checkout development
   git pull origin development
   git checkout -b feature/your-feature-name
   ```

2. **Develop & Commit**
   - Make changes
   - Commit with clear messages
   - Push to remote

3. **Merge to Development**
   ```bash
   git checkout development
   git merge feature/your-feature-name
   git push origin development
   ```

4. **Merge to Staging** (when ready for testing)
   ```bash
   git checkout staging
   git merge development
   git push origin staging
   ```

5. **Merge to Production** (after testing passes)
   ```bash
   git checkout production
   git merge staging
   git push origin production
   git tag v12-live  # Tag the release
   git push origin v12-live
   ```

### Hotfix Flow

For urgent production fixes:

```
Hotfix Branch → production → staging → development
```

1. **Create Hotfix Branch from Production**
   ```bash
   git checkout production
   git pull origin production
   git checkout -b hotfix/urgent-fix-name
   ```

2. **Fix & Test**
   - Make the fix
   - Test thoroughly
   - Commit and push

3. **Merge to Production**
   ```bash
   git checkout production
   git merge hotfix/urgent-fix-name
   git push origin production
   git tag v11.1-hotfix
   git push origin v11.1-hotfix
   ```

4. **Backport to Staging & Development**
   ```bash
   git checkout staging
   git merge production
   git push origin staging
   
   git checkout development
   git merge production
   git push origin development
   ```

## Branch Protection Rules (Recommended)

Set up branch protection on GitHub for:

### `production`
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
- Created from: `production` branch
- Purpose: Mark stable production releases

### Hotfixes
- Format: `v{version}.{patch}-hotfix` (e.g., `v11.1-hotfix`)
- Created from: `production` branch
- Purpose: Mark urgent production fixes

## Environment Mapping

| Branch      | Environment | URL                    | Purpose           |
|-------------|-------------|------------------------|-------------------|
| `production`| Production  | https://www.tiltvault.com | Live user-facing |
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
# Switch to production
git checkout production
git pull origin production

# Create feature branch
git checkout development
git pull origin development
git checkout -b feature/new-feature

# Merge feature to development
git checkout development
git merge feature/new-feature
git push origin development

# Promote to staging
git checkout staging
git merge development
git push origin staging

# Promote to production
git checkout production
git merge staging
git push origin production
git tag v12-live
git push origin v12-live
```

## Migration Notes

- `exact-deployed-version` branch contains the current production code
- `production` branch has been synced with `exact-deployed-version`
- Going forward, use `production` as the primary production branch
- Consider deprecating `exact-deployed-version` after confirming `production` is working correctly

