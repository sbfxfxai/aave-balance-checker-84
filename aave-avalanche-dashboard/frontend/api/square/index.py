"""
Vercel serverless function for Square API endpoints
Located at /api/square/index.py to automatically handle /api/square/* routes
"""
import sys
import os

# Add parent directories to path
# When deployed from frontend/, we need to go up to aave-avalanche-dashboard/ to find app/
current_file = os.path.abspath(__file__)
# frontend/api/square/index.py -> go up 3 levels to aave-avalanche-dashboard/
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(current_file))))
sys.path.insert(0, project_root)

# Debug: Log path setup
print(f"[Square API] Project root: {project_root}")
print(f"[Square API] Python path: {sys.path[:3]}")

try:
    # These packages are installed by Vercel during deployment (see requirements.txt)
    # IDE warnings are expected if packages aren't installed locally
    from mangum import Mangum  # type: ignore
    from fastapi import FastAPI  # type: ignore
    from fastapi.middleware.cors import CORSMiddleware  # type: ignore
    from app.square.endpoints import router
    
    print("[Square API] Successfully imported dependencies")
except ImportError as e:
    print(f"[Square API] Import error: {e}")
    raise

# Create FastAPI app with Square router
# Note: Router already has prefix="/api/square", so routes will be /api/square/process-payment, etc.
app = FastAPI(title="Square Payment API")

# Add CORS middleware for cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include router - it already has prefix="/api/square"
app.include_router(router)

# Debug: Log registered routes
print(f"[Square API] Registered routes: {[route.path for route in app.routes]}")

# Export handler for Vercel Python runtime
handler = Mangum(app, lifespan="off")

print("[Square API] Handler initialized successfully")

