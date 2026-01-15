# Rate Limiting System Enhancements

**Date:** January 14, 2026  
**Status:** Implemented ✅

---

## Implemented Enhancements

### ✅ 1. Device Fingerprinting (4th Factor)

**Status:** ✅ Implemented  
**Location:** `api/wallet/rateLimit.ts:67-75, 315-395`

**Enhancement:**
- Added optional device fingerprinting as 4th factor in multi-factor rate limiting
- Combines user-agent + accept-language + accept-encoding
- Hashed for privacy (SHA-256, truncated)
- Stricter limit: 80% of base (between IP and wallet/email)

**Implementation:**
```typescript
function generateDeviceFingerprint(req: VercelRequest): string {
  const userAgent = req.headers['user-agent'] || '';
  const acceptLanguage = req.headers['accept-language'] || '';
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const fingerprint = `${userAgent}|${acceptLanguage}|${acceptEncoding}`;
  return hashIdentifier(fingerprint);
}
```

**Usage:**
```typescript
const result = await checkMultiFactorRateLimit(req, config, {
  email: userEmail,
  wallet: walletAddress,
  includeDeviceFingerprint: true // Enable 4th factor
});
```

**Benefits:**
- ✅ Bypass resistance (prevents proxy rotation attacks)
- ✅ Device-level tracking (complements IP/wallet/email)
- ✅ Privacy-compliant (hashed identifiers)

---

### ✅ 2. Retry-After Header

**Status:** ✅ Implemented  
**Location:** `api/wallet/rateLimit.ts:24-31, 240-250, 390-395`

**Enhancement:**
- Added `retryAfter` field to `RateLimitResult`
- Automatically calculated in seconds until retry allowed
- Set as `Retry-After` header on 429 responses (RFC 7231)
- Included in error response body

**Implementation:**
```typescript
// Calculate retry-after for blocked requests
if (!result.allowed) {
  result.retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
}

// Set header on 429 response
if (rateLimitResult.retryAfter) {
  res.setHeader('Retry-After', rateLimitResult.retryAfter.toString());
}
```

**Benefits:**
- ✅ Standard compliance (RFC 7231)
- ✅ Better client UX (knows exactly when to retry)
- ✅ Reduces unnecessary retry attempts

---

### ✅ 3. Enhanced Violation Tracking

**Status:** ✅ Implemented  
**Location:** `api/wallet/rateLimit.ts:125-200`

**Enhancement:**
- Tracks violations by factor (IP, wallet, email, device)
- Aggregates total violations per endpoint
- Anomaly detection (alerts if >20 violations/hour)
- External alerting integration (webhook)

**Implementation:**
```typescript
async function trackViolationByFactor(
  endpoint: string,
  clientId: string,
  req: VercelRequest
): Promise<void> {
  // Track per-factor violations
  const factorKey = `monitoring:rate_limit:${factor}_violations:${endpoint}`;
  await redis.incr(factorKey);
  
  // Track total violations
  const totalKey = `monitoring:rate_limit:total_violations:${endpoint}`;
  await redis.incr(totalKey);
  
  // Anomaly detection
  if (totalViolations > 20) {
    // Trigger alert
  }
}
```

**Redis Keys:**
- `monitoring:rate_limit:ip_violations:{endpoint}` - IP violations
- `monitoring:rate_limit:wallet_violations:{endpoint}` - Wallet violations
- `monitoring:rate_limit:email_violations:{endpoint}` - Email violations
- `monitoring:rate_limit:total_violations:{endpoint}` - Total violations
- TTL: 1 hour (rolling window)

**Benefits:**
- ✅ Per-factor visibility (identify attack patterns)
- ✅ Anomaly detection (automatic alerting)
- ✅ External alerting (Slack/PagerDuty integration)

---

### ✅ 4. Enhanced Header Feedback

**Status:** ✅ Implemented  
**Location:** `api/wallet/store-key.ts:266-285`

**Enhancement:**
- Rate limit headers always set (even on success)
- `Retry-After` header on 429 responses
- Standardized error response format
- Consistent header format across endpoints

**Headers Set:**
- `X-RateLimit-Limit` - Maximum requests allowed
- `X-RateLimit-Remaining` - Remaining requests
- `X-RateLimit-Reset` - ISO timestamp when limit resets
- `Retry-After` - Seconds until retry (429 only)

**Response Format (429):**
```json
{
  "success": false,
  "error": "rate_limit_exceeded",
  "message": "Too many requests. Please try again after <timestamp>",
  "retryAfter": 3600
}
```

**Benefits:**
- ✅ Standard compliance (RFC 7231)
- ✅ Better client UX
- ✅ Consistent API behavior

---

## Multi-Factor Rate Limiting Summary

