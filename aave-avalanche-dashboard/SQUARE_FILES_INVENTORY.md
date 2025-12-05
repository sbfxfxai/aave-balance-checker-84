# Square Payment Processing - Complete File Inventory

## Core Backend Files

### Python Serverless Function (Vercel)
- **`api/square/index.py`** - Vercel serverless function entry point
  - Wraps FastAPI app with Mangum adapter
  - Handles `/api/square/*` routes
  - Includes CORS middleware
  - Imports router from `app.square.endpoints`

### FastAPI Router
- **`app/square/endpoints.py`** - Main payment processing endpoints
  - `GET /api/square/health` - Health check endpoint
  - `POST /api/square/process-payment` - Payment processing endpoint
  - Handles Square API integration
  - Error handling and validation

### Module Init
- **`app/square/__init__.py`** - Python package initialization

## Frontend Files

### Payment Form Component
- **`frontend/src/components/stack/SquarePaymentForm.tsx`** - React payment form component
  - Square Web Payments SDK integration
  - Card tokenization
  - Form UI and error handling

### Styles
- **`frontend/src/components/stack/SquarePaymentForm.module.css`** - Payment form styles

### Payment Library
- **`frontend/src/lib/square.ts`** - Square payment processing library
  - `processSquarePayment()` - Main payment processing function
  - `processUSDPayment()` - USD payment handler
  - `processBitcoinPayment()` - Bitcoin payment handler
  - Configuration validation
  - API URL resolution

### Deposit Modal
- **`frontend/src/components/stack/DepositModal.tsx`** - Deposit modal component
  - Uses SquarePaymentForm
  - Handles payment success/error callbacks
  - Integrates with deposit flow

### Stack App Page
- **`frontend/src/pages/StackApp.tsx`** - Stack app page that uses Square payments

### Documentation
- **`frontend/src/components/stack/README.md`** - Component documentation

## Configuration Files

### Vercel Configuration
- **`vercel.json`** - Vercel deployment configuration
  - Routes `/api/square/(.*)` to `/api/square/index.py`
  - Python runtime configuration
  - Frontend build configuration

### Main App Integration
- **`app/main.py`** - Main FastAPI app
  - Includes Square router: `app.include_router(square_endpoints.router)`

### HTML Integration
- **`frontend/index.html`** - Contains Square SDK script tag

## Documentation Files

### Setup & Deployment
- **`SQUARE_BACKEND_SETUP.md`** - Backend setup instructions
- **`SQUARE_SETUP_COMPLETE.md`** - Setup completion checklist
- **`STACK_APP_SETUP.md`** - Stack app setup guide
- **`BACKEND_DEPLOYMENT.md`** - Backend deployment guide
- **`VERCEL_DEPLOYMENT_CHECK.md`** - Vercel deployment verification
- **`VERCEL_DEPLOYMENT_CHECKLIST.md`** - Deployment checklist
- **`VERCEL_DEPLOYMENT_VERIFICATION.md`** - Deployment verification steps
- **`VERCEL_404_TROUBLESHOOTING.md`** - 404 error troubleshooting
- **`VERCEL_ENV_SETUP.md`** - Environment variables setup
- **`VERCEL_ENV_FIX.md`** - Environment variable fixes
- **`DEBUGGING_404_ERROR.md`** - 404 debugging guide
- **`DEPLOYMENT_STATUS.md`** - Deployment status tracking
- **`DEPLOYMENT_VERIFICATION.md`** - Deployment verification
- **`CHECK_DEPLOYMENT.md`** - Deployment check steps
- **`FOOD_APP_COMPARISON.md`** - Comparison with working food app

### Configuration & Environment
- **`MISSING_ENV_VARIABLES.md`** - Environment variables documentation
- **`CONSOLE_WARNINGS_EXPLAINED.md`** - Console warnings guide

## File Structure

```
aave-avalanche-dashboard/
├── api/
│   └── square/
│       └── index.py                    # Vercel serverless function
│
├── app/
│   ├── main.py                         # Includes Square router
│   └── square/
│       ├── __init__.py                 # Package init
│       └── endpoints.py                # Payment endpoints
│
├── frontend/
│   ├── index.html                      # Square SDK script tag
│   └── src/
│       ├── components/
│       │   └── stack/
│       │       ├── DepositModal.tsx    # Deposit modal
│       │       ├── SquarePaymentForm.tsx      # Payment form
│       │       ├── SquarePaymentForm.module.css # Styles
│       │       └── README.md           # Component docs
│       │
│       ├── lib/
│       │   └── square.ts               # Payment processing library
│       │
│       └── pages/
│           └── StackApp.tsx            # Stack app page
│
├── vercel.json                         # Vercel configuration
│
└── [Documentation files listed above]
```

## Key Files Summary

### Critical for Deployment:
1. ✅ `api/square/index.py` - Serverless function (COMMITTED)
2. ✅ `app/square/endpoints.py` - Payment endpoints (COMMITTED)
3. ✅ `vercel.json` - Vercel config (COMMITTED)

### Critical for Frontend:
1. ✅ `frontend/src/lib/square.ts` - Payment processing
2. ✅ `frontend/src/components/stack/SquarePaymentForm.tsx` - Payment form
3. ✅ `frontend/index.html` - Square SDK script

### Environment Variables Needed:
- `SQUARE_ACCESS_TOKEN` - Backend
- `SQUARE_LOCATION_ID` - Backend & Frontend
- `SQUARE_API_BASE_URL` - Backend
- `VITE_SQUARE_APPLICATION_ID` - Frontend
- `VITE_SQUARE_LOCATION_ID` - Frontend
- `VITE_SQUARE_ENVIRONMENT` - Frontend

## File Status

### Committed to Git:
- ✅ `api/square/index.py`
- ✅ `app/square/endpoints.py`
- ✅ `vercel.json`

### Modified but Not Committed:
- ⚠️ `app/main.py` (includes Square router)
- ⚠️ `frontend/src/lib/square.ts`
- ⚠️ `frontend/src/components/stack/SquarePaymentForm.tsx`
- ⚠️ `frontend/index.html`

### Untracked:
- ❓ `app/square/__init__.py`
- ❓ `frontend/src/components/stack/SquarePaymentForm.module.css`
- ❓ `frontend/src/components/stack/DepositModal.tsx`
- ❓ `frontend/src/pages/StackApp.tsx`

