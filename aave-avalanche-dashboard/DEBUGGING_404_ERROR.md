# Debugging 404 Error on Square Payment Endpoint

## Quick Diagnostic Checklist

### 1. Test Health Endpoint First
```bash
curl https://aave-balance-checker-84.vercel.app/api/square/health
```

**Expected Response:**
```json
{"status": "ok", "service": "Square Payment Processing", "credentials_configured": true}
```

**If 404:**
- Function not deployed → Check Vercel build logs
- Route not matching → Check `vercel.json` configuration

**If 500:**
- Runtime error → Check function logs in Vercel Dashboard
- Missing dependencies → Check `requirements.txt`

### 2. Verify Vercel Configuration

**File: `vercel.json`**
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

### 3. Check Function Deployment

**In Vercel Dashboard:**
1. Go to **Your Project** → **Functions**
2. Look for `api/square/index.py`
3. Should show as **Active** and **Deployed**
4. Check **Logs** tab for any errors

### 4. Verify Environment Variables

**Required in Vercel Dashboard → Settings → Environment Variables:**

```
SQUARE_ACCESS_TOKEN=EAAAlygTphTRCrNzZ8GoYXNPWp1ipsp9kp3qArPdqAb9tReNEgCw8TNDr1rvAC-M
SQUARE_LOCATION_ID=LA09STPQW6HC0
SQUARE_API_BASE_URL=https://connect.squareup.com
```

### 5. Check Build Logs

**In Vercel Dashboard → Deployments → Latest:**

Look for:
- ✅ `Successfully built Python function`
- ❌ `ModuleNotFoundError: No module named 'mangum'`
- ❌ `ImportError: cannot import name 'router'`
- ❌ `FileNotFoundError: api/square/index.py`

### 6. Test Locally

```bash
# Install Vercel CLI if not already installed
npm i -g vercel

# Run locally
vercel dev

# Test health endpoint
curl http://localhost:3000/api/square/health
```

## Common Issues & Solutions

### Issue #1: Function Not Found in Vercel Dashboard

**Symptom:** `api/square/index.py` doesn't appear in Functions list

**Solution:**
1. Verify file exists at `api/square/index.py`
2. Check `vercel.json` routes configuration
3. Ensure file is committed to git
4. Redeploy: `vercel --prod`

### Issue #2: Build Fails with Import Error

**Symptom:** Build logs show `ModuleNotFoundError` or `ImportError`

**Solution:**
1. Verify `requirements.txt` includes:
   ```
   fastapi
   mangum
   requests
   pydantic
   ```
2. Check that `app/square/endpoints.py` exists
3. Verify Python path setup in `api/square/index.py`

### Issue #3: Health Works but Process-Payment Returns 404

**Symptom:** `/api/square/health` works, `/api/square/process-payment` doesn't

**Solution:**
1. Check router definition in `app/square/endpoints.py`
2. Verify `@router.post("/process-payment")` exists
3. Check router prefix matches: `prefix="/api/square"`

### Issue #4: CORS Errors

**Symptom:** Browser console shows CORS errors

**Solution:**
- Already fixed: CORS middleware added to `api/square/index.py`
- Verify middleware is configured correctly
- Check browser console for specific CORS error message

## Debugging Steps

### Step 1: Check Function Logs
1. Vercel Dashboard → Functions → `api/square/index.py`
2. Click **View Logs**
3. Make a request to `/api/square/health`
4. Check logs for:
   - `[Square API] Handler initialized successfully`
   - Any import errors
   - Route matching errors

### Step 2: Verify File Structure
```
aave-avalanche-dashboard/
├── api/
│   └── square/
│       └── index.py          ← Vercel serverless function
├── app/
│   └── square/
│       └── endpoints.py      ← FastAPI router
├── vercel.json               ← Routing configuration
└── requirements.txt          ← Python dependencies
```

### Step 3: Test Request Format

**Health Check:**
```bash
curl -X GET https://aave-balance-checker-84.vercel.app/api/square/health
```

**Process Payment:**
```bash
curl -X POST https://aave-balance-checker-84.vercel.app/api/square/process-payment \
  -H "Content-Type: application/json" \
  -d '{
    "source_id": "test_token",
    "amount": 1.00,
    "currency": "USD",
    "idempotency_key": "test-key-123"
  }'
```

## Expected Behavior

### ✅ Success Indicators:
- Health endpoint returns `200 OK` with JSON
- Function appears in Vercel Functions list
- Build logs show successful Python build
- No import errors in function logs

### ❌ Failure Indicators:
- 404 error → Function not deployed or route mismatch
- 500 error → Runtime error (check logs)
- CORS error → Middleware not configured (should be fixed)
- Timeout → Function not responding

## Next Steps if Still Getting 404

1. **Share these details:**
   - Response from health endpoint test
   - Vercel build logs (last 50 lines)
   - Function logs (if function exists)
   - Current `vercel.json` contents

2. **Check deployment status:**
   - Is the latest deployment successful?
   - Are there any warnings in build logs?
   - Is the function listed in Functions tab?

3. **Verify routing:**
   - Test with `vercel dev` locally
   - Check if route pattern matches exactly
   - Verify function path in `vercel.json`

## Additional Debugging

The `api/square/index.py` file now includes debug logging that will appear in Vercel function logs:
- Path setup information
- Import success/failure
- Registered routes
- Handler initialization

Check these logs in Vercel Dashboard → Functions → `api/square/index.py` → Logs

