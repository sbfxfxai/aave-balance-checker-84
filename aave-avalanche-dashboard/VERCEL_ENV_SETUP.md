# Vercel Environment Variables Setup for Square Payments

## Required Environment Variables

### Frontend (Vite Environment Variables)
Set these in Vercel Dashboard → Settings → Environment Variables:

```
VITE_SQUARE_APPLICATION_ID=sq0idp-r5ABvzQQx9LYRH-JHO_xCw
VITE_SQUARE_LOCATION_ID=LA09STPQW6HC0
VITE_SQUARE_ENVIRONMENT=production
VITE_SQUARE_API_URL=https://connect.squareup.com
```

**Available Locations:**
- `LA09STPQW6HC0` - Sakage Express (currently in use)
- `6PA5SZ9GE68E0` - Sakage Columbia (Main)

**Note:** `VITE_SQUARE_ACCESS_TOKEN` should NOT be set in frontend (security risk - tokens should only be in backend)

### Backend (Serverless Function Environment Variables)
Set these in Vercel Dashboard → Settings → Environment Variables:

```
SQUARE_ACCESS_TOKEN=EAAAlygTphTRCrNzZ8GoYXNPWp1ipsp9kp3qArPdqAb9tReNEgCw8TNDr1rvAC-M
SQUARE_LOCATION_ID=LA09STPQW6HC0
SQUARE_API_BASE_URL=https://connect.squareup.com
SQUARE_ENVIRONMENT=production
```

**Important:** Backend `SQUARE_LOCATION_ID` must match frontend `VITE_SQUARE_LOCATION_ID`

## How to Set in Vercel

1. Go to your Vercel project dashboard
2. Click **Settings** → **Environment Variables**
3. Add each variable above
4. Make sure to select **Production**, **Preview**, and **Development** environments as needed
5. **Redeploy** your application for changes to take effect

## Testing $1.00 Payment Flow

1. **Open your live app** (e.g., `https://your-app.vercel.app`)
2. **Navigate to Stack App** → Deposit
3. **Select USD deposit** → Enter `1.00`
4. **Click "Continue to Payment"**
5. **Enter card details** in Square payment form:
   - Card: `4111 1111 1111 1111` (test card)
   - CVV: Any 3 digits
   - Expiry: Any future date
6. **Click "Pay $1.00"**
7. **Check browser console** for payment token generation
8. **Check Vercel function logs** for payment processing

## Troubleshooting

### Payment Form Not Showing
- Check browser console for Square SDK loading errors
- Verify `VITE_SQUARE_APPLICATION_ID` is set correctly
- Check CSP headers allow Square CDN

### Payment Token Generated But Payment Fails
- Check Vercel function logs: **Functions** → `api/square/index` → **Logs**
- Verify backend environment variables are set
- Check for CORS errors in browser console

### 404 Error on Payment Endpoint
- Verify `vercel.json` routing is correct
- Check that `api/square/index.py` exists
- Redeploy after setting environment variables

## Verification

After setting environment variables, verify:

1. **Frontend Health Check:**
   - Open browser console
   - Look for: `[Square] Configuration loaded - Environment: production`

2. **Backend Health Check:**
   ```bash
   curl https://your-app.vercel.app/api/square/health
   ```
   Should return: `"credentials_configured": true`
