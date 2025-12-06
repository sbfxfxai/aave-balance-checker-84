"""
Square payment processing endpoint for Vercel serverless functions
Handles POST /api/square/process-payment requests
"""
import os
import json
import sys
import traceback
import time
import random
from decimal import Decimal, InvalidOperation

# Initialize error tracking
_INIT_ERROR = None
REQUESTS_AVAILABLE = False
requests = None

# Configuration constants
REQUEST_TIMEOUT = 30
TOKEN_PREVIEW_LENGTH = 10
LOG_TRUNCATE_LENGTH = 500
MAX_AMOUNT = 999999  # Square's maximum amount limit
MIN_AMOUNT = 0.01  # Minimum 1 cent

# Try to import requests - required for Square API calls
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError as e:
    _INIT_ERROR = f"requests library not available: {e}"
    print(f"[Square API] WARNING: {_INIT_ERROR}")
except Exception as e:
    _INIT_ERROR = f"Unexpected error importing requests: {e}"
    print(f"[Square API] ERROR: {_INIT_ERROR}")

# Square API Configuration
def get_square_config():
    """Get Square configuration from environment variables"""
    environment = os.getenv("SQUARE_ENVIRONMENT", "production")
    
    if environment == "sandbox":
        default_api_base_url = "https://connect.squareupsandbox.com"
    else:
        default_api_base_url = "https://connect.squareup.com"
    
    return {
        "access_token": os.getenv("SQUARE_ACCESS_TOKEN", ""),
        "location_id": os.getenv("SQUARE_LOCATION_ID", ""),
        "api_base_url": os.getenv("SQUARE_API_BASE_URL", default_api_base_url),
        "environment": environment,
    }


def sanitize_for_logging(data):
    """Remove sensitive data before logging"""
    if not isinstance(data, dict):
        return data
    
    sanitized = data.copy()
    sensitive_keys = ["source_id", "token", "sourceId", "card", "cvv", "verification_token", "card_number"]
    
    for key in sensitive_keys:
        if key in sanitized:
            value = sanitized[key]
            if isinstance(value, str) and len(value) > 0:
                sanitized[key] = value[:TOKEN_PREVIEW_LENGTH] + "..." if len(value) > TOKEN_PREVIEW_LENGTH else "[REDACTED]"
            else:
                sanitized[key] = "[REDACTED]"
    
    return sanitized


def validate_payment_request(request_data):
    """Validate payment request data"""
    errors = []
    
    # Validate amount
    amount = request_data.get("amount")
    if amount is None:
        errors.append("amount is required")
    elif not isinstance(amount, (int, float, str)):
        errors.append("amount must be a number")
    else:
        try:
            amount_decimal = Decimal(str(amount))
            if amount_decimal <= 0:
                errors.append("amount must be greater than zero")
            elif amount_decimal < MIN_AMOUNT:
                errors.append(f"amount must be at least ${MIN_AMOUNT}")
            elif amount_decimal > MAX_AMOUNT:
                errors.append(f"amount exceeds maximum of ${MAX_AMOUNT}")
        except (InvalidOperation, ValueError):
            errors.append("amount must be a valid number")
    
    # Validate currency
    currency = request_data.get("currency", "USD")
    if not isinstance(currency, str) or len(currency) != 3 or not currency.isalpha():
        errors.append("currency must be a 3-letter ISO code (e.g., USD)")
    
    # Validate source_id
    source_id = request_data.get("source_id") or request_data.get("sourceId") or request_data.get("token")
    if not source_id:
        errors.append("source_id is required")
    elif not isinstance(source_id, str) or len(source_id) < 10:
        errors.append("source_id must be a valid payment token")
    
    return errors


def create_error_response(status_code, error_message, error_code=None, cors_headers=None):
    """Create standardized error response"""
    if cors_headers is None:
        cors_headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
    
    response_body = {
        "success": False,
        "error": {
            "message": error_message,
            "code": error_code or f"ERR_{status_code}",
        }
    }
    
    return {
        "statusCode": status_code,
        "headers": cors_headers,
        "body": json.dumps(response_body)
    }


