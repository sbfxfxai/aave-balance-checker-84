from fastapi import FastAPI  # type: ignore
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.staticfiles import StaticFiles  # type: ignore
from app.dashboard import views as dashboard_views
from app.wallet import endpoints as wallet_endpoints
from app.transactions import endpoints as transactions_endpoints
from app.square import endpoints as square_endpoints
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

# Serve React frontend (after building)
app.mount("/", StaticFiles(directory="../frontend/dist", html=True), name="frontend")

# Include API routers
app.include_router(dashboard_views.router)
app.include_router(wallet_endpoints.router)
app.include_router(transactions_endpoints.router, prefix="/transactions")
app.include_router(square_endpoints.router)

@app.get("/")
def home():
    return {
        "name": "Aave V3 Dashboard",
        "chain": "Avalanche",
        "chain_id": CHAIN_ID,
        "rpc_url": RPC_URL
    }

# Vercel serverless function handler
# Export handler for Vercel Python runtime
try:
    from mangum import Mangum  # type: ignore
    handler = Mangum(app, lifespan="off")
    print("[Vercel] Mangum handler initialized successfully")
except ImportError as e:
    print(f"[Vercel] Mangum import failed: {e}")
    # Fallback if mangum not available
    handler = app
except Exception as e:
    print(f"[Vercel] Handler initialization error: {e}")
    handler = app
