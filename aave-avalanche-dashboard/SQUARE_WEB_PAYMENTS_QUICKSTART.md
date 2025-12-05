# Square Web Payments SDK Quickstart Setup

This guide follows the official Square Web Payments SDK Quickstart pattern.

## Overview

The Square Web Payments SDK enables secure payment card entry in your web application. The SDK produces a secure single-use payment token that your backend processes using the Payments API.

## Architecture

```
Frontend (Browser)                    Backend (Server)
┌─────────────────┐                  ┌─────────────────┐
│ Web Payments SDK│                  │  Payments API   │
│                 │                  │                 │
│ 1. Load SDK    │                  │                 │
│ 2. Initialize  │                  │                 │
│ 3. Create Card │                  │                 │
│ 4. Tokenize    │───token───────►  │ 5. Process      │
│                │                  │    Payment      │
│                │◄──response───────│                 │
└─────────────────┘                  └─────────────────┘
```

## Frontend Setup (Client-Side)

### 1. Load Square Web Payments SDK

```typescript
// Load SDK script dynamically
const script = document.createElement('script');
script.src = 'https://web.squarecdn.com/v1/square.js';
script.async = true;
script.crossOrigin = 'anonymous';
document.head.appendChild(script);
```

### 2. Initialize Square Payments

```typescript
// Get credentials from environment variables
const applicationId = import.meta.env.VITE_SQUARE_APPLICATION_ID;
const locationId = import.meta.env.VITE_SQUARE_LOCATION_ID;

// Initialize Square Payments
const payments = window.Square.payments(applicationId, locationId);
```

### 3. Create Card Payment Method

```typescript
// Create card payment method
const card = await payments.card();

// Attach to DOM element
await card.attach('#sq-card');
```

### 4. Tokenize Card

```typescript
// Tokenize card to get payment token
const result = await card.tokenize();

if (result.status === 'OK' && result.token) {
  // Send token to backend
  const paymentToken = result.token;
  // paymentToken format: "cnon:CA4SE..."
} else {
  // Handle errors
  console.error('Tokenization failed:', result.errors);
}
```

## Backend Setup (Server-Side)

### 1. Process Payment with Token

```python
import requests
import os

# Get Square credentials
access_token = os.getenv('SQUARE_ACCESS_TOKEN')
location_id = os.getenv('SQUARE_LOCATION_ID')

# Square Payments API endpoint
api_url = 'https://api.squareup.com/v2/payments'

# Payment payload
payload = {
    'source_id': payment_token,  # Token from frontend
    'idempotency_key': unique_order_id,
    'amount_money': {
        'amount': amount_cents,  # Amount in cents (integer)
        'currency': 'USD',
    },
    'location_id': location_id,
    'autocomplete': True,  # Complete payment immediately
}

# Make API request
headers = {
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {access_token}',
    'Square-Version': '2024-01-18',
}

response = requests.post(api_url, json=payload, headers=headers)

if response.ok:
    payment_data = response.json()
    payment_id = payment_data['payment']['id']
    print(f'Payment successful: {payment_id}')
else:
    error_data = response.json()
    errors = error_data.get('errors', [])
    error_message = errors[0]['detail'] if errors else 'Payment failed'
    print(f'Payment failed: {error_message}')
```

## Environment Variables

### Frontend (Vite Environment Variables)

```bash
# Public credentials (safe to expose)
VITE_SQUARE_APPLICATION_ID=sq0idp-...
VITE_SQUARE_LOCATION_ID=LA...
VITE_SQUARE_ENVIRONMENT=production
```

### Backend (Server-Side Only)

```bash
# Secret credentials (never expose to frontend)
SQUARE_ACCESS_TOKEN=EAAA...
SQUARE_LOCATION_ID=LA...
SQUARE_API_BASE_URL=https://api.squareup.com
SQUARE_ENVIRONMENT=production
```

## Complete Example Flow

### Frontend (TypeScript/React)

```typescript
// 1. Load SDK
await loadSquareSdk();

// 2. Initialize
const payments = window.Square.payments(appId, locationId);

// 3. Create card form
const card = await payments.card();
await card.attach('#sq-card');

// 4. On form submit, tokenize
const result = await card.tokenize();
if (result.status === 'OK') {
  // 5. Send token to backend
  const response = await fetch('/api/square/process-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_id: result.token,
      amount: 1.00,
      currency: 'USD',
      idempotency_key: `order-${Date.now()}`,
    }),
  });
}
```

### Backend (Python)

```python
def handler(event, context):
    # Parse request
    request_data = json.loads(event['body'])
    token = request_data['source_id']
    amount = request_data['amount']
    
    # Call Square API
    response = requests.post(
        'https://api.squareup.com/v2/payments',
        json={
            'source_id': token,
            'idempotency_key': request_data['idempotency_key'],
            'amount_money': {
                'amount': int(amount * 100),
                'currency': 'USD',
            },
            'location_id': os.getenv('SQUARE_LOCATION_ID'),
            'autocomplete': True,
        },
        headers={
            'Authorization': f"Bearer {os.getenv('SQUARE_ACCESS_TOKEN')}",
            'Square-Version': '2024-01-18',
        },
    )
    
    return {
        'statusCode': 200 if response.ok else 500,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps(response.json()),
    }
```

## Key Points

1. **SDK URL**: Always use `https://web.squarecdn.com/v1/square.js` (same for sandbox and production)
2. **API Endpoint**: Use `https://api.squareup.com/v2/payments` for production
3. **Token Format**: Payment tokens start with `cnon:` (card nonce)
4. **Amount**: Always send amount in cents as integer (e.g., $1.00 = 100 cents)
5. **Idempotency**: Always include a unique `idempotency_key` for each payment
6. **Security**: Never expose `SQUARE_ACCESS_TOKEN` to frontend

## Testing

### Test Card Numbers (Sandbox)

- **Success**: `4111 1111 1111 1111`
- **Decline**: `4000 0000 0000 0002`
- **CVV**: Any 3 digits
- **Expiry**: Any future date

### Production Test

Use real card numbers in production (will charge real money).

## Troubleshooting

### SDK Not Loading
- Check CSP headers allow `https://web.squarecdn.com`
- Verify script is loaded before initialization
- Check browser console for errors

### Tokenization Fails
- Verify Application ID and Location ID are correct
- Check card form is properly attached to DOM
- Ensure form fields are filled correctly

### Payment Processing Fails
- Verify Access Token is valid
- Check Location ID matches frontend
- Ensure amount is in cents (integer)
- Verify idempotency_key is unique

## References

- [Square Web Payments SDK Documentation](https://developer.squareup.com/docs/web-payments/overview)
- [Square Payments API Documentation](https://developer.squareup.com/reference/square/payments-api/create-payment)
- [Official Quickstart Repository](https://github.com/square/web-payments-quickstart)

