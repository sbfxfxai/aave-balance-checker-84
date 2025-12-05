# Fix: Remove localhost from Vercel Environment Variables

## Problem
The app is using `localhost:8000` because `VITE_API_BASE_URL` is set to `http://localhost:8000` in Vercel.

## Solution

### Option 1: Remove VITE_API_BASE_URL (Recommended)
1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. **DELETE** or **REMOVE** the `VITE_API_BASE_URL` variable
3. The code will automatically use the same origin (your Vercel URL)

### Option 2: Set VITE_API_BASE_URL to Production URL
If you need to keep it, set it to your production URL:
```
VITE_API_BASE_URL=https://aave-balance-checker-84.vercel.app
```

## What Changed in Code

The code now:
- ✅ **Always uses same origin in production** (never localhost)
- ✅ **Ignores localhost VITE_API_BASE_URL** if set in production
- ✅ **Only uses localhost** when actually running on localhost
- ✅ **Warns** if localhost is detected in production

## After Fixing

1. Remove `VITE_API_BASE_URL` from Vercel (or set to production URL)
2. Redeploy
3. Test payment - should now use `https://aave-balance-checker-84.vercel.app/api/square/process-payment`

## Current Behavior

- **Production (Vercel)**: Always uses same origin, ignores localhost overrides
- **Development (localhost)**: Uses `http://localhost:8000` for backend

