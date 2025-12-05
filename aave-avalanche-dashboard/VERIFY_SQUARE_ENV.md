# Square Environment Variables Verification

## Required Backend Variables (for Python API)

Based on your Vercel dashboard, verify these are set:

### ✅ Required:
- **SQUARE_ACCESS_TOKEN**: `EAAAlygTphTRCNzZ8GoYXNPWp1ipsp...` (should be set)
- **SQUARE_LOCATION_ID**: `LABISTPONSHOH` ✅ (confirmed in your dashboard)
- **SQUARE_API_BASE_URL**: `https://connect.squareup.com` ✅ (confirmed)

### ⚠️ Optional (has defaults):
- **SQUARE_ENVIRONMENT**: `production` (defaults to "production" if not set)

## Required Frontend Variables (for React/Vite)

### ✅ Confirmed in your dashboard:
- **VITE_SQUARE_APPLICATION_ID**: `sq@idp-25ABvzQQLYRH-JHO_D` ✅
- **VITE_SQUARE_LOCATION_ID**: `LABISTPONSHOH` ✅
- **VITE_SQUARE_ENVIRONMENT**: `production` ✅

## Verification Steps

1. **Check Vercel Dashboard**:
   - Go to your project → Settings → Environment Variables
   - Verify all variables above are present
   - Make sure they're set for **Production** environment

2. **Test Health Endpoint** (after deployment):
   ```bash
   curl https://aave-balance-checker-84.vercel.app/api/square/health
   ```
   
   Expected response:
   ```json
   {
     "status": "healthy",
     "credentials_configured": true,
     "has_access_token": true,
     "has_location_id": true
   }
   ```

3. **If credentials_configured is false**:
   - Check that `SQUARE_ACCESS_TOKEN` and `SQUARE_LOCATION_ID` are set
   - Make sure they're not empty strings
   - Redeploy after adding/updating variables

## New Standalone Handler

The new `api/square/index.py` handler:
- ✅ No dependencies on `app` module
- ✅ Standalone implementation
- ✅ Better error messages
- ✅ Verifies environment variables
- ✅ Returns detailed health check info

