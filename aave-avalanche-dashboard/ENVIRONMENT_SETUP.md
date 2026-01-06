# Environment Setup Guide

This document outlines the three distinct environments for TiltVault development and deployment.

## Environment Overview

### 1. Development (Local)
- **Purpose**: Local development with fast iteration
- **Blockchain**: Local Hardhat/Anvil node or Fuji testnet
- **Hot Reload**: Enabled for rapid development
- **Config**: `.env.development`

### 2. Staging (Testnet)
- **Purpose**: Pre-production testing on testnet
- **Blockchain**: Avalanche Fuji Testnet
- **Deployment**: Vercel preview deployments
- **Config**: `.env.staging` (set in Vercel)

### 3. Production (Mainnet)
- **Purpose**: Live production environment
- **Blockchain**: Avalanche Mainnet
- **Deployment**: Vercel production
- **Config**: `.env.production` (set in Vercel)

## Quick Start

### Development Setup

1. **Install Dependencies**
   ```bash
   cd frontend
   npm install
   
   cd ../contracts
   npm install
   ```

2. **Start Local Blockchain**
   ```bash
   cd contracts
   npx hardhat node
   # Or use Anvil (Foundry)
   # anvil --fork-url https://api.avax-test.network/ext/bc/C/rpc
   ```

3. **Configure Environment**
   ```bash
   # Copy example file
   cp .env.development.example .env.development
   
   # Edit .env.development with your values
   # For local Hardhat: RPC_URL=http://localhost:8545, CHAIN_ID=31337
   # For Fuji testnet: Use testnet RPC and CHAIN_ID=43113
   ```

4. **Deploy Contracts (Local)**
   ```bash
   cd contracts
   npx hardhat run scripts/deploy.js --network hardhat
   ```

5. **Start Frontend**
   ```bash
   cd frontend
   npm run dev
   # Frontend runs on http://localhost:5173
   ```

6. **Start Backend (if needed)**
   ```bash
   # API routes are serverless (Vercel), but for local testing:
   vercel dev
   ```

### Staging Setup

1. **Configure Vercel Environment Variables**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add all variables from `.env.staging.example`
   - Set environment to "Preview" (for staging branch)

2. **Deploy to Staging**
   ```bash
   git checkout staging
   git push origin staging
   # Vercel automatically deploys staging branch
   ```

3. **Deploy Contracts to Fuji Testnet**
   ```bash
   cd contracts
   npx hardhat run scripts/deploy.js --network avalancheFuji
   ```

4. **Verify Deployment**
   - Check Vercel preview URL
   - Test all features on Fuji testnet
   - Use test tokens (available on Fuji)

### Production Setup

1. **Configure Vercel Production Environment**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Add all variables from `.env.production.example`
   - Set environment to "Production" (for main branch)

2. **Deploy to Production**
   ```bash
   git checkout main
   git merge staging  # After thorough testing
   git push origin main
   # Vercel automatically deploys main branch to production
   ```

3. **Deploy Contracts to Mainnet**
   ```bash
   cd contracts
   npx hardhat run scripts/deploy.js --network avalanche
   ```

4. **Verify Production**
   - Check production URL: https://www.tiltvault.com
   - Monitor error tracking (Sentry)
   - Check analytics (Google Analytics)

## Environment Configuration

### Development Environment

**Blockchain:**
- Local Hardhat node: `http://localhost:8545`
- Chain ID: `31337` (Hardhat default)
- Test accounts: Automatically funded by Hardhat

**Features:**
- Hot reload enabled
- Fast iteration
- Local test tokens
- Debug logging enabled

**Configuration:**
```bash
# .env.development
AVALANCHE_RPC_URL=http://localhost:8545
CHAIN_ID=31337
VITE_AVALANCHE_RPC_URL=http://localhost:8545
VITE_CHAIN_ID=31337
```

### Staging Environment

**Blockchain:**
- Avalanche Fuji Testnet: `https://api.avax-test.network/ext/bc/C/rpc`
- Chain ID: `43113`
- Test tokens: Available on Fuji faucet

**Features:**
- Mirrors production setup
- Public URL for testing
- Testnet tokens
- Full monitoring enabled

**Configuration:**
```bash
# Set in Vercel (Preview environment)
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
CHAIN_ID=43113
VITE_AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
VITE_CHAIN_ID=43113
```

### Production Environment

**Blockchain:**
- Avalanche Mainnet: `https://api.avax.network/ext/bc/C/rpc`
- Chain ID: `43114`
- Real tokens: USDC, AVAX, etc.

**Features:**
- Immutable smart contracts
- CDN for frontend
- Full monitoring and alerting
- Production-grade security

