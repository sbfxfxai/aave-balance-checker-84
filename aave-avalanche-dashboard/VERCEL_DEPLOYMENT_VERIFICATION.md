# Vercel Deployment Verification Checklist

## ✅ Current Configuration Status

### Files Verified:
- ✅ `api/square/index.py` - Exists and configured correctly
- ✅ `app/square/endpoints.py` - Router with `/api/square` prefix
- ✅ `vercel.json` - Routes configured: `/api/square/(.*)` → `/api/square/index.py`
- ✅ `requirements.txt` - Includes: fastapi, mangum, requests, pydantic

### Configuration Details:

**vercel.json:**
```json
{
  "version": 2,
  "builds": [
    {
      "src": "api/**/*.py",
      "use": "@vercel/python",
      "config": {
        "maxLambdaSize": "15mb",
        "runtime": "python3.9"
      }
    }
  ],
  "routes": [
    {
      "src": "/api/square/(.*)",
      "dest": "/api/square/index.py"
    }
  ]
}
```

**api/square/index.py:**
- Uses Mangum adapter ✓
- Includes CORS middleware ✓
- Imports router from `app.square.endpoints` ✓
- Has debug logging ✓

## 🔍 Diagnostic Steps

### Step 1: Verify Function is Deployed

**In Vercel Dashboard:**
1. Go to **Your Project** → **Functions**
2. Look for `api/square/index.py`
3. **Expected:** Function should appear in the list
4. **If missing:** Function isn't being detected by Vercel

### Step 2: Check Build Logs

**In Vercel Dashboard → Deployments → Latest:**

Look for these messages:
- ✅ `Building Python function: api/square/index.py`
- ✅ `Successfully built Python function`
- ❌ `ModuleNotFoundError` → Missing dependency
- ❌ `ImportError` → Import path issue
- ❌ `FileNotFoundError` → File doesn't exist

### Step 3: Check Function Logs

**In Vercel Dashboard → Functions → `api/square/index.py` → Logs:**

Look for:
- `[Square API] Project root: ...`
- `[Square API] Successfully imported dependencies`
- `[Square API] Registered routes: ...`
- `[Square API] Handler initialized successfully`

**If you see these:** Function is loading correctly
**If you don't see these:** Function isn't being called or is failing during import

### Step 4: Test Endpoints

```bash
# Test health endpoint
curl https://aave-balance-checker-84.vercel.app/api/square/health

# Test with verbose output
curl -v https://aave-balance-checker-84.vercel.app/api/square/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "service": "Square Payment Processing",
  "credentials_configured": true
}
```

## 🐛 Common Issues & Solutions

### Issue 1: Function Not Appearing in Functions List

**Possible Causes:**
- File not committed to git
- `vercel.json` routing incorrect
- Build failed silently

**Solution:**
1. Verify `api/square/index.py` is committed:
   ```bash
   git ls-files | grep api/square/index.py
   ```
2. Check `vercel.json` is committed:
   ```bash
   git ls-files | grep vercel.json
   ```
3. Trigger new deployment:
   ```bash
   git commit --allow-empty -m "Trigger Vercel deployment"
   git push
   ```

### Issue 2: Build Fails with Import Error

**Error:** `ModuleNotFoundError: No module named 'mangum'`

**Solution:**
1. Verify `requirements.txt` includes `mangum`
2. Check `requirements.txt` is in root directory
3. Ensure no syntax errors in `requirements.txt`

### Issue 3: Function Exists but Returns 404

**Possible Causes:**
- Router prefix mismatch
- Path routing issue
- Handler not exported correctly

**Solution:**
1. Verify router prefix matches route:
   - Router: `prefix="/api/square"`
   - Route: `/api/square/(.*)`
   - Should match ✓

2. Check handler export:
   - Must be: `handler = Mangum(app, lifespan="off")`
   - Not: `def handler(...)` or `async def handler(...)`

### Issue 4: CORS Errors

**Solution:**
- CORS middleware already added ✓
- If still getting CORS errors, check browser console for specific error

## 📋 Pre-Deployment Checklist

Before deploying, verify:

- [ ] `api/square/index.py` exists and is committed
- [ ] `vercel.json` exists and is committed
- [ ] `requirements.txt` includes all dependencies
- [ ] `app/square/endpoints.py` exists
- [ ] Environment variables are set in Vercel Dashboard
- [ ] Git repository is connected to Vercel

## 🚀 Deployment Steps

1. **Commit all changes:**
   ```bash
   git add api/square/index.py vercel.json requirements.txt
   git commit -m "Configure Square payment API endpoint"
   git push
   ```

2. **Wait for Vercel deployment** (2-5 minutes)

3. **Check deployment status:**
   - Vercel Dashboard → Deployments → Latest
   - Should show ✅ Success

4. **Verify function exists:**
   - Vercel Dashboard → Functions
   - Look for `api/square/index.py`

5. **Test endpoint:**
   ```bash
   curl https://aave-balance-checker-84.vercel.app/api/square/health
   ```

## 📊 Expected Results

### ✅ Success Indicators:
- Function appears in Functions list
- Build logs show successful Python build
- Function logs show initialization messages
- Health endpoint returns 200 OK
- Payment endpoint returns 400/500 (not 404) with proper error

### ❌ Failure Indicators:
- Function doesn't appear in Functions list
- Build fails with errors
- Health endpoint returns 404
- No logs appear when calling endpoint

## 🔧 If Still Getting 404

1. **Check Vercel project settings:**
   - Root directory is correct
   - Build command is correct (or auto-detected)
   - Output directory is correct

2. **Try alternative routing:**
   - Test with simpler route pattern
   - Verify function path matches exactly

3. **Check Vercel CLI locally:**
   ```bash
   npm i -g vercel
   vercel dev
   # Test: curl http://localhost:3000/api/square/health
   ```

4. **Contact Vercel support:**
   - Share deployment logs
   - Share function logs
   - Share `vercel.json` configuration

