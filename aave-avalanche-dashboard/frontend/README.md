# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/5984adeb-813b-4511-b385-6cbb43806d8f

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/5984adeb-813b-4511-b385-6cbb43806d8f) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Environment Variables (Production)

For production deployment, configure these environment variables in Vercel or your hosting platform:

### Required Variables

- **`VITE_WALLETCONNECT_PROJECT_ID`** (Required in production)
  - Get a free project ID at https://cloud.walletconnect.com
  - Used for WalletConnect QR code wallet connections
  - Example: `392a0f60dab84b8a1d2a2773b55f3aa1`

### Optional Variables

- **`VITE_AVALANCHE_RPC_URL`** (Optional, recommended for production)
  - Dedicated RPC provider URL for better reliability and rate limits
  - Default: `https://api.avax.network/ext/bc/C/rpc` (public Avalanche RPC)
  - Recommended providers: Infura, Alchemy, QuickNode, or Ankr
  - Example: `https://avalanche-mainnet.infura.io/v3/YOUR_API_KEY`

### Setting Environment Variables

**For Vercel:**
1. Go to your project settings
2. Navigate to "Environment Variables"
3. Add each variable with the `VITE_` prefix
4. Redeploy your application

**For local development:**
Create a `.env` file in the `frontend/` directory:
```env
VITE_AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/5984adeb-813b-4511-b385-6cbb43806d8f) and click on Share -> Publish.

**Important:** Before deploying to production, ensure you've set `VITE_WALLETCONNECT_PROJECT_ID` in your hosting platform's environment variables.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
