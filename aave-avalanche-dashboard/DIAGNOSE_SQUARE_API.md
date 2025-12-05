# Square API Function Diagnosis Guide

## Current Issue
The function is crashing immediately with `FUNCTION_INVOCATION_FAILED`. This means the handler is failing during initialization.

## Step-by-Step Diagnosis

### Step 1: Check Vercel Function Logs

**Via Dashboard:**
1. Go to https://vercel.com/dashboard
2. Click your project: `aave-balance-checker-84`
3. Click **Deployments** → Latest deployment
4. Click **Functions** tab
5. Click `api/square/index`
6. **Copy ALL logs** - especially look for:
   - `[Square API]` prefixed messages
   - Import errors
   - Path errors
   - Any Python tracebacks

**Via CLI:**
```bash
vercel logs https://aave-balance-checker-84.vercel.app --follow
```

### Step 2: Test Health Endpoint

```bash
curl -v https://aave-balance-checker-84.vercel.app/api/square/health
```

**Expected responses:**
- `200 OK` with JSON → Function works!
- `404 Not Found` → Function not deployed or route wrong
- `500 Internal Server Error` → Function crashes (check logs)
- `502 Bad Gateway` → Function timeout

### Step 3: Verify File Structure

Your project should have:
```
aave-avalanche-dashboard/
├── api/
│   └── square/
│       └── index.py          ← Must exist and export 'handler'
├── requirements.txt          ← Must be in project root
├── vercel.json               ← Must configure Python build
└── app/
    └── square/
        └── endpoints.py      ← Contains the router
```

### Step 4: Check Requirements.txt

Verify `requirements.txt` includes:
```
fastapi==0.104.1
mangum==0.17.0
pydantic==2.5.0
requests
```

### Step 5: Check Vercel Configuration

Verify `vercel.json` has:
```json
{
  "builds": [
    {
      "src": "api/square/index.py",
      "use": "@vercel/python",
      "config": {
        "runtime": "python3.9"
      }
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

### Step 6: Test Minimal Handler

If logs show import errors, temporarily replace `api/square/index.py` with the minimal test handler (`index_test.py`) to verify basic function execution works.

## Common Issues & Solutions

### Issue: "ModuleNotFoundError: No module named 'fastapi'"
**Solution:** 
- Verify `requirements.txt` is in project root
- Check Vercel build logs show packages being installed
- Ensure `fastapi` is listed in requirements.txt

### Issue: "ImportError: cannot import name 'router' from 'app.square.endpoints'"
**Solution:**
- Verify `app/square/endpoints.py` exists
- Check that `router = APIRouter(...)` is defined in endpoints.py
- Verify `app/__init__.py` and `app/square/__init__.py` exist

### Issue: "Handler is None"
**Solution:**
- Check logs for import errors during handler initialization
- Verify all dependencies are installed
- Check that `handler` variable is exported at module level

### Issue: "Path not found" or "404"
**Solution:**
- Verify `vercel.json` rewrite rule matches `/api/square/:path*`
- Check that function is deployed (Functions tab)
- Ensure build completed successfully

## What to Share

Please share:
1. **Full Vercel function logs** (from Step 1)
2. **Response from curl command** (from Step 2)
3. **Any build errors** from deployment logs

This will help identify the exact failure point.

