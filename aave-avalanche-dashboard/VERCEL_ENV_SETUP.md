# Vercel Environment Variables Setup

## Backend Environment Variables (Required)

In Vercel Dashboard → Your Project → Settings → Environment Variables:

### Production Environment:
```
SQUARE_ACCESS_TOKEN = EAAAlygTphTRCrNzZ8GoYXNPWp1ipsp9kp3qArPdqAb9tReNEgCw8TNDr1rvAC-M
SQUARE_LOCATION_ID = LA09STPQW6HC0
SQUARE_API_BASE_URL = https://connect.squareup.com
```

## Frontend Environment Variables (Required)

### Production Environment:
```
VITE_SQUARE_APPLICATION_ID = sq0idp-r5ABvzQQx9LYRH-JHO_xCw
VITE_SQUARE_LOCATION_ID = LA09STPQW6HC0
VITE_SQUARE_ENVIRONMENT = production
```

**Note:** `VITE_API_BASE_URL` is NOT needed - the code automatically uses the same origin in production.

## How It Works

1. **Frontend** calls: `https://your-app.vercel.app/api/square/process-payment`
2. **Vercel routing** (via `vercel.json`) sends `/api/*` requests to `app/main.py`
3. **Backend** processes payment using Square API
4. **Response** sent back to frontend

## Testing

After setting environment variables and redeploying:

1. Open your deployed site
2. Go to Stack App
3. Try a $1 deposit
4. Check browser console for:
   - `[Square] Calling backend payment endpoint:` - should show your Vercel URL
   - Any error messages

## Troubleshooting

### "Cannot reach backend" error:
- Check Vercel deployment logs
- Verify backend is deployed (check `/api/square/process-payment` endpoint)
- Ensure `vercel.json` routing is correct

### "Square API credentials not configured" error:
- Verify `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` are set in Vercel
- Redeploy after setting environment variables

### CORS errors:
- Shouldn't happen if backend is on same domain
- If using different domain, set `VITE_API_BASE_URL` to backend URL

