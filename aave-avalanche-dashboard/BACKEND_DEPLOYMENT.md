# Backend Deployment Guide for Square Payments

## Current Issue

The frontend is deployed on Vercel but trying to call `localhost:8000`, which doesn't work in production.

## Solution Options

### Option 1: Deploy Backend to Vercel (Recommended)

1. **Create `vercel.json` in project root**:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "app/main.py",
      "use": "@vercel/python"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "app/main.py"
    },
    {
      "src": "/(.*)",
      "dest": "frontend/dist/$1"
    }
  ]
}
```

2. **Set environment variables in Vercel**:
   - `SQUARE_ACCESS_TOKEN`
   - `SQUARE_LOCATION_ID`
   - `SQUARE_API_BASE_URL=https://connect.squareup.com`

3. **Update frontend `.env` in Vercel**:
   - `VITE_API_BASE_URL=https://your-app.vercel.app` (same domain as frontend)

### Option 2: Use Same-Origin (Current Fix)

The code now defaults to `window.location.origin` in production, so if backend and frontend are on the same domain, it will work automatically.

### Option 3: Separate Backend Deployment

Deploy backend separately (Railway, Render, etc.) and set `VITE_API_BASE_URL` to that URL.

## Quick Fix for Testing

For now, the frontend will try to use the same origin. If your backend is deployed to Vercel on the same project, it should work.

If backend isn't deployed yet:
1. Deploy backend to Vercel
2. Set `VITE_API_BASE_URL` in Vercel environment variables to your backend URL
3. Redeploy frontend

## Testing Locally

1. Start backend: `uvicorn app.main:app --reload --port 8000`
2. Frontend will automatically use `http://localhost:8000` in dev mode
3. Test payment flow

