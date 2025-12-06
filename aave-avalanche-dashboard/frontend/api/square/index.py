"""
Standalone Square API handler for Vercel serverless functions
No dependencies on app module - all code embedded here
"""
import os
import json
import sys
import traceback
import time
import random
from decimal import Decimal, InvalidOperation
import re

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
    print("[Square API] Make sure requirements.txt includes 'requests>=2.31.0'")
except Exception as e:
    _INIT_ERROR = f"Unexpected error importing requests: {e}"
    print(f"[Square API] ERROR: {_INIT_ERROR}")

# Square API Configuration - read at runtime for testability
def get_square_config():
    """Get Square configuration from environment variables"""
    environment = os.getenv("SQUARE_ENVIRONMENT", "production")
    
    # Use official Square API endpoints per documentation
    # Production: https://connect.squareup.com for payments
    # Sandbox: https://connect.squareupsandbox.com
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


def _handler_impl(event, context):
    """
    Internal handler implementation
    Vercel Python serverless function handler
    Handles Square API endpoints: /health and /process-payment
    
    Args:
        event: Request event dictionary from Vercel
        context: Lambda context (not used by Vercel but required for signature)
    """
    # CORS headers - define early so they're always available
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
            # Try to convert to dict if possible
            event = dict(event) if hasattr(event, '__dict__') else {}
        except:
            event = {}
    
    # Check for initialization errors
    if _INIT_ERROR:
        print(f"[Square API] Initialization error detected: {_INIT_ERROR}")
        return {
            "statusCode": 500,
            "headers": cors_headers,
            "body": json.dumps({
                "success": False,
                "error": "Server configuration error",
                "message": _INIT_ERROR
            })
        }
    
    try:
        
        # Parse request
        method = event.get("httpMethod") or event.get("method") or event.get("requestMethod") or "GET"
        path = event.get("path") or event.get("url") or event.get("rawPath") or event.get("pathname") or ""
        
        # Vercel may pass the path in different formats
        if not path:
            # Try to get from request URL or query
            request_context = event.get("requestContext", {})
            if isinstance(request_context, dict):
                http_info = request_context.get("http", {})
                if isinstance(http_info, dict):
                    path = http_info.get("path", "")
        
        # Also check query string parameters for path
        if not path:
            query_params = event.get("queryStringParameters") or {}
            if isinstance(query_params, dict):
                path = query_params.get("path", "")
        
        # Check headers for path info
        if not path and isinstance(headers, dict):
            # Vercel might pass path in headers
            path = headers.get("x-path") or headers.get("x-vercel-path") or headers.get("x-invoke-path") or ""
        
        # Log for debugging (limit output to avoid log size issues)
        print(f"[Square API] Request received - method: {method}, path: {path}")
        print(f"[Square API] Event keys: {list(event.keys())[:10]}")  # Limit to first 10 keys
        print(f"[Square API] Full event structure: {json.dumps({k: str(type(v).__name__) for k, v in list(event.items())[:20]})}")
        
        headers = event.get("headers", {})
        if not isinstance(headers, dict):
            headers = {}
        
        body = event.get("body", "") or ""
        
        # Parse body if present
        request_data = {}
        if body:
            try:
                if isinstance(body, str):
                    request_data = json.loads(body)
                else:
                    request_data = body
            except (json.JSONDecodeError, ValueError) as e:
                print(f"[Square API] Body parse error: {e}")
                request_data = {}
        
        # Handle OPTIONS (CORS preflight)
        if method == "OPTIONS":
            return {
                "statusCode": 200,
                "headers": cors_headers,
                "body": ""
            }
        
        # Route handling - normalize path first and check multiple formats
        normalized_path = path.rstrip("/") if path else ""
        
        # Extract endpoint from path (handle both /api/square/process-payment and /process-payment)
        endpoint = None
        if normalized_path:
            # Remove /api/square prefix if present
            if normalized_path.startswith("/api/square/"):
                endpoint = normalized_path[len("/api/square/"):]
            elif normalized_path.startswith("/api/square"):
                endpoint = normalized_path[len("/api/square"):].lstrip("/")
            else:
                endpoint = normalized_path.lstrip("/")
        
        print(f"[Square API] Extracted endpoint: {endpoint}, normalized_path: {normalized_path}")
        
        # Route based on endpoint
        if endpoint == "health" or endpoint == "" or normalized_path.endswith("/health") or normalized_path == "/api/square/health" or normalized_path == "/health":
            return handle_health(cors_headers)
        
        elif endpoint == "debug" or normalized_path.endswith("/debug") or normalized_path == "/api/square/debug" or normalized_path == "/debug":
            return handle_debug(request_data, cors_headers, method)
        
        elif endpoint == "test" or normalized_path.endswith("/test") or normalized_path == "/api/square/test" or normalized_path == "/test":
            return handle_test(cors_headers)
        
        elif endpoint == "process-payment" or normalized_path.endswith("/process-payment") or normalized_path == "/api/square/process-payment" or normalized_path == "/process-payment":
            if method != "POST":
                return create_error_response(
                    405,
                    "Method not allowed. Use POST for payment processing.",
                    "METHOD_NOT_ALLOWED",
                    cors_headers
                )
            return handle_process_payment(request_data, cors_headers)
        
        else:
            # Return detailed 404 with available endpoints
            return create_error_response(
                404,
                f"Endpoint not found: {path} (endpoint: {endpoint})",
                "NOT_FOUND",
                cors_headers
            )
    
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        
        print(f"[Square API] Handler error: {error_type}: {error_msg}")
        try:
            traceback.print_exc()
        except Exception:
            print("[Square API] Could not print traceback")
        
        # Ensure we always return valid JSON
        try:
            error_response = {
                "success": False,
                "error": "Internal server error",
                "message": error_msg,
                "type": error_type
            }
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps(error_response)
            }
        except Exception as json_error:
            # Last resort - return minimal JSON
            print(f"[Square API] Failed to create error response: {json_error}")
            return {
                "statusCode": 500,
                "headers": {"Content-Type": "application/json"},
                "body": '{"success":false,"error":"Internal server error"}'
            }


