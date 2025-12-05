# Fixing 404 NOT_FOUND Error

## Current Issue
Getting `404 NOT_FOUND` when calling `/api/square/process-payment`. This means Vercel can't find the serverless function.

## Root Cause
The function needs to be **redeployed** after code changes. Vercel doesn't automatically detect new functions or changes to existing ones.

## Solution: Redeploy to Vercel

### Option 1: Via Git (Recommended)
```bash
git add .
git commit -m "Fix Square API handler - ensure handler is always exported"
git push
```
Vercel will automatically deploy on push.

### Option 2: Via Vercel CLI
```bash
cd aave-avalanche-dashboard
vercel --prod
```

### Option 3: Via Vercel Dashboard
1. Go to https://vercel.com/dashboard
2. Select your project: `aave-balance-checker-84`
3. Click **Deployments** → **Redeploy** (or trigger a new deployment)

## Verification Steps

### 1. Check Function is Deployed
After deployment, go to:
- Vercel Dashboard → Your Project → **Functions** tab
- Look for `api/square/index.py`
- Should show as **Active** with recent deployment time

### 2. Test Health Endpoint
```bash
curl https://aave-balance-checker-84.vercel.app/api/square/health
```

**Expected:** JSON response with status "healthy"
**If 404:** Function not deployed or routing issue

### 3. Check Build Logs
In Vercel Dashboard → Deployments → Latest:
- Look for: `Building Python function: api/square/index.py`
- Should show: `Successfully built Python function`
- Check for any errors (red text)

### 4. Check Function Logs
In Vercel Dashboard → Functions → `api/square/index.py` → Logs:
- Should see: `[Square API] Initializing...`
- Should see: `[Square API] ✓ Handler created successfully`
- If you see errors, they'll show what's wrong

## Common Issues

### Issue: Function Not Found After Deployment
**Cause:** Build failed or function file not detected
**Fix:** 
1. Check build logs for errors
2. Verify `api/square/index.py` exists
3. Verify `vercel.json` points to correct path

### Issue: Handler Not Defined
**Cause:** Exception during initialization
**Fix:** Check function logs for initialization errors

### Issue: Routing Not Working
**Cause:** `vercel.json` rewrite rule incorrect
**Fix:** Verify rewrite rule:
```json
{
  "source": "/api/square/:path*",
  "destination": "/api/square/index"
}
```

## Current Configuration

### File Structure
```
aave-avalanche-dashboard/
├── api/
│   └── square/
│       └── index.py          ← Handler file
├── vercel.json               ← Points to api/square/index.py
└── requirements.txt          ← Python dependencies
```

### vercel.json Configuration
```json
{
  "builds": [
    {
      "src": "api/square/index.py",
      "use": "@vercel/python"
    }
  ],
  "rewrites": [
    {
      "source": "/api/square/:path*",
      "destination": "/api/square/index"
    }
  ]
}
```

## Next Steps

1. **Redeploy** the project (see options above)
2. **Wait** for deployment to complete (check Vercel dashboard)
3. **Test** health endpoint: `curl https://aave-balance-checker-84.vercel.app/api/square/health`
4. **Test** payment endpoint via frontend
5. **Check logs** if still getting 404

## Expected Behavior After Fix

✅ Health endpoint returns 200 OK
✅ Payment endpoint returns 200 OK (or payment error, not 404)
✅ Function logs show initialization messages
✅ Function appears in Vercel Functions tab

