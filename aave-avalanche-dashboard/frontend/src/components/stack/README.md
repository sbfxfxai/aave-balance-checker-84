# Stack App - Square Payment Integration

This directory contains components for the Stack App payment and deposit flow.

## Components

### `DepositModal.tsx`

Modal component for handling deposit confirmation and payment processing.

## Square API Integration

The Square integration is handled in `src/lib/square.ts` and supports:

1. **USD Deposits**: Debit card processing via Square Payments API
2. **Bitcoin Deposits**: Lightning Network payments via Square Bitcoin API

## Setup Instructions

### 1. Get Square API Credentials

1. Sign up for a Square Developer account: <https://developer.squareup.com>
2. Create a new application in the Square Developer Dashboard
3. Get your Application ID and Access Token
4. Get your Location ID from Square Dashboard

### 2. Configure Environment Variables

Create a `.env` file in the `frontend` directory:

```env
VITE_SQUARE_API_URL=https://connect.squareup.com
VITE_SQUARE_APPLICATION_ID=your_square_application_id
VITE_SQUARE_ACCESS_TOKEN=your_square_access_token
VITE_SQUARE_LOCATION_ID=your_square_location_id
VITE_SQUARE_ENVIRONMENT=sandbox  # or 'production'
```

### 3. Square Web Payments SDK (Frontend)

For production USD card payments, you'll need to integrate Square's Web Payments SDK:

```bash
npm install @square/web-sdk
```

Then update `DepositModal.tsx` to use the Square payment form instead of the placeholder implementation.

### 4. Backend Webhook Setup

Set up Square webhooks to handle payment confirmations:

1. Configure webhook endpoint in Square Developer Dashboard
2. Implement webhook handler in backend (`app/transactions/square_webhook.py`)
3. Process payments and trigger DeFi routing logic

## Payment Flow

1. User selects deposit type (USD or Bitcoin)
2. User selects risk profile
3. User enters deposit amount
4. Payment processed via Square API
5. On success, funds are routed to:
   - Aave (USDC deposits)
   - GMX (leveraged BTC positions)
   - Based on selected risk profile

## Risk Profiles

- **Conservative**: 100% USDC on Aave
- **Balanced Conservative**: 75% USDC / 25% GMX 3x BTC Long
- **Balanced**: 50% USDC / 50% GMX 3x BTC Long
- **Aggressive**: 25% USDC / 75% GMX 3x BTC Long
- **Very Aggressive**: 100% GMX 4-5x BTC Long

## Next Steps

1. Integrate Square Web Payments SDK for card payments
2. Implement Square Bitcoin API for Lightning payments
3. Create backend webhook handler for payment confirmations
4. Implement DeFi routing logic (Aave + GMX integration)
5. Add position monitoring and liquidation prevention