def handle_process_payment(request_data, cors_headers):
    """Process Square payment"""
    try:
        print("[Square] Starting payment processing...")
        sanitized_data = sanitize_for_logging(request_data)
        print(f"[Square] Request data keys: {list(sanitized_data.keys()) if isinstance(sanitized_data, dict) else 'not a dict'}")
        print(f"[Square] Request data: {json.dumps(sanitized_data)[:LOG_TRUNCATE_LENGTH]}")
        
        # Get configuration at runtime
        config = get_square_config()
        square_access_token = config["access_token"]
        square_location_id = config["location_id"]
        square_api_base_url = config["api_base_url"]
        square_environment = config["environment"]
        
        print(f"[Square] Config loaded - Environment: {square_environment}, API URL: {square_api_base_url}")
        
        # Validate credentials
        if not square_access_token:
            return create_error_response(
                500,
                "SQUARE_ACCESS_TOKEN environment variable not set",
                "MISSING_CREDENTIALS",
                cors_headers
            )
        
        if not square_location_id:
            return create_error_response(
                500,
                "SQUARE_LOCATION_ID environment variable not set",
                "MISSING_CREDENTIALS",
                cors_headers
            )
        
        # Validate request data
        validation_errors = validate_payment_request(request_data)
        if validation_errors:
            return create_error_response(
                400,
                "; ".join(validation_errors),
                "VALIDATION_ERROR",
                cors_headers
            )
        
        # Extract and normalize request data
        source_id = request_data.get("source_id") or request_data.get("sourceId") or request_data.get("token")
        amount = request_data.get("amount")
        currency = request_data.get("currency", "USD").upper()
        idempotency_key = request_data.get("idempotency_key") or request_data.get("idempotencyKey") or request_data.get("orderId")
        
        print(f"[Square] Parsed request - source_id: {'present' if source_id else 'missing'}, amount: {amount}, currency: {currency}, idempotency_key: {'present' if idempotency_key else 'missing'}")
        
        # Generate idempotency key if not provided
        if not idempotency_key:
            idempotency_key = f"{int(time.time() * 1000)}-{''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=9))}"
            print(f"[Square] Generated idempotency_key: {idempotency_key}")
        
        # Convert amount to cents using Decimal for precision
        try:
            amount_decimal = Decimal(str(amount))
            amount_cents = int(amount_decimal * 100)
            print(f"[Square] Amount conversion: ${amount} → {amount_cents} cents")
        except (InvalidOperation, ValueError) as e:
            return create_error_response(
                400,
                f"Invalid amount format: {str(e)}",
                "INVALID_AMOUNT",
                cors_headers
            )
        
        if not REQUESTS_AVAILABLE or not requests:
            print("[Square API] ERROR: requests library not available")
            return create_error_response(
                500,
                "Server configuration error: requests library not available. Please ensure requirements.txt includes 'requests>=2.31.0'",
                "MISSING_DEPENDENCY",
                cors_headers
            )
        
        # Prepare Square API request
        square_payload = {
            "source_id": source_id,
            "idempotency_key": idempotency_key,
            "amount_money": {
                "amount": amount_cents,
                "currency": currency,
            },
            "location_id": square_location_id,
            "autocomplete": True,
        }
        
        # Add note if risk profile provided
        if request_data.get("risk_profile"):
            square_payload["note"] = f"Aave deposit - {request_data['risk_profile']} strategy"
        
        # Verify production endpoint
        api_url = f"{square_api_base_url}/v2/payments"
        is_production = "squareup.com" in square_api_base_url and "sandbox" not in square_api_base_url
        
        print(f"[Square] Environment: {square_environment}")
        print(f"[Square] API Base URL: {square_api_base_url}")
        print(f"[Square] Production Mode: {is_production}")
        print(f"[Square] Calling Square API: {api_url}")
        print(f"[Square] Amount: ${amount} ({amount_cents} cents)")
        print(f"[Square] Location ID: {square_location_id}")
        print(f"[Square] Access Token (first 10 chars): {square_access_token[:10] if square_access_token else 'NOT SET'}...")
        
        # Call Square Payments API
        response = requests.post(
            api_url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {square_access_token}",
                "Square-Version": os.getenv("SQUARE_API_VERSION", "2024-10-16"),
            },
            json=square_payload,
            timeout=REQUEST_TIMEOUT,
        )
        
        print(f"[Square] Square API response status: {response.status_code}")
        
        # Handle response
        if not response.ok:
            error_data = {}
            try:
                if response.text:
                    error_data = response.json()
            except:
                error_data = {"detail": response.text or f"HTTP {response.status_code}"}
            
            errors = error_data.get("errors", [])
            if errors:
                error_detail = errors[0].get("detail", "Payment Failed.")
                error_code = errors[0].get("code", "UNKNOWN")
                print(f"[Square] Payment failed: {error_code} - {error_detail}")
                return create_error_response(
                    response.status_code,
                    error_detail,
                    f"SQUARE_{error_code}",
                    cors_headers
                )
            else:
                error_detail = error_data.get("detail", f"Square API error: {response.status_code}")
                return create_error_response(
                    response.status_code,
                    error_detail,
                    "SQUARE_API_ERROR",
                    cors_headers
                )
        
        # Parse successful response
        try:
            data = response.json()
        except Exception as e:
            print(f"[Square] Failed to parse JSON response: {e}")
            return create_error_response(
                500,
                "Invalid JSON response from Square API",
                "INVALID_RESPONSE",
                cors_headers
            )
        
        # Extract payment data from Square API response
        payment_data = data.get("payment", {})
        payment_id = payment_data.get("id")
        payment_status = payment_data.get("status")  # COMPLETED, APPROVED, FAILED, CANCELED
        
        print(f"[Square] Payment processed - ID: {payment_id}, Status: {payment_status}")
        
        # Return success response
        return {
            "statusCode": 200,
            "headers": cors_headers,
            "body": json.dumps({
                "success": True,
                "payment_id": payment_id,
                "status": payment_status,
                "order_id": payment_data.get("order_id"),
                "transaction_id": payment_id,
                "message": "Payment processed successfully",
                "amount_money": payment_data.get("amount_money", {}),
            })
        }
    
    except Exception as e:
        # Check if it's a timeout or connection error
        error_type = type(e).__name__
        error_module = type(e).__module__
        
        # Handle timeout errors
        if error_type == "Timeout" or (error_module == "requests.exceptions" and error_type == "Timeout"):
            print(f"[Square] Square API request timed out: {e}")
            return create_error_response(
                504,
                f"Square API request timed out: {str(e)}",
                "TIMEOUT_ERROR",
                cors_headers
            )
        # Handle connection errors
        elif error_type == "ConnectionError" or (error_module == "requests.exceptions" and error_type == "ConnectionError"):
            print(f"[Square] Cannot connect to Square API: {e}")
            return create_error_response(
                503,
                f"Cannot connect to Square API: {str(e)}",
                "CONNECTION_ERROR",
                cors_headers
            )
        else:
            # Generic exception handler
            print(f"[Square] Unexpected error: {e}")
            traceback.print_exc()
            return create_error_response(
                500,
                f"Internal server error: {str(e)}",
                "INTERNAL_ERROR",
                cors_headers
            )


