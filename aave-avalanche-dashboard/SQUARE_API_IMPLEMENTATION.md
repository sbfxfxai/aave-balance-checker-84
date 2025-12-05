# Square Payments API Implementation

This implementation follows Square's official Card Payments documentation exactly.

## API Endpoint

**Production**: `https://connect.squareup.com/v2/payments`  
**Sandbox**: `https://connect.squareupsandbox.com/v2/payments`

## Request Format

Following Square's official documentation:

```python
{
    "idempotency_key": "{UNIQUE_KEY}",
    "amount_money": {
        "amount": 2000,  # Amount in cents (integer)
        "currency": "USD"
    },
    "source_id": "{PAYMENT_TOKEN}",  # From Web Payments SDK
    "location_id": "{LOCATION_ID}",
    "autocomplete": True  # Immediate capture
}
```

## Headers

```python
{
    "Content-Type": "application/json",
    "Authorization": "Bearer {ACCESS_TOKEN}",
    "Square-Version": "2025-10-16"  # Latest API version
}
```

## Response Format

Square returns a Payment object:

```json
{
    "payment": {
        "id": "payment_id",
        "status": "COMPLETED",  // COMPLETED, APPROVED, FAILED, CANCELED
        "amount_money": {
            "amount": 2000,
            "currency": "USD"
        },
        "order_id": "order_id",
        "card_details": {
            "status": "CAPTURED",
            "card": {
                "card_brand": "VISA",
                "last_4": "5858"
            }
        }
    }
}
```

## Payment Status Values

- **COMPLETED**: Payment processed immediately (authorization + capture)
- **APPROVED**: Authorization only (delayed capture - requires CompletePayment)
- **FAILED**: Payment declined
- **CANCELED**: Payment voided

## Implementation Details

### Frontend (Web Payments SDK)
1. Load SDK: `https://web.squarecdn.com/v1/square.js`
2. Initialize: `Square.payments(applicationId, locationId)`
3. Create card: `await payments.card()`
4. Attach: `await card.attach('#card-container')`
5. Tokenize: `await card.tokenize()` → returns `{ status: 'OK', token: 'cnon:...' }`

### Backend (Payments API)
1. Receive payment token from frontend
2. Call `POST https://connect.squareup.com/v2/payments`
3. Include token as `source_id`
4. Process response and return payment status

## Error Handling

Square API returns errors in this format:

```json
{
    "errors": [
        {
            "category": "PAYMENT_METHOD_ERROR",
            "code": "CARD_DECLINED",
            "detail": "Card declined."
        }
    ]
}
```

Our implementation extracts the first error's `detail` and `code` for user-friendly error messages.

## Testing

### Sandbox Test Token
Use Square's test token: `cnon:card-nonce-ok`

### Test Card Numbers
- Success: `4111 1111 1111 1111`
- Decline: `4000 0000 0000 0002`
- CVV: Any 3 digits
- Expiry: Any future date

## References

- [Square Card Payments Documentation](https://developer.squareup.com/docs/payments-api/take-payments/card-payments)
- [Square Payments API Reference](https://developer.squareup.com/reference/square/payments-api/create-payment)
- [Web Payments SDK Documentation](https://developer.squareup.com/docs/web-payments/overview)

