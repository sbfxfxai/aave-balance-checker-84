"""
Vercel serverless function for Square payment processing
Creates a FastAPI app with only the Square router and wraps it with Mangum
"""
import sys
import os
from pathlib import Path

# Setup paths first
try:
    project_root = Path(__file__).parent.parent.parent
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))
    print(f"[Square API] Project root: {project_root}")
    print(f"[Square API] Current directory: {os.getcwd()}")
    print(f"[Square API] Python executable: {sys.executable}")
    print(f"[Square API] Python version: {sys.version}")
except Exception as e:
    print(f"[Square API] Path setup error: {e}")
    import traceback
    traceback.print_exc()

# Try to create the app
app = None
handler = None

try:
    print("[Square API] Attempting to import FastAPI...")
    from fastapi import FastAPI
    print("[Square API] FastAPI imported successfully")
    
    print("[Square API] Attempting to import CORSMiddleware...")
    from fastapi.middleware.cors import CORSMiddleware
    print("[Square API] CORSMiddleware imported successfully")
    
    print("[Square API] Attempting to import square endpoints...")
    from app.square import endpoints as square_endpoints
    print("[Square API] Square endpoints imported successfully")
    
    # Create FastAPI app
    print("[Square API] Creating FastAPI app...")
    app = FastAPI(title="Square Payment API")
    
    # Add CORS
    print("[Square API] Adding CORS middleware...")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Include router
    print("[Square API] Including router...")
    app.include_router(square_endpoints.router)
    print("[Square API] Router included successfully")
    
except ImportError as e:
    print(f"[Square API] CRITICAL IMPORT ERROR: {e}")
    import traceback
    traceback.print_exc()
    
    # Create error app that will return helpful error messages
    try:
        from fastapi import FastAPI
        from fastapi.responses import JSONResponse
        app = FastAPI(title="Square Payment API - Import Error")
        
        @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
        async def error_handler(request):
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Import error",
                    "message": f"Failed to import required modules: {str(e)}",
                    "type": type(e).__name__,
                    "help": "Check Vercel logs for full traceback. Verify requirements.txt includes: fastapi, mangum, pydantic, requests"
                }
            )
    except Exception as e2:
        print(f"[Square API] Failed to create error app: {e2}")
        import traceback
        traceback.print_exc()
        app = None
        
except Exception as e:
    print(f"[Square API] CRITICAL SETUP ERROR: {e}")
    import traceback
    traceback.print_exc()
    app = None

# Wrap with Mangum
if app is None:
    print("[Square API] ERROR: App is None, creating fallback handler")
    
    def fallback_handler(event, context):
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": '{"error": "Handler initialization failed", "message": "App is None - check Vercel logs for import errors"}'
        }
    handler = fallback_handler
    
else:
    try:
        print("[Square API] Attempting to import Mangum...")
        from mangum import Mangum
        print("[Square API] Mangum imported successfully")
        
        print("[Square API] Wrapping app with Mangum...")
        handler = Mangum(app, lifespan="off")
        print("[Square API] Handler created successfully")
        
    except ImportError as e:
        print(f"[Square API] Mangum import failed: {e}")
        print("[Square API] Using app directly (may not work with Vercel)")
        handler = app
    except Exception as e:
        print(f"[Square API] Handler creation error: {e}")
        import traceback
        traceback.print_exc()
        handler = app

print("[Square API] Handler initialization complete")
print(f"[Square API] Handler type: {type(handler)}")
print(f"[Square API] Handler: {handler}")

# CRITICAL: Ensure handler is always defined
if handler is None:
    print("[Square API] CRITICAL: Handler is None, creating emergency fallback")
    def emergency_handler(event, context):
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": '{"error": "Handler not initialized", "message": "Check Vercel logs for initialization errors"}'
        }
    handler = emergency_handler

# Export handler for Vercel (must be at module level)
print(f"[Square API] Final handler type: {type(handler)}")
