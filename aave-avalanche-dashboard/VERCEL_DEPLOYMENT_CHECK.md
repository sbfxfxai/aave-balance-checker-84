# Vercel Deployment Check

## Current Setup

- **Function Location**: `/api/square/index.py`
- **Route**: `/api/square/(.*)` → `/api/square/index.py`
- **Router Prefix**: `/api/square` (in `app/square/endpoints.py`)

## Important Notes

1. **Router Prefix**: The FastAPI router has prefix `/api/square`, which means:
   - Route `/process-payment` in router = `/api/square/process-payment` in FastAPI
   - This matches the Vercel route `/api/square/process-payment`

2. **Vercel Routing**: When Vercel receives `/api/square/process-payment`:
   - Routes to `/api/square/index.py` function
   - Function receives full path `/api/square/process-payment`
   - FastAPI router matches it correctly

## If Still Getting 404

### Check 1: Verify Function Exists
1. Go to Vercel Dashboard → Functions
2. Look for `api/square/index.py`
3. Should show as deployed

### Check 2: Check Build Logs
1. Go to Vercel Dashboard → Deployments → Latest
2. Check Python build logs
3. Look for errors:
   - `ModuleNotFoundError: No module named 'mangum'`
   - `ImportError: cannot import name 'router'`
   - Any other import errors

### Check 3: Test Health Endpoint
```bash
curl https://aave-balance-checker-84.vercel.app/api/square/health
```

If health works but process-payment doesn't:
- Check router definition in `app/square/endpoints.py`
- Verify `@router.post("/process-payment")` exists

### Check 4: Verify Mangum is Installed
Check `requirements.txt` includes:
```
mangum
```

### Check 5: Check Function Logs
1. Vercel Dashboard → Functions → `api/square/index.py`
2. Click "View Logs"
3. Look for runtime errors when calling the endpoint

## Expected Behavior After Fix

✅ Health endpoint: `200 OK` with JSON response
✅ Process payment: Should process (may fail with invalid token, but not 404)

