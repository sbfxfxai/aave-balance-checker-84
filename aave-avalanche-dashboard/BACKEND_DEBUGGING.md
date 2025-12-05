# Backend Function Debugging Guide

## Current Status

- ✅ Frontend is working (Square SDK loads, card form displays)
- ❌ Backend function returns `FUNCTION_INVOCATION_FAILED` (HTTP 500)
- ✅ Request reaches backend (`POST /api/square/process-payment`)

## Handler Format Updated

Changed from simple `handler(request)` to AWS Lambda format `handler(event, context)` which Vercel Python functions expect.

## Testing

### 1. Deploy Updated Handler:
```bash
cd frontend
vercel --prod
```

### 2. Test Health Endpoint:
```bash
curl https://aave-balance-checker-84.vercel.app/api/square/health
```

### 3. Check Vercel Logs:
- Go to Vercel Dashboard → Your Project → Functions → View Logs
- Look for Python errors or import failures

## If Still Failing

### Option 1: Check Vercel Logs
The logs will show the actual Python error. Common issues:
- Import errors (missing dependencies)
- Syntax errors
- Handler signature mismatch
- Runtime version incompatibility

### Option 2: Try Python 3.10
Update `vercel.json`:
```json
"runtime": "python3.10"
```

### Option 3: Use Vercel Edge Functions (JavaScript)
Create `frontend/api/square/index.js`:
```javascript
export default async function handler(req, res) {
  // JavaScript handler - more reliable with Vercel
}
```

### Option 4: Deploy Backend Separately
Use a different platform:
- **Railway** - Easy Python deployment
- **Render** - Free tier available
- **Fly.io** - Good for serverless Python
- **AWS Lambda** - Direct deployment

## Console Warnings (All Harmless)

These can be ignored:
- ✅ SES intrinsics warnings - Security library messages
- ✅ CSP inline script - Square SDK internal
- ✅ Phantom wallet errors - Browser extension
- ✅ Cookie warnings - Browser privacy features

## Next Steps

1. **Deploy updated handler** (AWS Lambda format)
2. **Test health endpoint** to verify handler works
3. **Check Vercel logs** if still failing
4. **Consider alternatives** if Python continues to fail

