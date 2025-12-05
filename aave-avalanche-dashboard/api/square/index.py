"""
Vercel Python serverless function for Square API endpoints
Uses FastAPI with Mangum adapter for AWS Lambda/Vercel compatibility
"""
import os
import sys
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

# Import the router from app.square.endpoints
try:
    from app.square.endpoints import router
    router_available = True
except ImportError as e:
    # Fallback: if app module not available, create minimal router
    print(f"[Square API] Warning: Could not import app.square.endpoints: {e}")
    from fastapi import APIRouter
    router = APIRouter(prefix="/api/square", tags=["square"])
    router_available = False
    
    @router.get("/health")
    async def health_check():
        return {
            "status": "healthy",
            "service": "square-api",
            "python_version": sys.version.split()[0],
            "environment": os.getenv("VERCEL_ENV", "unknown"),
            "credentials_configured": bool(
                os.getenv("SQUARE_ACCESS_TOKEN") and os.getenv("SQUARE_LOCATION_ID")
            ),
            "note": "Using fallback handler - app.square.endpoints not available"
        }
    
    @router.post("/process-payment")
    async def process_payment_fallback():
        return {
            "success": False,
            "error": "Backend not fully configured. app.square.endpoints module not available."
        }

# Create FastAPI app
# Note: Don't add prefix here since router already has /api/square prefix
app = FastAPI(title="Square API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify actual origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the router (router already has /api/square prefix)
app.include_router(router)

# Create Mangum handler for Vercel/AWS Lambda
handler = Mangum(app, lifespan="off")

