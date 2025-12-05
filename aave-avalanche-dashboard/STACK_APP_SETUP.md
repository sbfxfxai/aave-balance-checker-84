# Stack App - Setup Guide

## Overview

The Stack App is a simplified DeFi leverage product that allows users to deposit USD or Bitcoin and automatically allocate funds across Aave (USDC deposits) and GMX (leveraged BTC positions) based on their risk profile.

## What's Been Built

### ✅ Frontend Components

1. **Stack App Landing Page** (`/stack` route)
   - Two deposit buttons: USD and Bitcoin
   - Five risk profile options (Conservative → Very Aggressive)
   - Clean, simple UI matching the "Robinhood for DeFi" vision

2. **Deposit Modal** (`components/stack/DepositModal.tsx`)
   - Amount input with validation
   - Risk profile summary display
   - Payment processing integration

3. **Square Integration** (`lib/square.ts`)
   - USD payment processing (Square Payments API)
   - Bitcoin payment processing (Square Bitcoin/Lightning Network)
   - Payment verification and status checking

### ✅ Routing

- Added `/stack` route to `App.tsx`
- Added "Stack App" button in main dashboard header for easy navigation

### ✅ Configuration

- Created `.env.example` with Square API configuration template
- Environment variables for Square credentials

## Next Steps to Complete Integration

### 1. Square API Setup

**Get Square Developer Account:**
1. Sign up at https://developer.squareup.com
2. Create a new application
3. Get your credentials:
   - Application ID
   - Access Token
   - Location ID

**Configure Environment Variables:**
Create `.env` file in `frontend/` directory:
```env
VITE_SQUARE_API_URL=https://connect.squareup.com
VITE_SQUARE_APPLICATION_ID=your_app_id_here
VITE_SQUARE_ACCESS_TOKEN=your_access_token_here
VITE_SQUARE_LOCATION_ID=your_location_id_here
VITE_SQUARE_ENVIRONMENT=sandbox  # Use 'production' when ready
```

### 2. Square Web Payments SDK (For Card Payments)

Install Square's frontend SDK:
```bash
cd frontend
npm install @square/web-sdk
```

Then update `DepositModal.tsx` to use Square's payment form instead of the placeholder implementation. See Square's documentation: https://developer.squareup.com/docs/web-payments/overview

### 3. Backend Webhook Handler

Create `app/transactions/square_webhook.py` to handle payment confirmations:

```python
from fastapi import APIRouter, Request, HTTPException
from squareup import Client
import hmac
import hashlib

router = APIRouter()

@router.post("/webhooks/square")
async def handle_square_webhook(request: Request):
    # Verify webhook signature
    # Process payment confirmation
    # Trigger DeFi routing logic
    pass
```

### 4. DeFi Routing Logic

After payment is confirmed, implement the routing logic:

**For each risk profile:**
- **Conservative**: 100% → Aave USDC supply
- **Balanced Conservative**: 75% → Aave USDC, 25% → GMX 3x BTC Long
- **Balanced**: 50% → Aave USDC, 50% → GMX 3x BTC Long
- **Aggressive**: 25% → Aave USDC, 75% → GMX 3x BTC Long
- **Very Aggressive**: 100% → GMX 4-5x BTC Long

**Implementation steps:**
1. Convert USD/BTC → AVAX → USDC (if needed)
2. Route to Aave (using existing `ActionModal` supply functionality)
3. Route to GMX (new GMX integration needed)
4. Open leveraged BTC positions on GMX

### 5. GMX Integration

Create GMX integration module:
- GMX contract addresses on Avalanche
- GMX position opening/closing functions
- Liquidation price monitoring
- Automatic position management

### 6. Position Monitoring & Risk Management

Implement automated monitoring:
- Track liquidation prices for all GMX positions
- Auto-deleverage if BTC drops significantly
- Rebalance positions based on volatility
- Alert users of high-risk situations

## Testing

### Local Development

1. Start the frontend:
```bash
cd frontend
npm run dev
```

2. Navigate to `http://localhost:5173/stack`

3. Test the UI flow:
   - Select deposit type (USD or Bitcoin)
   - Select risk profile
   - Enter deposit amount
   - Click "Continue to Deposit"

### Square Sandbox Testing

Use Square's sandbox environment for testing:
- Test card numbers: https://developer.squareup.com/docs/testing/test-values
- Test Bitcoin payments: Use Square's sandbox Bitcoin wallet

## File Structure

```
frontend/
├── src/
│   ├── pages/
│   │   └── StackApp.tsx          # Main landing page
│   ├── components/
│   │   └── stack/
│   │       ├── DepositModal.tsx  # Deposit confirmation modal
│   │       └── README.md         # Component documentation
│   └── lib/
│       └── square.ts             # Square API integration
├── .env.example                  # Environment variables template
└── STACK_APP_SETUP.md           # This file
```

## Important Notes

1. **Existing Functions Preserved**: The 5 core Aave functions (swap, supply, withdraw, borrow, repay) in `ActionModal.tsx` are untouched.

2. **Square Fees**: 
   - USD: ~2.9% + $0.30 per transaction
   - Bitcoin: Free until 2026, then 1% from January 2027

3. **Minimum Deposits**:
   - USD: $100 minimum (to cover gas fees)
   - Bitcoin: 0.001 BTC minimum

4. **Regulatory Considerations**:
   - Structure as non-custodial interface
   - Clear disclaimers about risks
   - Consider geofencing for compliance

## Resources

- Square Developer Docs: https://developer.squareup.com/docs
- Square Payments API: https://developer.squareup.com/docs/payments-api/overview
- Square Bitcoin API: https://developer.squareup.com/docs/bitcoin-api
- GMX Docs: https://docs.gmx.io/
- Aave V3 Docs: https://docs.aave.com/developers/

## Support

For issues or questions:
1. Check Square API status: https://status.squareup.com
2. Review Square API logs in Developer Dashboard
3. Check browser console for frontend errors