| Factor | Limit Multiplier | Use Case | Bypass Resistance |
|--------|------------------|----------|-------------------|
| IP Address | 100% (base) | Primary identifier | Low (proxies) |
| Wallet Address | 70% (stricter) | High-risk operations | Medium |
| Email Address | 70% (stricter) | High-risk operations | Medium |
| Device Fingerprint | 80% (moderate) | Bypass resistance | High |

**Block Decision:** Blocks if **ANY** factor exceeds limit

---

## Anomaly Detection

### Thresholds

- **High Violation Rate:** >20 violations/hour per endpoint
- **Alert Severity:** Warning
- **Alert Channel:** External webhook (if configured)

### Alert Payload

```json
{
  "type": "rate_limit_anomaly",
  "severity": "warning",
  "timestamp": "2026-01-14T12:00:00Z",
  "data": {
    "endpoint": "store-key",
    "violations": 25,
    "factor": "ip",
    "threshold": 20
  }
}
```

---

## Configuration

### Environment Variables

```bash
# Optional: Disable rate limiting (development only)
DISABLE_RATE_LIMIT=false

# Optional: Alerting webhook for anomalies
ALERTING_WEBHOOK_URL=https://hooks.slack.com/services/...
```

### Usage Example

```typescript
// Standard rate limiting
const result = await checkRateLimit(req, {
  ...RATE_LIMITS.STORE_KEY,
  identifier: walletAddress
});

// Multi-factor with device fingerprinting
const result = await checkMultiFactorRateLimit(req, {
  ...RATE_LIMITS.STORE_KEY,
  identifier: walletAddress
}, {
  email: userEmail,
  wallet: walletAddress,
  includeDeviceFingerprint: true // Enable 4th factor
});

// Set headers (helper function)
res.setHeader('X-RateLimit-Limit', result.limit.toString());
res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
res.setHeader('X-RateLimit-Reset', new Date(result.resetAt).toISOString());
if (result.retryAfter) {
  res.setHeader('Retry-After', result.retryAfter.toString());
}
```

---

## Security Improvements

### Before vs After

| Feature | Before | After |
|---------|--------|-------|
| Factors | 3 (IP, wallet, email) | 4 (IP, wallet, email, device) |
| Bypass Resistance | Medium | High |
| Header Feedback | Basic | Enhanced (Retry-After) |
| Violation Tracking | Basic logging | Per-factor + anomaly detection |
| Alerting | None | Automatic (webhook) |

---

## Recommendations (Future Enhancements)

### High Priority

1. **CAPTCHA Integration**
   - Trigger after 3-5 IP failures
   - Use hCaptcha or similar
   - Prevents automated abuse

2. **Dynamic/Adaptive Limits**
   - Adjust limits based on risk profile
   - Auto-tighten during anomalies
   - Store dynamic config in Redis

### Medium Priority

3. **Lua Script Optimization**
   - Wrap check + increment + cleanup in Lua
   - Single roundtrip (faster)
   - Atomic operations

4. **Token Bucket Hybrid**
   - Sliding window for strict paths
   - Token bucket for others
   - Allows controlled bursts

5. **Metrics Export**
   - Export to Datadog/Prometheus
   - Create dashboards
   - Track trends over time

---

## Testing

### Test Device Fingerprinting

```bash
# Test with device fingerprinting enabled
curl -X POST /api/wallet/store-key \
  -H "User-Agent: Mozilla/5.0..." \
  -H "Accept-Language: en-US" \
  -d '{"walletAddress": "0x...", ...}'
```

### Test Retry-After Header

```bash
# Exceed rate limit
for i in {1..15}; do
  curl -X POST /api/wallet/store-key ...
done

# Check response headers
curl -i -X POST /api/wallet/store-key ...
# Should include: Retry-After: 3600
```

### Test Anomaly Detection

```bash
# Trigger >20 violations in 1 hour
# Should trigger webhook alert (if configured)
```

---

## Production Deployment Checklist

- [x] Device fingerprinting implemented
- [x] Retry-After header implemented
- [x] Enhanced violation tracking implemented
- [x] Anomaly detection implemented
- [ ] Configure `ALERTING_WEBHOOK_URL` in Vercel
- [ ] Test device fingerprinting with real requests
- [ ] Monitor violation rates in production
- [ ] Adjust anomaly thresholds if needed

---

## Conclusion

The rate limiting system now includes:

- ✅ **Device fingerprinting** (4th factor, bypass resistance)
- ✅ **Retry-After header** (RFC 7231 compliance)
- ✅ **Enhanced violation tracking** (per-factor, anomaly detection)
- ✅ **Automatic alerting** (webhook integration)

These enhancements significantly improve bypass resistance and observability while maintaining usability.

---

**Last Updated:** January 14, 2026  
**Next Review:** February 1, 2026
