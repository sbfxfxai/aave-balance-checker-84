# Rate Limiting and Security Documentation

## Overview

This document outlines the rate limiting and security measures implemented in the wallet API endpoints to protect against abuse and ensure system stability.

## Rate Limiting

### Implementation

Rate limiting is implemented using Redis with a sliding window algorithm. The system tracks requests per key (IP, email, wallet address) within a specified time window.

### Rate Limits

| Endpoint Type | Requests | Time Window | Purpose |
|---------------|----------|-------------|---------|
| General API | 100 | 1 minute | Standard API usage |
| Authentication | 10 | 1 minute | Login/verification attempts |
| Wallet Operations | 5 | 1 minute | Sensitive wallet actions |
| Email Sending | 3 | 1 minute | Prevent email spam |

### Rate Limit Keys

- **IP-based**: `rate_limit:ip:{address}`
- **Email-based**: `rate_limit:email:{email}`
- **Wallet-based**: `rate_limit:wallet:{address}`
- **User-based**: `rate_limit:user:{userId}`

### Headers

Rate limit responses include:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in window
- `X-RateLimit-Reset`: Unix timestamp when window resets

### Response Codes

- **200**: Request allowed
- **429**: Rate limit exceeded
  ```json
  {
    "error": "Too many requests",
    "retryAfter": 45
  }
  ```

## Security Measures

### Authentication

1. **Email Verification**: All wallet operations require verified email
2. **Payment ID Validation**: Sensitive operations require valid payment ID
3. **Wallet Association**: Users can only access associated wallets

### Data Protection

1. **Encryption**: Wallet keys are encrypted using PBKDF2 with user-specific salts
2. **Key Derivation**: Keys derived from `userEmail:paymentId` combination
3. **Secure Storage**: Encrypted data stored in Redis with TTL

### Input Validation

1. **Address Validation**: Ethereum address format validation
2. **Email Validation**: RFC 5322 email format checking
3. **Amount Validation**: Positive number validation for transactions
4. **Parameter Sanitization**: All inputs are sanitized and validated

### CORS Security

- Configurable CORS headers
- Origin validation in production
- Method and header restrictions

### Monitoring and Alerting

1. **Failed Attempts**: Track failed authentication attempts
2. **Unusual Activity**: Monitor for suspicious patterns
3. **Security Alerts**: Email notifications for security events

## Implementation Details

### Rate Limiter Class

```typescript
class RateLimiter {
  constructor(windowMs: number, maxRequests: number)
  async isAllowed(key: string): Promise<RateLimitResult>
  middleware(keyGenerator: Function): MiddlewareFunction
}
```

### Security Utilities

```typescript
// Key derivation for encryption
function deriveKey(userEmail: string, paymentId: string): Buffer

// Mnemonic encryption/decryption
function encryptMnemonic(mnemonic: string, key: Buffer): string
function decryptMnemonic(encryptedData: string, key: Buffer): string
```

## Best Practices

### For Developers

1. **Always use rate limiting** on public endpoints
2. **Validate all inputs** before processing
3. **Use HTTPS** in production
4. **Implement proper error handling** without exposing sensitive data
5. **Log security events** for monitoring

### For Users

1. **Never share private keys** or recovery phrases
2. **Use strong, unique passwords**
3. **Enable two-factor authentication** when available
4. **Monitor account activity** regularly
5. **Report suspicious activity** immediately

## Configuration

### Environment Variables

```bash
# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Security
ENCRYPTION_ROUNDS=10000
SESSION_TIMEOUT_MS=3600000

# Redis
KV_REST_API_URL=your_redis_url
KV_REST_API_TOKEN=your_redis_token
```

### Redis Keys Structure

```
rate_limit:{type}:{identifier}  # Sorted set for rate limiting
wallet_key:{address}            # Encrypted wallet data
wallet_user:{address}           # Wallet-user association
user_wallets:{email}            # User's wallet list
payment:{paymentId}             # Payment information
```

## Troubleshooting

### Common Issues

1. **Rate Limit Exceeded**
   - Check retry-after header
   - Implement exponential backoff
   - Verify correct key generation

2. **Authentication Failures**
   - Verify email format
   - Check payment ID validity
   - Ensure wallet association exists

3. **Encryption Errors**
   - Verify key derivation parameters
   - Check encrypted data format
   - Ensure consistent encoding

### Monitoring

Monitor these metrics:
- Rate limit hit rates
- Authentication failure rates
- Encryption/decryption errors
- Redis connectivity issues

## Security Considerations

### Threats Mitigated

1. **Brute Force Attacks**: Rate limiting on authentication
2. **DoS Attacks**: IP-based rate limiting
3. **Data Exposure**: Encryption at rest
4. **Unauthorized Access**: User-wallet association validation
5. **Spam**: Email rate limiting

### Future Enhancements

1. **CAPTCHA Integration**: For suspicious activity
2. **Device Fingerprinting**: Enhanced tracking
3. **Machine Learning**: Anomaly detection
4. **Multi-factor Authentication**: Additional security layers
5. **Hardware Security Modules**: Key protection

## Support

For security-related issues:
- Email: security@tiltvault.com
- Documentation: /api/security
- Status Page: /api/monitoring/health
