# Vercel Deployment Checklist for Square Payments

## ✅ Backend Deployment Status
Your backend is deployed to Vercel. Here's what to verify:

## Environment Variables Required in Vercel

### Backend Environment Variables:
Go to Vercel Dashboard → Your Project → Settings → Environment Variables

**Required:**
- `SQUARE_ACCESS_TOKEN` = `EAAAlygTphTRCrNzZ8GoYXNPWp1ipsp9kp3qArPdqAb9tReNEgCw8TNDr1rvAC-M`
- `SQUARE_LOCATION_ID` = `LA09STPQW6HC0`
- `SQUARE_API_BASE_URL` = `https://connect.squareup.com`

### Frontend Environment Variables:
**Required:**
- `VITE_SQUARE_APPLICATION_ID` = `sq0idp-r5ABvzQQx9LYRH-JHO_xCw`
- `VITE_SQUARE_LOCATION_ID` = `LA09STPQW6HC0`
- `VITE_SQUARE_ENVIRONMENT` = `production`

**Optional (if backend is on different domain):**
- `VITE_API_BASE_URL` = Leave empty (uses same origin automatically)

## Testing the Backend Endpoint

### 1. Test Backend Health:
```bash
curl https://your-app.vercel.app/
```

Should return:
```json
{
  "name": "Aave V3 Dashboard",
  "chain": "Avalanche",
  "chain_id": 43114,
  "rpc_url": "..."
}
```

### 2. Test Square Endpoint:
```bash
curl -X POST https://your-app.vercel.app/api/square/process-payment \
  -H "Content-Type: application/json" \
  -d '{
    "source_id": "test-token",
    "amount": 1.00,
    "currency": "USD",
    "risk_profile": "conservative",
    "idempotency_key": "test-123"
  }'
```

**Expected Response:**
- If credentials missing: `500` error with message about credentials
- If credentials set: Will attempt to call Square API (may fail with invalid token, but endpoint works)

## Current Code Behavior

The frontend code now:
- ✅ Uses `window.location.origin` in production (same domain as frontend)
- ✅ Uses `localhost:8000` in development
- ✅ Can be overridden with `VITE_API_BASE_URL` env var

## Troubleshooting

### Issue: "NetworkError when attempting to fetch resource"

**Possible Causes:**
1. Backend not deployed or not accessible
2. Environment variables not set in Vercel
3. CORS issue (shouldn't happen if same origin)

**Solutions:**
1. Check Vercel deployment logs
2. Verify environment variables are set
3. Test backend endpoint directly with curl
4. Check browser console for exact error

### Issue: "Square API credentials not configured on server"

**Solution:**
- Set `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` in Vercel environment variables
- Redeploy backend

### Issue: Backend endpoint returns 404

**Solution:**
- Check `vercel.json` routing configuration
- Ensure `/api/square/process-payment` route is correct
- Verify backend is deployed and running

## Quick Test

1. Open browser console on your deployed site
2. Try making a payment
3. Check Network tab for the request to `/api/square/process-payment`
4. Check console for any errors

If you see the request going to the correct URL but getting an error, share the error message and I can help debug further.