**Configuration:**
```bash
# Set in Vercel (Production environment)
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
CHAIN_ID=43114
VITE_AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
VITE_CHAIN_ID=43114
```

## Environment Variables Reference

### Required Variables

| Variable | Development | Staging | Production |
|----------|-------------|---------|------------|
| `AVALANCHE_RPC_URL` | `http://localhost:8545` | Fuji testnet | Mainnet |
| `CHAIN_ID` | `31337` | `43113` | `43114` |
| `VITE_PRIVY_APP_ID` | Dev app ID | Staging app ID | Production app ID |
| `VITE_SQUARE_APPLICATION_ID` | Sandbox | Sandbox | Production |
| `SQUARE_ENVIRONMENT` | `sandbox` | `sandbox` | `production` |

### Optional Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_API_BASE_URL` | Backend API URL | Auto-detected |
| `UPSTASH_REDIS_REST_URL` | Redis connection | Required |
| `LOG_LEVEL` | Logging level | `info` |
| `ENABLE_MONITORING` | Enable monitoring | `true` |

## Local Blockchain Setup

### Option 1: Hardhat Local Node

```bash
cd contracts
npx hardhat node
# Starts local node on http://localhost:8545
# Provides 20 test accounts with 10000 ETH each
```

### Option 2: Anvil (Foundry)

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Start Anvil with Avalanche fork
anvil --fork-url https://api.avax-test.network/ext/bc/C/rpc
```

### Option 3: Use Fuji Testnet

```bash
# No local node needed
# Just set RPC_URL to Fuji testnet
AVALANCHE_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
CHAIN_ID=43113
```

## Testing Tokens

### Development (Local Hardhat)
- Test accounts automatically funded
- Deploy test USDC contract locally
- Use Hardhat's default accounts

### Staging (Fuji Testnet)
- Get test AVAX from: https://faucet.avax.network/
- Get test USDC from Fuji testnet contracts
- Use testnet tokens for all testing

### Production (Mainnet)
- Real tokens only
- Use with caution
- Always test in staging first

## Deployment Workflow

### Development → Staging

1. Develop feature on `development` branch
2. Test locally with Hardhat/Fuji
3. Merge to `staging` branch
4. Vercel auto-deploys to preview URL
5. Test on staging environment

### Staging → Production

1. Thoroughly test on staging
2. Verify all features work
3. Check monitoring and logs
4. Merge `staging` to `main`
5. Vercel auto-deploys to production
6. Monitor production metrics

## Environment-Specific Scripts

### Development Scripts

```bash
# Start local blockchain
npm run dev:blockchain

# Start frontend with hot reload
npm run dev:frontend

# Deploy contracts locally
npm run deploy:local

# Run tests
npm run test
```

### Staging Scripts

```bash
# Deploy to staging
git push origin staging

# Deploy contracts to Fuji
npm run deploy:fuji

# Verify contracts
npm run verify:fuji
```

### Production Scripts

```bash
# Deploy to production (after testing)
git checkout main
git merge staging
git push origin main

# Deploy contracts to mainnet
npm run deploy:mainnet

# Verify contracts
npm run verify:mainnet
```

## Troubleshooting

### Development Issues

**Problem**: Can't connect to local Hardhat node
- **Solution**: Ensure Hardhat node is running on port 8545
- **Check**: `curl http://localhost:8545` should return JSON-RPC response

**Problem**: Frontend can't find contracts
- **Solution**: Deploy contracts to local network first
- **Check**: Contract addresses in deployment.json

### Staging Issues

**Problem**: Environment variables not loading
- **Solution**: Check Vercel environment variable settings
- **Check**: Ensure variables are set for "Preview" environment

**Problem**: Can't connect to Fuji testnet
- **Solution**: Check RPC URL and network configuration
- **Check**: Ensure you have testnet AVAX for gas

### Production Issues

**Problem**: Contracts not verified
- **Solution**: Run verification script with correct API key
- **Check**: Snowtrace API key is set correctly

**Problem**: Monitoring not working
- **Solution**: Check Sentry DSN and environment variables
- **Check**: Ensure monitoring is enabled in production

## Security Notes

1. **Never commit `.env` files** - Use `.env.example` files
2. **Use separate keys** for each environment
3. **Rotate keys regularly** in production
4. **Use key management services** for production secrets
5. **Enable 2FA** on all service accounts
6. **Monitor access logs** regularly

## Next Steps

1. Set up local Hardhat node for development
2. Configure Vercel environment variables for staging
3. Set up production monitoring and alerting
4. Create deployment scripts for each environment
5. Document contract addresses per environment

