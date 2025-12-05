# TypeScript API Deployment Guide

## ✅ What Was Fixed

Switched from Python to TypeScript serverless functions for simpler Vercel deployment.

## File Structure

```
aave-avalanche-dashboard/
├── api/
│   └── square/
│       ├── process-payment.ts  ← Payment endpoint
│       ├── health.ts            ← Health check
│       └── test.ts              ← Test endpoint
├── package.json                 ← Root package.json (NEW)
├── vercel.json                  ← Updated config
└── frontend/
    └── package.json             ← Frontend deps
```

## Configuration

### vercel.json
- **Builds**: Explicitly builds `api/**/*.ts` with `@vercel/node`
- **Routes**: API routes handled before frontend catch-all

### package.json (root)
- Contains `@vercel/node` dependency for TypeScript functions

## Endpoints

1. **Health Check**: `GET /api/square/health`
2. **Process Payment**: `POST /api/square/process-payment`
3. **Test**: `GET /api/square/test`

## Deployment Steps

1. **Commit and push:**
   ```bash
   git add .
   git commit -m "Switch to TypeScript API functions"
   git push
   ```

2. **Verify in Vercel Dashboard:**
   - Go to Deployments → Latest
   - Check Functions tab
   - Should see:
     - `api/square/process-payment.ts`
     - `api/square/health.ts`
     - `api/square/test.ts`

3. **Test endpoints:**
   ```bash
   # Health check
   curl https://aave-balance-checker-84.vercel.app/api/square/health
   
   # Test endpoint
   curl https://aave-balance-checker-84.vercel.app/api/square/test
   ```

## Environment Variables

Make sure these are set in Vercel:
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_LOCATION_ID`
- `SQUARE_ENVIRONMENT` (production or sandbox)

## Troubleshooting

### Still getting 404?

1. **Check Vercel Functions tab** - Functions should appear after deployment
2. **Check build logs** - Look for TypeScript compilation errors
3. **Verify file paths** - Files must be in `api/square/` folder
4. **Test with test endpoint** - `/api/square/test` should work first

### If functions don't appear:

1. Check Vercel project root directory setting
2. Verify `vercel.json` is in project root
3. Ensure `package.json` exists in root with `@vercel/node`

## Expected Behavior

✅ TypeScript functions auto-detect in `api/` folder
✅ No Python runtime needed
✅ Faster cold starts
✅ Simpler deployment

