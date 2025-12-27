# TiltVault Production Deployment Checklist

## Pre-Launch Setup

### 1. Cash App Pay Setup
- [x] Cash App integration code complete
- [ ] Get Cash App Partner credentials from Square
  - Visit: https://developer.squareup.com/apps
  - Apply for Cash App Pay access
- [ ] Create Brand ID via API
- [ ] Create Merchant ID via API
- [ ] Test in sandbox environment
- [ ] Switch to production credentials

### 2. Environment Variables
Create these in Vercel Dashboard:

```bash
# Square/Cash App
SQUARE_ACCESS_TOKEN=sq0atp-xxx
SQUARE_WEBHOOK_SIGNATURE_KEY=whsec_xxx
CASHAPP_ENVIRONMENT=production
CASHAPP_API_CREDENTIALS=your_credentials
CASHAPP_CLIENT_ID=your_client_id
CASHAPP_BRAND_ID=your_brand_id
CASHAPP_MERCHANT_ID=your_merchant_id

# Avalanche
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc

# API
VITE_API_URL=https://tiltvault.com

# Database (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=xxx
```

### 3. Hub Wallet Setup (if needed for automated operations)
```bash
# Generate hub wallet
node -e "
  const { ethers } = require('ethers');
  const wallet = ethers.Wallet.createRandom();
  console.log('Address:', wallet.address);
  console.log('Private Key:', wallet.privateKey);
"

# Fund with AVAX for gas (~1 AVAX)
```

---

## Deployment Steps

### Step 1: Deploy Backend
```bash
cd tiltvault/aave-avalanche-dashboard
vercel --prod

# Verify deployment
curl https://tiltvault.com/api/health
```

### Step 2: Setup Webhooks
1. **Square Payment Webhook**
   - URL: `https://tiltvault.com/api/square/webhook`
   - Events: `payment.created`

2. **Cash App Webhook** (when available)
   - URL: `https://tiltvault.com/api/cashapp/webhook`
   - Events: `customer_request.approved`, `payment.completed`

### Step 3: Test Payment Flow
```bash
# Test deposit flow with Square sandbox
# Verify in Vercel logs
vercel logs --prod
```

### Step 4: Test Withdrawal Flow
```bash
# Test AAVE → Cash App withdrawal
# Use sandbox Cash App credentials
```

---

## Architecture Overview

### Complete Flow Diagram
```
USER DEPOSITS:
Square Payment → Webhook → USDC Purchase → AAVE/GMX Deposit
                                        ↓
                                 User's Wallet

USER WITHDRAWS:
Dashboard → Select Amount → Withdraw from AAVE/GMX → Convert to USD → Cash App
    ↓
Login with Email → Decrypt Key → Execute Transactions
```

### File Structure
```
tiltvault/aave-avalanche-dashboard/
├── api/
│   ├── accounts/
│   │   └── link.ts              # Email-wallet linking
│   ├── square/
│   │   ├── webhook.ts           # Payment processing
│   │   └── process-payment.py   # Payment handler
│   ├── cashapp/
│   │   ├── config.ts            # Cash App config
│   │   ├── customer-request.ts  # Link Cash App
│   │   ├── payment.ts           # Send payment
│   │   └── withdraw.ts          # Simple withdrawal
│   └── withdraw/
│       └── complete-flow.ts     # Full DeFi→Cash flow
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── WalletConnect.tsx      # Login/connect
│       │   ├── CashAppWithdraw.tsx    # Simple withdraw UI
│       │   └── IntegratedWithdraw.tsx # Full withdraw UI
│       └── pages/
│           └── UserDashboard.tsx      # Main dashboard
└── DEPLOYMENT_CHECKLIST.md
```

---

## Security Checklist

- [ ] Private keys encrypted at rest (user password)
- [ ] Session tokens expire after 24 hours
- [ ] Webhook signature verification enabled
- [ ] Rate limiting on API endpoints
- [ ] HTTPS enforced on all endpoints
- [ ] CORS configured properly
- [ ] Environment variables not exposed to frontend
- [ ] User passwords hashed properly

---

## Testing Checklist

### Test Deposit Flow
- [ ] Small payment ($10) → AAVE deposit
- [ ] Medium payment ($100) → GMX position
- [ ] Failed payment handling
- [ ] Webhook retry logic

### Test Withdrawal Flow
- [ ] AAVE withdrawal → Cash App (first time user)
- [ ] AAVE withdrawal → Cash App (returning user)
- [ ] GMX position close → Cash App
- [ ] Partial withdrawal
- [ ] Full withdrawal
- [ ] Failed Cash App link handling

### Test Authentication
- [ ] Account creation via email
- [ ] Login with existing email
- [ ] Session management
- [ ] Wallet connection

---

## Monitoring Setup

### Key Metrics to Track
1. **Transaction Volume**
   - Daily deposits
   - Daily withdrawals
   - Average transaction size

2. **Success Rates**
   - Payment success rate
   - AAVE deposit success rate
   - Cash App withdrawal success rate

3. **User Engagement**
   - New signups
   - Active users
   - Retention rate

### Alerts to Set Up
- Failed transaction rate > 5%
- Webhook delivery failures
- API error rate spike

---

## Post-Launch Tasks

### Week 1
- [ ] Monitor all transactions
- [ ] Check webhook delivery rates
- [ ] Verify Cash App settlements
- [ ] Collect user feedback
- [ ] Fix any critical bugs

### Week 2
- [ ] Add transaction history page
- [ ] Optimize gas usage
- [ ] Add email notifications
- [ ] Create help documentation

### Month 1
- [ ] Add 2FA authentication
- [ ] Implement referral program
- [ ] Add more DeFi strategies
- [ ] Create mobile app (optional)

---

## Legal & Compliance

### Required Licenses (US)
- [ ] Money Transmitter License (state-by-state) - consult legal
- [ ] FinCEN registration (if handling >$1000/day)
- [ ] State-specific crypto licenses

### Terms of Service Must Include
- Non-custodial nature of service
- Risk disclaimers for DeFi
- Privacy policy
- Data retention policy

---

## Emergency Procedures

### If Cash App Integration Fails
1. Notify affected users
2. Process manual refunds if needed
3. Contact Square support

### If Database Goes Down
1. All sessions invalidated
2. Users must re-login
3. Transaction history preserved in logs

---

## Future: React Native Mobile App

If building a mobile app with Cash App Pay integration:

### iOS Configuration (info.plist)
```xml
<key>LSApplicationQueriesSchemes</key>
<array> 
    <string>cashme</string>
</array>
```

### Android Configuration (AndroidManifest.xml)
```xml
<queries>
    <intent>  
        <action android:name="android.intent.action.VIEW" /> 
            <data 
                android:host="*" 
                android:scheme="cashme" /> 
    </intent> 
</queries>
```

This allows the app to detect and deeplink to Cash App for the mobile payment flow.

---

## Support Resources

### Documentation
- Square Developer: https://developer.squareup.com
- Cash App Pay: https://developer.squareup.com/docs/cash-app-pay
- AAVE Docs: https://docs.aave.com
- GMX Docs: https://gmx-docs.io
- Avalanche Docs: https://docs.avax.network

---

## Ready to Launch?

✅ All environment variables set
✅ Webhooks configured
✅ Tests passing
✅ Security review complete
✅ Monitoring in place

**Deploy command:**
```bash
vercel --prod
```

**Post-deployment verification:**
```bash
# Health check
curl https://tiltvault.com/api/health

# Test API
curl https://tiltvault.com/api/accounts/link -X POST \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "walletAddress": "0x..."}'
```

🚀 **You're ready to launch TiltVault!**
