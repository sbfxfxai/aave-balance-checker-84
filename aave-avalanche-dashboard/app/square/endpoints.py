"""
Square Payment Processing Endpoints

Handles Square payment processing server-side to avoid CORS issues.
The frontend tokenizes the card and sends the token here.
"""
import os
import requests  # pyright: ignore[reportMissingModuleSource]
from fastapi import APIRouter, HTTPException  # pyright: ignore[reportMissingImports]
from pydantic import BaseModel  # pyright: ignore[reportMissingImports]
from typing import Optional

router = APIRouter(tags=["square"])

# Square API Configuration - Must be defined before endpoints
SQUARE_ACCESS_TOKEN = os.getenv("SQUARE_ACCESS_TOKEN", "")
SQUARE_LOCATION_ID = os.getenv("SQUARE_LOCATION_ID", "")
SQUARE_API_BASE_URL = os.getenv("SQUARE_API_BASE_URL", "https://connect.squareup.com")


@router.get("/health")
async def health_check():
    """Health check endpoint to verify backend is accessible"""
    return {
        "status": "ok",
        "service": "Square Payment Processing",
        "credentials_configured": bool(SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID),
    }


class PaymentRequest(BaseModel):
    source_id: str  # Token from Square card.tokenize()
    amount: float
    currency: str = "USD"
    risk_profile: Optional[str] = None
    idempotency_key: str


class PaymentResponse(BaseModel):
    success: bool
    payment_id: Optional[str] = None
    order_id: Optional[str] = None
    transaction_id: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None


@router.post("/process-payment", response_model=PaymentResponse)
async def process_payment(request: PaymentRequest):
    """
    Process a Square payment using a tokenized card.
    
    The frontend sends a token from Square's card.tokenize() method.
    This endpoint calls Square's API server-side to avoid CORS issues.
    """
    if not SQUARE_ACCESS_TOKEN or not SQUARE_LOCATION_ID:
        raise HTTPException(
            status_code=500,
            detail="Square API credentials not configured on server"
        )

    try:
        # Validate amount
        if request.amount <= 0:
            raise HTTPException(
                status_code=400,
                detail="Payment amount must be greater than zero"
            )
        if request.amount > 100000:  # $100,000 limit
            raise HTTPException(
                status_code=400,
                detail="Payment amount exceeds maximum limit"
            )
        
        # Convert amount to cents (Square API requires integer cents)
        amount_cents = int(request.amount * 100)
        
        if amount_cents <= 0:
            raise HTTPException(
                status_code=400,
                detail="Invalid payment amount"
            )
        
        # Prepare Square API request
        square_payload = {
            "source_id": request.source_id,
            "idempotency_key": request.idempotency_key,
            "amount_money": {
                "amount": amount_cents,
                "currency": request.currency,
            },
            "location_id": SQUARE_LOCATION_ID,
            "note": f"Stack App deposit - {request.risk_profile or 'default'} strategy",
        }

        # Call Square Payments API
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

        if not response.ok:
            error_data = {}
            try:
                if response.text:
                    error_data = response.json()
            except (ValueError, requests.exceptions.JSONDecodeError):
                # Response is not valid JSON, use status text
                error_data = {"detail": response.text or f"HTTP {response.status_code}"}
            
            error_detail = (
                error_data.get("errors", [{}])[0].get("detail", "Payment failed")
                if error_data.get("errors")
                else error_data.get("detail", f"Square API error: {response.status_code}")
            )
            raise HTTPException(status_code=response.status_code, detail=error_detail)

        try:
            data = response.json()
        except (ValueError, requests.exceptions.JSONDecodeError) as e:
            raise HTTPException(
                status_code=500,
                detail=f"Invalid JSON response from Square API: {str(e)}"
            )
        
        payment = data.get("payment", {})

        return PaymentResponse(
            success=True,
            payment_id=payment.get("id"),
            order_id=payment.get("order_id"),
            transaction_id=payment.get("id"),
            message="Payment processed successfully",
        )

    except requests.exceptions.Timeout as e:
        raise HTTPException(
            status_code=504,
            detail=f"Square API request timed out: {str(e)}"
        )
    except requests.exceptions.ConnectionError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot connect to Square API: {str(e)}"
        )
    except requests.exceptions.RequestException as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to communicate with Square API: {str(e)}"
        )
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Payment processing error: {str(e)}"
        )

