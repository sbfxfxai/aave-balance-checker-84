# Vercel 404 Fix - Python Function Not Found

## Issue
Getting 404 for `/api/square/process-payment` - Vercel not finding Python function

## Root Cause
Vercel may not be detecting the Python function during build, or routing isn't configured correctly.

## Solution Applied

### 1. Added `functions` config to `vercel.json`
```json
{
  "functions": {
    "api/square/index.py": {
      "runtime": "python3.12"
    }
  }
}
```

### 2. Verify Routes Are Correct
Routes section should map `/api/square/(.*)` to `/api/square/index`:
```json
{
  "routes": [
    {
      "src": "/api/square/(.*)",
      "dest": "/api/square/index"
    }
  ]
}
```

## Next Steps

1. **Push and Deploy:**
   ```bash
   git push
   ```

2. **Check Vercel Dashboard:**
   - Go to **Functions** tab
   - Look for `api/square/index.py`
   - Should show Python 3.12 runtime

3. **Check Build Logs:**
   - Look for: `Building Python function: api/square/index.py`
   - Should see: `@vercel/python` in build output

4. **Test Health Endpoint:**
   ```bash
   curl https://aave-balance-checker-84.vercel.app/api/square/health
   ```

## If Still 404

### Option 1: Check Vercel Project Settings
- **Root Directory**: Should be empty (or project root)
- **Build Command**: Auto-detect
- **Output Directory**: `frontend/dist`

### Option 2: Verify Function File Structure
```
api/
  square/
    index.py       ← Must exist
    requirements.txt ← Must exist
```

### Option 3: Check Build Output
In Vercel Dashboard → Deployments → Latest → Build Logs:
- Should see Python function being built
- Should see `@vercel/python` package being used
- Should NOT see errors about missing files

## Alternative: Use TypeScript Functions
If Python continues to fail, consider switching to TypeScript:
- Vercel handles TypeScript functions more reliably
- Already have TypeScript files in `api/square/`
- Can remove Python build config entirely

