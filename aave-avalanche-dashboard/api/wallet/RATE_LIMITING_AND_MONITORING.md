# Rate Limiting and Monitoring for Wallet Endpoints

## Overview

All `/api/wallet/*` endpoints now have rate limiting and monitoring capabilities to:
- Prevent abuse and DDoS attacks
- Track endpoint performance and errors
- Provide visibility into API usage patterns

## Implementation

### Rate Limiting (`rateLimit.ts`)

**Features:**
- Redis-based rate limiting using Upstash Redis
- Per-endpoint configuration with customizable limits
- Identifier-based limiting (wallet address, email, payment ID, or IP)
- Standard HTTP rate limit headers (`X-RateLimit-*`)

**Rate Limit Configurations:**

| Endpoint | Max Requests | Window | Identifier |
|----------|-------------|--------|------------|
| `store-key` | 10 | 1 hour | Wallet address |
| `store-payment-info` | 20 | 1 hour | Payment ID |
| `send-email` | 5 | 1 hour | Email address |
| `decrypt-mnemonic` | 10 | 1 hour | Email address |
| `status` | 60 | 1 minute | Payment ID |

**Rate Limit Headers:**
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: ISO timestamp when limit resets

**Rate Limit Response (429):**
```json
{
  "error": "Rate limit exceeded",
  "message": "Too many requests. Please try again after <timestamp>",
  "resetAt": 1234567890000
}
```

### Monitoring (`monitoring.ts`)

**Features:**
- Automatic request/response logging
- Error tracking and categorization
- Performance metrics (duration)
- Client identification (IP address)
- Statistics aggregation in Redis

**Monitored Metrics:**
- Total requests per endpoint
- Error count (4xx, 5xx)
- Server error count (5xx)
- Request duration
- Client IP addresses

**Log Storage:**
- Individual events stored with 7-day TTL
- Statistics aggregated with 30-day TTL
- Console logging for immediate visibility

**Event Structure:**
```typescript
{
  endpoint: string;
  method: string;
  statusCode: number;
  timestamp: number;
  clientId: string;
  error?: string;
  duration: number;
  metadata?: Record<string, any>;
}
```

## Updated Endpoints

### ✅ `/api/wallet/store-key`
- **Rate Limit:** 10 requests per wallet address per hour
- **Monitoring:** Full request/response tracking
- **Use Case:** Store encrypted wallet keys

### ✅ `/api/wallet/store-payment-info`
- **Rate Limit:** 20 requests per payment ID per hour
- **Monitoring:** Full request/response tracking
- **Use Case:** Store payment information for webhook lookup

### ✅ `/api/wallet/send-email`
- **Rate Limit:** 5 requests per email per hour
- **Monitoring:** Full request/response tracking
- **Use Case:** Send encrypted wallet recovery emails

### ✅ `/api/wallet/decrypt-mnemonic`
- **Rate Limit:** 10 requests per email per hour
- **Monitoring:** Full request/response tracking
- **Use Case:** Decrypt mnemonic phrases (security-sensitive)

### ✅ `/api/wallet/status`
- **Rate Limit:** 60 requests per payment ID per minute
- **Monitoring:** Full request/response tracking
- **Use Case:** Check payment funding status (allows frequent polling)

## Usage Examples

### Rate Limiting
```typescript
import { checkRateLimit, RATE_LIMITS } from './rateLimit';

const rateLimitResult = await checkRateLimit(req, {
  ...RATE_LIMITS.STORE_KEY,
  identifier: walletAddress, // Optional: wallet address, email, etc.
});

if (!rateLimitResult.allowed) {
  return res.status(429).json({
    error: 'Rate limit exceeded',
    resetAt: rateLimitResult.resetAt,
  });
}
```

### Monitoring
```typescript
import { withMonitoring } from './monitoring';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return withMonitoring(req, res, 'endpoint-name', async () => {
    // Your endpoint logic here
    return res.status(200).json({ success: true });
  });
}
```

## Statistics Access

### Get Endpoint Statistics
```typescript
import { getEndpointStats } from './monitoring';

const stats = await getEndpointStats('store-key');
// Returns: { total: 1000, errors: 50, serverErrors: 5 }
```

### Redis Keys
- Events: `monitor:{endpoint}:{timestamp}` (7-day TTL)
- Stats: `stats:{endpoint}:total` (30-day TTL)
- Stats: `stats:{endpoint}:errors` (30-day TTL)
- Stats: `stats:{endpoint}:server_errors` (30-day TTL)

## Configuration

### Environment Variables
- `KV_REST_API_URL` or `REDIS_URL`: Redis connection URL
- `KV_REST_API_TOKEN`: Redis authentication token

### Customizing Rate Limits
Edit `RATE_LIMITS` in `rateLimit.ts`:
```typescript
export const RATE_LIMITS = {
  STORE_KEY: {
    maxRequests: 10,
    windowSeconds: 3600,
    endpoint: 'store-key',
  },
  // ... other endpoints
};
```

## Security Considerations

1. **Identifier-Based Limiting:** Uses wallet addresses, emails, or payment IDs when available to prevent IP-based bypass
2. **IP Fallback:** Falls back to IP address when identifier not available
3. **Separate Limits:** Each endpoint has appropriate limits based on use case
4. **Security-Sensitive Endpoints:** Stricter limits on decrypt operations

## Monitoring Dashboard (Future)

Consider building a dashboard to visualize:
- Request volume over time
- Error rates by endpoint
- Average response times
- Top clients by request count
- Rate limit violations

## Testing

To test rate limiting:
```bash
# Test store-key endpoint
for i in {1..15}; do
  curl -X POST https://api.example.com/api/wallet/store-key \
    -H "Content-Type: application/json" \
    -d '{"walletAddress":"0x..."}'
done
# Should return 429 after 10 requests
```

## Troubleshooting

### Rate Limit Not Working
1. Check Redis connection (environment variables)
2. Verify Redis keys are being created
3. Check console logs for errors

### Monitoring Not Logging
1. Verify Redis connection
2. Check console for error messages
3. Ensure `withMonitoring` wrapper is used correctly

### High Error Rates
1. Check endpoint logs for specific errors
2. Review rate limit configurations
3. Check Redis performance

