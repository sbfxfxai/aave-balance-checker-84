# Vercel Python Function Fix

## Changes Made

### 1. Python Runtime Version
- **Changed**: `python3.11` → `python3.9`
- **Reason**: Python 3.9 is more stable and better tested with Vercel's Python runtime
- **Location**: `frontend/vercel.json`

### 2. Requirements Cleanup
- **Removed**: `uvicorn` (not needed for serverless)
- **Removed**: `python-dotenv` (Vercel handles env vars)
- **Kept**: `fastapi`, `mangum`, `pydantic`, `requests`
- **Location**: `frontend/requirements.txt`

### 3. Handler Export
- **Format**: FastAPI app wrapped with Mangum
- **Export**: `handler = Mangum(app, lifespan="off")`
- **Location**: `frontend/api/square/index.py`

## Testing

### 1. Deploy to Vercel:
```bash
cd frontend
vercel --prod
```

### 2. Test Health Endpoint:
```bash
curl https://aave-balance-checker-84.vercel.app/api/square/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "service": "square-api",
  "python_version": "3.9.x",
  "environment": "production",
  "credentials_configured": true
}
```

### 3. Test Payment Endpoint:
```bash
curl -X POST https://aave-balance-checker-84.vercel.app/api/square/process-payment \
  -H "Content-Type: application/json" \
  -d '{
    "source_id": "cnon:test-token",
    "amount": 1.00,
    "currency": "USD",
    "idempotency_key": "test-123"
  }'
```

## Troubleshooting

### If still getting `FUNCTION_INVOCATION_FAILED`:

1. **Check Vercel logs** for specific error messages
2. **Verify environment variables** are set:
   - `SQUARE_ACCESS_TOKEN`
   - `SQUARE_LOCATION_ID`
3. **Check Python version** in logs matches 3.9
4. **Verify dependencies** are installed correctly

### If getting `NOT_FOUND`:

1. **Check rewrite rule** in `vercel.json`:
   ```json
   {
     "source": "/api/square/(.*)",
     "destination": "/api/square/index"
   }
   ```
2. **Verify build** points to `api/square/index.py`
3. **Check deployment logs** for build errors

### If getting import errors:

1. **Verify requirements.txt** is in `frontend/` directory
2. **Check all dependencies** are listed correctly
3. **Redeploy** after updating requirements

## Next Steps

Once the health endpoint works:
1. ✅ Verify `credentials_configured: true`
2. ✅ Test payment endpoint with real Square token
3. ✅ Check browser console for `NS_BINDING_ABORTED` errors (should stop)
4. ✅ Test full payment flow from frontend

## Alternative Approaches (if still failing)

If Python 3.9 + FastAPI still doesn't work:

1. **Try Python 3.10** (middle ground)
2. **Use Vercel Edge Functions** (JavaScript/TypeScript)
3. **Deploy backend separately** (Railway, Render, etc.)
4. **Use Vercel's native Python format** (without FastAPI)

