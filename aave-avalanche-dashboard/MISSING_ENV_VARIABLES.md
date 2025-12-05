# Missing Environment Variables for Square Payments

## Add These to Vercel Environment Variables

### Backend Environment Variables (Server-Side)

These are **NOT** visible in your current list. Add them:

1. **SQUARE_ACCESS_TOKEN**
   - Value: `EAAAlygTphTRCrNzZ8GoYXNPWp1ipsp9kp3qArPdqAb9tReNEgCw8TNDr1rvAC-M`
   - Environment: Production (and Preview/Development if needed)
   - **Important**: This is server-side only, not exposed to frontend

2. **SQUARE_LOCATION_ID**
   - Value: `LA09STPQW6HC0`
   - Environment: Production (and Preview/Development if needed)

3. **SQUARE_API_BASE_URL**
   - Value: `https://connect.squareup.com`
   - Environment: Production (and Preview/Development if needed)
   - Optional (has default, but good to set explicitly)

### Frontend Environment Variables (Client-Side)

These are **NOT** visible in your current list. Add them:

4. **VITE_SQUARE_APPLICATION_ID**
   - Value: `sq0idp-r5ABvzQQx9LYRH-JHO_xCw`
   - Environment: Production (and Preview/Development if needed)

5. **VITE_SQUARE_LOCATION_ID**
   - Value: `LA09STPQW6HC0`
   - Environment: Production (and Preview/Development if needed)

6. **VITE_SQUARE_ENVIRONMENT**
   - Value: `production`
   - Environment: Production (and Preview/Development if needed)

## Summary

**Add 6 new environment variables:**
- 3 backend (SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_API_BASE_URL)
- 3 frontend (VITE_SQUARE_APPLICATION_ID, VITE_SQUARE_LOCATION_ID, VITE_SQUARE_ENVIRONMENT)

## After Adding

1. **Redeploy** your Vercel project (or wait for auto-deploy)
2. **Test** the `/api/square/health` endpoint to verify backend credentials
3. **Try** a payment to verify everything works

## Notes

- `VITE_API_BASE_URL` is **NOT needed** - code uses same origin automatically
- Backend variables are server-side only (secure)
- Frontend variables are public (safe to expose)