def handle_health(cors_headers):
    """Health check endpoint"""
    config = get_square_config()
    is_production = "squareup.com" in config["api_base_url"] and "sandbox" not in config["api_base_url"]
    
    return {
        "statusCode": 200,
        "headers": cors_headers,
        "body": json.dumps({
            "status": "healthy",
            "service": "square-api",
            "python_version": sys.version.split()[0],
            "environment": os.getenv("VERCEL_ENV", "unknown"),
            "credentials_configured": bool(config["access_token"] and config["location_id"]),
            "has_access_token": bool(config["access_token"]),
            "has_location_id": bool(config["location_id"]),
            "square_api_base_url": config["api_base_url"],
            "square_environment": config["environment"],
            "is_production": is_production,
            "production_endpoint": f"{config['api_base_url']}/v2/payments",
            "access_token_preview": config["access_token"][:10] + "..." if config["access_token"] else "NOT SET",
        })
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
        
        # Call Square Payments API following official documentation pattern
        # Endpoint: https://connect.squareup.com/v2/payments (production)
        #          https://connect.squareupsandbox.com/v2/payments (sandbox)
        response = requests.post(
            api_url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {square_access_token}",
                "Square-Version": os.getenv("SQUARE_API_VERSION", "2024-10-16"),  # Configurable API version
            },
            json=square_payload,
            timeout=30,
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
        
        # Parse successful response following Square API documentation
        # Response format: { "payment": { "id": "...", "status": "COMPLETED", ... } }
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
        
        # Return success response matching Square API documentation
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


def handle_debug(request_data, cors_headers, method):
    """Debug endpoint to check environment variables and function execution"""
    try:
        config = get_square_config()
        
        debug_info = {
            "status": "ok",
            "message": "Debug endpoint working",
            "timestamp": time.time(),
            "method": method,
            "body_received": request_data,
            "environment": {
                "python_version": sys.version.split()[0],
                "vercel_env": os.getenv("VERCEL_ENV", "unknown"),
                "has_access_token": bool(config["access_token"]),
                "has_location_id": bool(config["location_id"]),
                "access_token_length": len(config["access_token"]) if config["access_token"] else 0,
                "location_id": config["location_id"],
                "square_environment": config["environment"],
                "api_base_url": config["api_base_url"],
                "requests_available": REQUESTS_AVAILABLE,
                "init_error": _INIT_ERROR,
            },
            "access_token_preview": config["access_token"][:10] + "..." if config["access_token"] else "NOT SET",
        }
        
        return {
            "statusCode": 200,
            "headers": cors_headers,
            "body": json.dumps(debug_info, indent=2)
        }
    except Exception as e:
        print(f"[Debug] Error: {e}")
        traceback.print_exc()
        return {
            "statusCode": 500,
            "headers": cors_headers,
            "body": json.dumps({
                "error": "Debug endpoint error",
                "message": str(e),
                "type": type(e).__name__
            })
        }


def handle_test(cors_headers):
    """Simple test endpoint"""
    try:
        return {
            "statusCode": 200,
            "headers": cors_headers,
            "body": json.dumps({
                "status": "ok",
                "message": "Test endpoint working",
                "timestamp": time.time(),
                "python_version": sys.version.split()[0],
                "has_square_token": bool(os.getenv("SQUARE_ACCESS_TOKEN")),
                "has_square_location": bool(os.getenv("SQUARE_LOCATION_ID")),
            })
        }
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": cors_headers,
            "body": json.dumps({
                "error": "Test endpoint error",
                "message": str(e)
            })
        }


# Handler is exported directly - Vercel will call handler(event, context)
# The handler function already has comprehensive error handling built-in

def handler(event, context):
    """
    Top-level handler wrapper with error catching
    This ensures we always return a valid response even if something fails at module level
    
    Args:
        event: Request event dictionary from Vercel
        context: Lambda context (not used by Vercel but required for signature)
    
    Returns:
        dict: Vercel response object with statusCode, headers, and body
    """
    try:
        return _handler_impl(event, context)
    except Exception as e:
        # Last resort error handler - catches any error we missed
        print(f"[Square API] CRITICAL: Top-level handler error: {e}")
        traceback.print_exc()
        try:
            return create_error_response(
                500,
                f"Internal server error: {str(e)}",
                "CRITICAL_ERROR",
                {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                }
            )
        except:
            # If even JSON encoding fails, return minimal response
            return {
                "statusCode": 500,
                "headers": {"Content-Type": "application/json"},
                "body": '{"success":false,"error":{"message":"Internal server error","code":"CRITICAL_ERROR"}}'
            }
