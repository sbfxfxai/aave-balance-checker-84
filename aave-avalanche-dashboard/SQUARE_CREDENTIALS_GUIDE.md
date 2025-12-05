# Square Credentials Guide - OAuth vs Access Token

## ❌ You DON'T Need OAuth

**OAuth is only needed if:**
- You're building a marketplace/multi-tenant app
- Different merchants need to authorize your app
- You need to access multiple Square accounts

**For a single-merchant app (like yours):**
- ✅ Use **Access Token** directly
- ✅ No OAuth flow needed

## ✅ What You Actually Need

### 1. Access Token (Backend - Server-Side Only)

**Where to get it:**
1. Go to [Square Developer Dashboard](https://developer.squareup.com/apps)
2. Select your app
3. Go to **Credentials** tab
4. Under **Production** or **Sandbox**, find **Access Token**
5. Copy the token (starts with `EAAA...`)

**Set in Vercel:**
```
SQUARE_ACCESS_TOKEN = EAAAlygTphTRCrNzZ8GoYXNPWp1ipsp9kp3qArPdqAb9tReNEgCw8TNDr1rvAC-M
```

### 2. Application ID (Frontend - Public, Safe to Expose)

**You already have this:**
```
VITE_SQUARE_APPLICATION_ID = sq0idp-r5ABvzQQx9LYRH-JHO_xCw
```

This is used by the Square Web Payments SDK to initialize the payment form.

### 3. Location ID (Both Frontend and Backend)

**Get it from:**
1. Square Developer Dashboard → Your App → **Locations**
2. Copy the Location ID (starts with `LA...`)

**Set in Vercel:**
```
SQUARE_LOCATION_ID = LA09STPQW6HC0
VITE_SQUARE_LOCATION_ID = LA09STPQW6HC0
```

## Complete Vercel Environment Variables

### Backend (Server-Side):
```
SQUARE_ACCESS_TOKEN = EAAAlygTphTRCrNzZ8GoYXNPWp1ipsp9kp3qArPdqAb9tReNEgCw8TNDr1rvAC-M
SQUARE_LOCATION_ID = LA09STPQW6HC0
SQUARE_API_BASE_URL = https://connect.squareup.com
SQUARE_ENVIRONMENT = production
```

### Frontend (Client-Side):
```
VITE_SQUARE_APPLICATION_ID = sq0idp-r5ABvzQQx9LYRH-JHO_xCw
VITE_SQUARE_LOCATION_ID = LA09STPQW6HC0
VITE_SQUARE_ENVIRONMENT = production
```

## About OAuth Application Secret

The **OAuth Application Secret** (`sq0csp-bSjPx_zMgo_6uJnydkfQuuYJQZV2uE4G3QoFAj4yOvs`) is:
- ❌ **NOT needed** for your current setup
- ✅ Only needed if you implement OAuth flow (multi-tenant app)
- ✅ Keep it secret, but you don't need to set it in Vercel

## How to Verify Your Access Token

1. **Test the health endpoint:**
   ```bash
   curl https://your-app.vercel.app/api/square/health
   ```

2. **Expected response:**
   ```json
   {
     "status": "healthy",
     "credentials_configured": true
   }
   ```

3. **If `credentials_configured: false`:**
   - Access Token or Location ID is missing in Vercel
   - Redeploy after setting environment variables

## Summary

- ✅ **Access Token** = What you need (get from Square Dashboard)
- ✅ **Application ID** = What you have (for SDK initialization)
- ❌ **OAuth Secret** = Not needed (only for OAuth flow)
- ✅ **Location ID** = What you need (get from Square Dashboard)

