# Local Development Guide

## Quick Start

### Frontend Development

1. **Install Dependencies**
   ```bash
   cd frontend
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```
   
   The frontend will be available at: **http://localhost:5173**

### API Routes (Serverless)

The API routes are deployed on Vercel. For local development, you have two options:

#### Option 1: Use Production/Staging API (Recommended for Frontend Dev)
- The frontend will automatically use the deployed API endpoints
- No additional setup needed
- Works out of the box

#### Option 2: Run Vercel Dev Locally (For API Development)

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Start Vercel Dev Server**
   ```bash
   vercel dev
   ```
   
   This will:
   - Start local API server (usually on port 3000)
   - Proxy API requests to local server
   - Allow you to test API changes locally

3. **Environment Variables**
   - Create `.env.local` file in root directory
   - Add required environment variables:
     ```
     HUB_WALLET_PRIVATE_KEY=...
     HUB_WALLET_ADDRESS=...
     AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
     KV_REST_API_URL=...
     KV_REST_API_TOKEN=...
     SQUARE_WEBHOOK_SIGNATURE_KEY=...
     ```

## Development Workflow

### Frontend Only
```bash
cd frontend
npm run dev
```
- Edit frontend code
- Hot reload enabled
- API calls go to production/staging

### Full Stack (Frontend + API)
```bash
# Terminal 1: Frontend
cd frontend
npm run dev

# Terminal 2: API (Vercel Dev)
vercel dev
```
- Edit both frontend and API code
- Full local development environment

## Available Scripts

### Frontend
- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

### Contracts (if needed)
```bash
cd contracts
npm install
npm run compile
npm run test
```

## Environment Variables

### Frontend (.env.local in frontend/)
```
VITE_WALLETCONNECT_PROJECT_ID=...
VITE_PRIVY_APP_ID=...
```

### API (.env.local in root/)
```
HUB_WALLET_PRIVATE_KEY=...
HUB_WALLET_ADDRESS=...
AVALANCHE_RPC_URL=...
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
SQUARE_WEBHOOK_SIGNATURE_KEY=...
```

## Troubleshooting

### Port Already in Use
If port 5173 is in use:
```bash
# Vite will automatically try the next available port
# Or specify a different port:
npm run dev -- --port 3000
```

### API Errors
- Check that environment variables are set
- Verify API endpoints are accessible
- Check browser console for errors

### Build Errors
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

## Development Tips

1. **Hot Reload**: Vite provides instant hot module replacement
2. **TypeScript**: Type checking happens in real-time
3. **ESLint**: Linting runs automatically in most IDEs
4. **API Testing**: Use browser DevTools Network tab to inspect API calls

## Next Steps

- Frontend is running at http://localhost:5173
- Open in browser to see the application
- Make changes and see them instantly