def handler(event, context):
    """
    Vercel Python serverless function handler for /api/square/process-payment
    """
    # CORS headers
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
    
    # Handle None or invalid event
    if event is None:
        event = {}
    if not isinstance(event, dict):
        try:
            event = dict(event) if hasattr(event, '__dict__') else {}
        except:
            event = {}
    
    # Check for initialization errors
    if _INIT_ERROR:
        print(f"[Square API] Initialization error detected: {_INIT_ERROR}")
        return create_error_response(
            500,
            "Server configuration error",
            "INIT_ERROR",
            cors_headers
        )
    
    try:
        # Parse request method
        method = event.get("httpMethod") or event.get("method") or event.get("requestMethod") or "GET"
        
        # Handle OPTIONS (CORS preflight)
        if method == "OPTIONS":
            return {
                "statusCode": 200,
                "headers": cors_headers,
                "body": ""
            }
        
        # Only allow POST
        if method != "POST":
            return create_error_response(
                405,
                "Method not allowed. Use POST for payment processing.",
                "METHOD_NOT_ALLOWED",
                cors_headers
            )
        
        # Parse body
        body = event.get("body", "") or ""
        request_data = {}
        if body:
            try:
                if isinstance(body, str):
                    request_data = json.loads(body)
                else:
                    request_data = body
            except (json.JSONDecodeError, ValueError) as e:
                print(f"[Square API] Body parse error: {e}")
                return create_error_response(
                    400,
                    f"Invalid JSON in request body: {str(e)}",
                    "INVALID_JSON",
                    cors_headers
                )
        
        # Process payment
        return handle_process_payment(request_data, cors_headers)
    
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        
        print(f"[Square API] Handler error: {error_type}: {error_msg}")
        traceback.print_exc()
        
        return create_error_response(
            500,
            f"Internal server error: {error_msg}",
            "HANDLER_ERROR",
            cors_headers
        )

