# Square Backend Payment Processing Setup

## Problem Solved

Square's Payments API doesn't allow direct browser calls due to CORS restrictions. The solution is to:
1. **Frontend**: Tokenize the card using Square Web Payments SDK (`card.tokenize()`)
2. **Backend**: Process the payment server-side using the token

## Backend Endpoint Created

**Endpoint**: `POST /api/square/process-payment`

**Location**: `app/square/endpoints.py`

**What it does**:
- Receives tokenized card data from frontend
- Calls Square Payments API server-side (no CORS issues)
- Returns payment result to frontend

## Environment Variables Required

### Backend (.env in project root):
```env
SQUARE_ACCESS_TOKEN=EAAAlygTphTRCrNzZ8GoYXNPWp1ipsp9kp3qArPdqAb9tReNEgCw8TNDr1rvAC-M
SQUARE_LOCATION_ID=LA09STPQW6HC0
SQUARE_API_BASE_URL=https://connect.squareup.com
```

### Frontend (.env in frontend/):
```env
VITE_SQUARE_APPLICATION_ID=sq0idp-r5ABvzQQx9LYRH-JHO_xCw
VITE_SQUARE_LOCATION_ID=LA09STPQW6HC0
VITE_SQUARE_ENVIRONMENT=production
VITE_API_BASE_URL=http://localhost:8000  # Backend API URL
```

## Payment Flow

1. **User enters card details** → Square Web Payments SDK tokenizes the card
2. **Frontend calls** → `POST /api/square/process-payment` with token
3. **Backend calls** → Square Payments API with token and credentials
4. **Backend returns** → Payment result (success/failure)
5. **Frontend displays** → Success message or error

## Testing

1. **Start backend**:
   ```bash
   cd app
   uvicorn main:app --reload --port 8000
   ```

2. **Start frontend**:
   ```bash
   cd frontend
   npm run dev
   ```

3. **Test payment**:
   - Navigate to Stack App
   - Select USD deposit
   - Enter $1.00
   - Enter test card details
   - Submit payment

## Security Notes

✅ **Access Token is server-side only** - Never exposed to frontend
✅ **CORS protection** - Square API called from backend, not browser
✅ **Token-based** - Card details never sent to your server (only token)

## Production Deployment

### Backend (Vercel/Python):
- Set environment variables in Vercel dashboard:
  - `SQUARE_ACCESS_TOKEN`
  - `SQUARE_LOCATION_ID`
  - `SQUARE_API_BASE_URL`

### Frontend (Vercel):
- Set environment variables:
  - `VITE_SQUARE_APPLICATION_ID`
  - `VITE_SQUARE_LOCATION_ID`
  - `VITE_SQUARE_ENVIRONMENT=production`
  - `VITE_API_BASE_URL=https://your-backend-url.vercel.app`

## API Request/Response Format

### Request:
```json
{
  "source_id": "cnon:card-nonce-ok",
  "amount": 1.00,
  "currency": "USD",
  "risk_profile": "conservative",
  "idempotency_key": "1234567890-0.123456"
}
```

### Success Response:
```json
{
  "success": true,
  "payment_id": "abc123...",
  "order_id": "order123...",
  "transaction_id": "abc123...",
  "message": "Payment processed successfully"
}
```

### Error Response:
```json
{
  "success": false,
  "error": "Payment failed: Invalid card"
}
```

