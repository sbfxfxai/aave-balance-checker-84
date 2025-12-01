from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.dashboard import views as dashboard_views
from app.wallet import endpoints as wallet_endpoints
from app.transactions import endpoints as transactions_endpoints
from app.config import CHAIN_ID, RPC_URL

app = FastAPI(title="Aave Avalanche Dashboard")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(dashboard_views.router)
app.include_router(wallet_endpoints.router)
app.include_router(transactions_endpoints.router, prefix="/transactions")

@app.get("/")
def home():
    return {
        "name": "Aave V3 Dashboard",
        "chain": "Avalanche",
        "chain_id": CHAIN_ID,
        "rpc_url": RPC_URL
    }
