# Square Web Payments Setup Status

## ✅ Completed Setup

### Frontend (Client-Side)
- ✅ Square Web Payments SDK loading correctly
- ✅ SDK initialization following official Quickstart pattern
- ✅ Card form creation and attachment
- ✅ Card tokenization working
- ✅ Payment token sent to backend

### Backend Configuration
- ✅ API endpoint: `https://api.squareup.com/v2/payments` (correct)
- ✅ Request format matches official Square API pattern
- ✅ Headers configured correctly (Authorization, Square-Version)
- ✅ Amount conversion to cents (integer)
- ✅ Idempotency key handling

### Environment Variables
- ✅ Frontend: `VITE_SQUARE_APPLICATION_ID`, `VITE_SQUARE_LOCATION_ID`
- ✅ Backend: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_API_BASE_URL`

## ❌ Current Issue

**Error**: `FUNCTION_INVOCATION_FAILED` - Python serverless function crashing before returning JSON

**Symptoms**:
- Frontend successfully tokenizes card
- Payment token generated correctly
- Backend function crashes immediately
- Returns plain text error instead of JSON

**Root Cause**: The Python function is failing during initialization or execution before it can return a JSON response.

## 🔧 Next Steps to Fix

### 1. Check Vercel Function Logs
**Critical**: View actual error in Vercel Dashboard:
1. Go to Vercel Dashboard → Your Project → Functions
2. Click `api/square/index.py`
3. View Logs tab
4. Look for Python traceback or error messages

### 2. Verify Requirements.txt
Ensure `api/square/requirements.txt` contains:
```
requests>=2.31.0
```

### 3. Test Health Endpoint
```bash
curl https://aave-balance-checker-84.vercel.app/api/square/health
```

Expected: JSON response with status information
If fails: Check logs for specific error

### 4. Common Issues to Check

#### Missing Dependencies
- Verify `requests` library is installed
- Check `requirements.txt` is in correct location (`api/square/requirements.txt`)

#### Handler Signature
- Verify handler function signature: `def handler(event, context=None)`
- Ensure handler is exported at module level

#### Environment Variables
- Verify all Square credentials are set in Vercel
- Check variable names match exactly (case-sensitive)

#### Python Runtime
- Current: `python3.12`
- If issues persist, try `python3.10` or `python3.11`

## 📋 Verification Checklist

- [ ] Vercel function logs reviewed
- [ ] Requirements.txt verified
- [ ] Health endpoint returns JSON
- [ ] Environment variables set correctly
- [ ] Handler function exported correctly
- [ ] No syntax errors in Python code

## 🎯 Expected Behavior

### Successful Payment Flow

1. **Frontend**:
   - User enters card details
   - Card tokenized: `cnon:CA4SE...`
   - Token sent to `/api/square/process-payment`

2. **Backend**:
   - Receives token and amount
   - Calls Square API: `POST https://api.squareup.com/v2/payments`
   - Returns JSON response with payment ID

3. **Response**:
   ```json
   {
     "success": true,
     "payment_id": "payment_id_here",
     "message": "Payment processed successfully"
   }
   ```

## 📚 Reference Documentation

- [Square Web Payments SDK Quickstart](https://developer.squareup.com/docs/web-payments/overview)
- [Square Payments API Reference](https://developer.squareup.com/reference/square/payments-api/create-payment)
- [Official Quickstart Repository](https://github.com/square/web-payments-quickstart)

## 🔍 Debugging Commands

### Test Health Endpoint
```bash
curl -v https://aave-balance-checker-84.vercel.app/api/square/health
```

### Test Payment Endpoint (with test token)
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

### View Vercel Logs
```bash
vercel logs https://aave-balance-checker-84.vercel.app --follow
```

