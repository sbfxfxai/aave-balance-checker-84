"""
Square API endpoints with enhanced error handling and debugging
"""
import os
import traceback
import sys
import json
from fastapi import APIRouter, HTTPException, Request  # type: ignore[import-untyped]
from fastapi.responses import JSONResponse  # type: ignore[import-untyped]
from pydantic import BaseModel, Field  # type: ignore[import-untyped]
from typing import Optional
import requests  # pyright: ignore[reportMissingModuleSource]

router = APIRouter(prefix="/api/square", tags=["square"])

# Square API Configuration
SQUARE_ACCESS_TOKEN = os.getenv("SQUARE_ACCESS_TOKEN", "")
SQUARE_LOCATION_ID = os.getenv("SQUARE_LOCATION_ID", "")
SQUARE_API_BASE_URL = os.getenv("SQUARE_API_BASE_URL", "https://connect.squareup.com")
SQUARE_ENVIRONMENT = os.getenv("SQUARE_ENVIRONMENT", "production")


# Pydantic models for request validation
class PaymentRequest(BaseModel):
    source_id: str = Field(..., description="Square payment token from card.tokenize()")
    amount: float = Field(..., description="Amount in dollars (will be converted to cents)")
    currency: str = Field(default="USD", description="Currency code")
    risk_profile: Optional[str] = Field(None, description="Risk profile for the payment")
    idempotency_key: str = Field(..., description="Unique request identifier")


class PaymentResponse(BaseModel):
    success: bool
    payment_id: Optional[str] = None
    order_id: Optional[str] = None
    transaction_id: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None


@router.get("/health")
async def health_check():
    """Basic health check endpoint"""
    return {
        "status": "healthy",
        "service": "square-api",
        "python_version": sys.version.split()[0],  # Just version number
        "environment": os.getenv("VERCEL_ENV", "unknown"),
        "credentials_configured": bool(SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID),
    }


@router.get("/config")
async def get_config():
    """Public (non-secret) Square config for frontend runtime discovery"""
    return {
        "environment": SQUARE_ENVIRONMENT,
        "api_base_url": SQUARE_API_BASE_URL,
        "application_id": os.getenv("SQUARE_APPLICATION_ID", ""),
        "location_id": SQUARE_LOCATION_ID,
        "has_access_token": bool(SQUARE_ACCESS_TOKEN),
        "credentials_configured": bool(SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID),
    }


@router.post("/process-payment", response_model=PaymentResponse)
async def process_payment(request: Request, payment: PaymentRequest):
    """Process a Square payment"""
    try:
        print(f"[Square] Processing payment request: amount=${payment.amount}, currency={payment.currency}")
        print(f"[Square] Environment: {SQUARE_ENVIRONMENT}")
        print(f"[Square] Access token present: {bool(SQUARE_ACCESS_TOKEN)}")
        print(f"[Square] Location ID present: {bool(SQUARE_LOCATION_ID)}")
        
        # Check for Square credentials
        if not SQUARE_ACCESS_TOKEN:
            raise HTTPException(
                status_code=500,
                detail="SQUARE_ACCESS_TOKEN environment variable not set"
            )
        
        if not SQUARE_LOCATION_ID:
            raise HTTPException(
                status_code=500,
                detail="SQUARE_LOCATION_ID environment variable not set"
            )
        
        # Validate amount
        if payment.amount <= 0:
            raise HTTPException(
                status_code=400,
                detail="Payment amount must be greater than zero"
            )
        if payment.amount > 100000:  # $100,000 limit
            raise HTTPException(
                status_code=400,
                detail="Payment amount exceeds maximum limit"
            )
        
        # Convert amount to cents (Square API requires integer cents)
        amount_cents = int(payment.amount * 100)
        
        if amount_cents <= 0:
            raise HTTPException(
                status_code=400,
                detail="Invalid payment amount"
            )
        
        # Prepare Square API request (matching Square API v2 format)
        square_payload = {
            "source_id": payment.source_id,  # Token from card.tokenize()
            "idempotency_key": payment.idempotency_key,
            "amount_money": {
                "amount": amount_cents,  # Amount in cents (integer)
                "currency": payment.currency,
            },
            "location_id": SQUARE_LOCATION_ID,  # Required for direct API calls
            "autocomplete": True,  # Complete payment immediately
        }
        
        # Add note only if provided (optional field)
        if payment.risk_profile:
            square_payload["note"] = f"Aave deposit - {payment.risk_profile} strategy"
        
        print(f"[Square] Calling Square API: {SQUARE_API_BASE_URL}/v2/payments")
        print(f"[Square] Request payload: {json.dumps(square_payload, indent=2)}")
        
        # Call Square Payments API using requests
        try:
            response = requests.post(
                f"{SQUARE_API_BASE_URL}/v2/payments",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {SQUARE_ACCESS_TOKEN}",
                    "Square-Version": "2024-01-18",
                },
                json=square_payload,
                timeout=30,
            )
            
            print(f"[Square] Square API response status: {response.status_code}")
            
        except requests.exceptions.Timeout as e:
            print(f"[Square] Square API request timed out: {e}")
            raise HTTPException(
                status_code=504,
                detail=f"Square API request timed out: {str(e)}"
            )
        except requests.exceptions.ConnectionError as e:
            print(f"[Square] Cannot connect to Square API: {e}")
            raise HTTPException(
                status_code=503,
                detail=f"Cannot connect to Square API: {str(e)}"
            )
        except requests.exceptions.RequestException as e:
            print(f"[Square] Square API request failed: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to communicate with Square API: {str(e)}"
            )
        
        # Handle response
        if not response.ok:
            error_data = {}
            try:
                if response.text:
                    error_data = response.json()
            except (ValueError, requests.exceptions.JSONDecodeError):
                error_data = {"detail": response.text or f"HTTP {response.status_code}"}
            
            # Square API returns errors in a specific format
            errors = error_data.get("errors", [])
            if errors:
                # Get the first error detail (matching working example pattern)
                error_detail = errors[0].get("detail", "Payment Failed.")
                error_code = errors[0].get("code", "UNKNOWN")
                print(f"[Square] Payment failed: {error_code} - {error_detail}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=error_detail  # Return simple error message like working example
                )
            else:
                error_detail = error_data.get("detail", f"Square API error: {response.status_code}")
                print(f"[Square] Payment failed: {error_detail}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=error_detail
                )
        
        # Parse successful response
        try:
            data = response.json()
        except (ValueError, requests.exceptions.JSONDecodeError) as e:
            print(f"[Square] Invalid JSON response from Square API: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Invalid JSON response from Square API: {str(e)}"
            )
        
        payment_data = data.get("payment", {})
        payment_id = payment_data.get("id")
        
        print(f"[Square] Payment successful: {payment_id}")
        
        return PaymentResponse(
            success=True,
            payment_id=payment_id,
            order_id=payment_data.get("order_id"),
            transaction_id=payment_id,
            message="Payment processed successfully",
        )
            
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        print(f"[Square] Unexpected error: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Internal server error",
                "error": str(e),
                "type": type(e).__name__,
                "traceback": traceback.format_exc()
            }
        )
