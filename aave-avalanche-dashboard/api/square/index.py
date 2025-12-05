"""
Vercel serverless function for Square API endpoints
File location: /api/square/index.py
This replaces your minimal handler with the full FastAPI implementation
"""
import sys
import os
import traceback

print("[Square API] Initializing...")

try:
    from mangum import Mangum
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel, Field

    print("[Square API] Dependencies imported successfully")

    # Create FastAPI app
    app = FastAPI(title="Square Payment API")

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Request model
    class PaymentRequest(BaseModel):
        source_id: str = Field(..., description="Square payment token")
        amount: int = Field(..., description="Amount in cents")
        currency: str = Field(default="USD")
        idempotency_key: str = Field(..., description="Unique request ID")

    # Logging middleware
    @app.middleware("http")
    async def log_requests(request, call_next):
        print(f"[Square API] {request.method} {request.url.path}")
        try:
            response = await call_next(request)
            print(f"[Square API] Response: {response.status_code}")
            return response
        except Exception as e:
            print(f"[Square API] Request error: {e}")
            traceback.print_exc()
            return JSONResponse(
                status_code=500,
                content={"error": "REQUEST_ERROR", "message": str(e)}
            )

    # Health check endpoint
    @app.get("/api/square/health")
    async def health_check():
        """Health check endpoint"""
        return {
            "status": "healthy",
            "service": "square-payment-api",
            "python_version": sys.version.split()[0],
            "environment": {
                "SQUARE_ACCESS_TOKEN": "set" if os.getenv("SQUARE_ACCESS_TOKEN") else "MISSING",
                "SQUARE_LOCATION_ID": "set" if os.getenv("SQUARE_LOCATION_ID") else "MISSING",
                "SQUARE_ENVIRONMENT": os.getenv("SQUARE_ENVIRONMENT", "not_set")
            }
        }

    # Payment processing endpoint
    @app.post("/api/square/process-payment")
    async def process_payment(payment: PaymentRequest):
        """Process Square payment"""
        try:
            print(f"[Square API] Processing payment: {payment.amount} cents")

            # Get environment variables
            access_token = os.getenv("SQUARE_ACCESS_TOKEN")
            location_id = os.getenv("SQUARE_LOCATION_ID")
            environment = os.getenv("SQUARE_ENVIRONMENT", "sandbox")

            # Validate configuration
            if not access_token:
                print("[Square API] ERROR: SQUARE_ACCESS_TOKEN not configured")
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error": "CONFIGURATION_ERROR",
                        "message": "SQUARE_ACCESS_TOKEN environment variable not set",
                        "hint": "Configure in Vercel Project Settings → Environment Variables"
                    }
                )

            if not location_id:
                print("[Square API] ERROR: SQUARE_LOCATION_ID not configured")
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error": "CONFIGURATION_ERROR",
                        "message": "SQUARE_LOCATION_ID environment variable not set",
                        "hint": "Configure in Vercel Project Settings → Environment Variables"
                    }
                )

            print(f"[Square API] Environment: {environment}")
            print(f"[Square API] Location: {location_id[:8]}...")

            # Import Square SDK
            try:
                from square.client import Client
                print("[Square API] Square SDK imported")
            except ImportError as e:
                print(f"[Square API] ERROR: Square SDK import failed: {e}")
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error": "DEPENDENCY_ERROR",
                        "message": "Square SDK not available",
                        "hint": "Ensure 'squareup' is in requirements.txt"
                    }
                )

            # Initialize Square client
            try:
                client = Client(
                    access_token=access_token,
                    environment=environment
                )
                print("[Square API] Square client initialized")
            except Exception as e:
                print(f"[Square API] Client initialization error: {e}")
                traceback.print_exc()
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error": "CLIENT_INIT_ERROR",
                        "message": str(e)
                    }
                )

            # Create payment
            try:
                print(f"[Square API] Calling Square Payments API...")
                result = client.payments.create_payment(
                    body={
                        "source_id": payment.source_id,
                        "idempotency_key": payment.idempotency_key,
                        "amount_money": {
                            "amount": payment.amount,
                            "currency": payment.currency
                        },
                        "location_id": location_id,
                        "autocomplete": True
                    }
                )

                print(f"[Square API] Square API responded")

                if result.is_success():
                    payment_data = result.body.get("payment", {})
                    payment_id = payment_data.get("id")
                    status = payment_data.get("status")

                    print(f"[Square API] ✓ Payment successful: {payment_id}")

                    return {
                        "success": True,
                        "payment_id": payment_id,
                        "status": status,
                        "amount": payment_data.get("amount_money", {}).get("amount"),
                        "currency": payment_data.get("amount_money", {}).get("currency"),
                        "receipt_url": payment_data.get("receipt_url"),
                        "receipt_number": payment_data.get("receipt_number")
                    }

                elif result.is_error():
                    errors = result.errors
                    print(f"[Square API] ✗ Payment failed: {errors}")

                    error_details = [
                        {
                            "code": err.get("code", "UNKNOWN"),
                            "category": err.get("category", "UNKNOWN"),
                            "detail": err.get("detail", "No detail provided"),
                            "field": err.get("field")
                        }
                        for err in errors
                    ]

                    raise HTTPException(
                        status_code=400,
                        detail={
                            "error": "PAYMENT_FAILED",
                            "message": "Square rejected the payment",
                            "square_errors": error_details
                        }
                    )

            except HTTPException:
                raise
            except Exception as e:
                print(f"[Square API] Payment creation error: {e}")
                traceback.print_exc()
                raise HTTPException(
                    status_code=500,
                    detail={
                        "error": "PAYMENT_ERROR",
                        "message": f"Failed to create payment: {str(e)}",
                        "type": type(e).__name__
                    }
                )

        except HTTPException:
            raise
        except Exception as e:
            print(f"[Square API] Unexpected error: {e}")
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "INTERNAL_ERROR",
                    "message": str(e),
                    "type": type(e).__name__
                }
            )

    # Global exception handler
    @app.exception_handler(Exception)
    async def global_exception_handler(request, exc):
        print(f"[Square API] Global exception: {exc}")
        traceback.print_exc()
        return JSONResponse(
            status_code=500,
            content={
                "error": "UNHANDLED_EXCEPTION",
                "message": str(exc),
                "type": type(exc).__name__,
                "path": str(request.url.path)
            }
        )

    # Create Mangum handler for Vercel
    handler = Mangum(app, lifespan="off")

    print("[Square API] ✓ Handler created successfully")
    print(f"[Square API] ✓ Routes: {[route.path for route in app.routes]}")

except ImportError as e:
    print(f"[Square API] CRITICAL: Import failed: {e}")
    traceback.print_exc()
    
    # Create fallback handler
    def fallback_handler(event, context):
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": '{"error": "IMPORT_ERROR", "message": "Required packages not installed. Check requirements.txt"}'
        }
    handler = fallback_handler

except Exception as e:
    print(f"[Square API] CRITICAL: Initialization failed: {e}")
    traceback.print_exc()
    
    # Create fallback handler
    def fallback_handler(event, context):
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": '{"error": "INIT_ERROR", "message": "Function initialization failed"}'
        }
    handler = fallback_handler

# Ensure handler is always defined (critical for Vercel)
if 'handler' not in locals():
    print("[Square API] CRITICAL: Handler not defined, creating emergency fallback")
    def handler(event, context):
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": '{"error": "HANDLER_NOT_DEFINED", "message": "Handler variable not set"}'
        }

print(f"[Square API] Handler type: {type(handler)}")
print("[Square API] Initialization complete")
