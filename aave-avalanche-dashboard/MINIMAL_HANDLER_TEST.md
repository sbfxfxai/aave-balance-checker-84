# Minimal Handler Test

## What Changed

Created a **minimal Python handler** without FastAPI/Mangum to test if the compatibility issue is resolved.

### Changes:
1. ✅ **Removed FastAPI/Mangum** - Using native Vercel Python handler format
2. ✅ **Removed all dependencies** - Empty `requirements.txt` for testing
3. ✅ **Simple handler function** - Direct request/response handling
4. ✅ **Fixed CSP** - Added `https://vercel.live` to `frame-src`

## Handler Format

The handler uses Vercel's native Python format:
```python
def handler(request):
    # request is a dict with: method, path, headers, body
    return {
        "statusCode": 200,
        "headers": {...},
        "body": json.dumps({...})
    }
```

## Testing

### 1. Deploy:
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
  "credentials_configured": true,
  "test": "minimal handler working"
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

**Expected Response (Test Mode):**
```json
{
  "success": true,
  "message": "Handler is working - ready to process payments",
  "test_mode": true,
  "received": {
    "source_id": "cnon:test-token...",
    "amount": 1.0,
    "currency": "USD"
  }
}
```

## If This Works

Once the minimal handler works:
1. ✅ Add `requests` back to `requirements.txt`
2. ✅ Add actual Square API call in `process_payment`
3. ✅ Keep the simple handler format (no FastAPI needed)

## If This Still Fails

If `FUNCTION_INVOCATION_FAILED` persists:
1. **Check Vercel logs** for specific Python errors
2. **Try Python 3.10** instead of 3.9
3. **Consider Vercel Edge Functions** (JavaScript) instead
4. **Deploy backend separately** (Railway, Render, Fly.io)

## Next Steps

1. **Deploy and test** the minimal handler
2. **If health endpoint works** → Add Square API integration
3. **If still failing** → Check Vercel logs for Python-specific errors
4. **Consider alternatives** → Edge Functions or separate backend service

