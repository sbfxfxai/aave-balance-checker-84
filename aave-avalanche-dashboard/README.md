# Aave V3 Dashboard on Avalanche

Production-grade dashboard for interacting with Aave V3 on Avalanche C-Chain. Features wallet integration, deposit/withdraw flows, and real-time position monitoring.

## Features

- Trust Wallet integration via WalletConnect v2
- Deposit AVAX → convert to USDC.e → supply to Aave
- Withdraw USDC.e → convert to AVAX → send to wallet
- Real-time position monitoring (supplied, borrowed, health factor)
- Transaction bundling for efficient operations

## Tech Stack

- Python 3.10+
- FastAPI (backend)
- eth-defi (Aave v3 and swap integrations)
- Web3.py (blockchain interactions)
- HTML/CSS/JS (frontend)

---

## Setup and Running the Application

1. **Install dependencies**:

```bash
pip install -r requirements.txt
```

1. **Start backend server**:

```bash
uvicorn app.main:app --reload
```

1. **Open frontend**:
   - Navigate to `app/dashboard/templates/index.html`
   - Open this file in a web browser

## Configuration

Copy `.env.example` to `.env` and set your environment variables:

```env
AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc
```
