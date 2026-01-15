# API Endpoints Documentation

## Refund Automation

### POST `/api/positions/refund-automation`
Process all eligible refunds for `gas_sent_cap_failed` positions.

**Authentication:** Bearer token (set `REFUND_AUTOMATION_TOKEN`)

**Response:**
```json
{
  "success": true,
  "processed": 5,
  "successful": 4,
  "failed": 1,
  "skipped": 0,
  "results": [
    {
      "positionId": "pos_123",
      "success": true,
      "txHash": "0x..."
    }
  ]
}
```

### GET `/api/positions/refund-automation`
Get status of refund-eligible positions.

**Response:**
```json
{
  "success": true,
  "total": 10,
  "eligible": 5,
  "positions": [...]
}
```

## Dashboard Metrics

### GET `/api/dashboard/metrics`
Get comprehensive metrics for monitoring dashboard.

**Authentication:** Optional Bearer token (set `DASHBOARD_METRICS_TOKEN`)

**Response:**
```json
{
  "success": true,
  "timestamp": "2026-01-15T10:30:00Z",
  "supplyCap": {
    "currentSupply": "1000000.00",
    "supplyCap": "1050000.00",
    "utilizationPercent": 95.24,
    "recentFailures": 3,
    "recentWarnings": [...]
  },
  "positions": {
    "total": 150,
    "byStatus": {
      "active": 120,
      "failed": 5,
      "gas_sent_cap_failed": 3
    },
    "byStrategy": {
      "conservative": 140,
      "aggressive": 10
    },
    "recent24h": 25,
    "totalValue": 50000,
    "averageAmount": 333.33
  },
  "errors": {
    "totalErrors": 8,
    "byType": {
      "supply_cap": 3,
      "network_error": 2,
      "transaction_failed": 3
    },
    "recentErrors": [...],
    "rpcFailures": 5
  },
  "refunds": {
    "eligible": 3,
    "processed": 2,
    "pending": 1,
    "totalRefunded": "0.0120"
  }
}
```

## Testing Endpoints

### GET `/api/testing/test-endpoint?test=supply-cap&params[amount]=1000`
Test supply cap validation.

**Query Parameters:**
- `test`: Test type (`supply-cap`, `error-classification`, `flow-simulation`, `status-transitions`, `full-report`)
- `params[amount]`: USDC amount to test (default: 1000)
- `params[mockCap]`: Optional mock cap value
- `params[scenario]`: Flow scenario (`success`, `cap_exceeded`, `insufficient_balance`, `network_error`)
- `params[messages]`: Comma-separated error messages for classification test

**Authentication:** Bearer token (set `TEST_ENDPOINT_TOKEN`)

**Example Responses:**

**Supply Cap Test:**
```json
{
  "success": true,
  "result": {
    "success": true,
    "currentSupply": "1000000.00",
    "supplyCap": "1050000.00",
    "projectedTotal": "1001000.00",
    "utilizationPercent": 95.38,
    "wouldExceed": false
  }
}
```

**Full Test Report:**
```json
{
  "success": true,
  "report": {
    "supplyCapTest": {...},
    "errorClassification": {...},
    "flowSimulations": [...],
    "statusTransitions": [...]
  }
}
```

## Vercel Cron Configuration

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/positions/refund-automation",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

This runs refund automation every 6 hours.

## Environment Variables

Add these to Vercel:

```bash
# Refund Automation
REFUND_AUTOMATION_TOKEN=your_secret_token_here

# Dashboard Metrics
DASHBOARD_METRICS_TOKEN=your_secret_token_here

# Testing
TEST_ENDPOINT_TOKEN=your_secret_token_here

# Alerting (already added)
ALERTING_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```
