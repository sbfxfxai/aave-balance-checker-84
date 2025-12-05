"""
Standalone Square API handler for Vercel serverless functions
No dependencies on app module - all code embedded here
"""
import os
import json
import sys
import traceback
from typing import Optional

try:
    import requests
except ImportError:
    requests = None

# Square API Configuration - read at runtime for testability
def get_square_config():
    """Get Square configuration from environment variables"""
    return {
        "access_token": os.getenv("SQUARE_ACCESS_TOKEN", ""),
        "location_id": os.getenv("SQUARE_LOCATION_ID", ""),
        "api_base_url": os.getenv("SQUARE_API_BASE_URL", "https://connect.squareup.com"),
        "environment": os.getenv("SQUARE_ENVIRONMENT", "production"),
    }


def handler(event, context):
    """
    Vercel Python serverless function handler
    Handles Square API endpoints: /health and /process-payment
    """
    try:
        # Parse request
        method = event.get("httpMethod", event.get("method", "GET"))
        path = event.get("path", event.get("url", ""))
        # Vercel may pass the path in different formats
        if not path:
            # Try to get from request URL or query
            path = event.get("rawPath", event.get("requestContext", {}).get("http", {}).get("path", ""))
        
        # Log for debugging
        print(f"[Square API] Request received - method: {method}, path: {path}")
        print(f"[Square API] Event keys: {list(event.keys())}")
        
        headers = event.get("headers", {})
        body = event.get("body", "")
        
        # Parse body if present
        request_data = {}
        if body:
            try:
                if isinstance(body, str):
                    request_data = json.loads(body)
                else:
                    request_data = body
            except json.JSONDecodeError:
                pass
        
        # CORS headers
        cors_headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
        
        # Handle OPTIONS (CORS preflight)
        if method == "OPTIONS":
            return {
                "statusCode": 200,
                "headers": cors_headers,
                "body": ""
            }
        
        # Route handling
        if path.endswith("/health") or path == "/api/square/health" or path == "/health":
            return handle_health(cors_headers)
        
        elif path.endswith("/process-payment") or path == "/api/square/process-payment" or path == "/process-payment":
            if method != "POST":
                return {
                    "statusCode": 405,
                    "headers": cors_headers,
                    "body": json.dumps({"error": "Method not allowed"})
                }
            return handle_process_payment(request_data, cors_headers)
        
        else:
            return {
                "statusCode": 404,
                "headers": cors_headers,
                "body": json.dumps({
                    "error": "Not Found",
                    "path": path,
                    "available_endpoints": ["/api/square/health", "/api/square/process-payment"]
                })
            }
    
    except Exception as e:
        print(f"[Square API] Handler error: {e}")
        traceback.print_exc()
        return {
            "statusCode": 500,
            "headers": cors_headers,
            "body": json.dumps({
                "error": "Internal server error",
                "message": str(e)
            })
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


def handle_process_payment(request_data, cors_headers):
    """Process Square payment"""
    try:
        # Get configuration at runtime
        config = get_square_config()
        square_access_token = config["access_token"]
        square_location_id = config["location_id"]
        square_api_base_url = config["api_base_url"]
        square_environment = config["environment"]
        
        # Validate credentials
        if not square_access_token:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": "SQUARE_ACCESS_TOKEN environment variable not set"
                })
            }
        
        if not square_location_id:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": "SQUARE_LOCATION_ID environment variable not set"
                })
            }
        
        # Validate request data
        source_id = request_data.get("source_id") or request_data.get("sourceId")
        amount = request_data.get("amount")
        currency = request_data.get("currency", "USD")
        idempotency_key = request_data.get("idempotency_key") or request_data.get("idempotencyKey")
        
        if not source_id:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": "source_id is required"
                })
            }
        
        if not amount or amount <= 0:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": "amount must be greater than zero"
                })
            }
        
        if not idempotency_key:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": "idempotency_key is required"
                })
            }
        
        # Convert amount to cents
        amount_cents = int(amount * 100)
        
        if not requests:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": "requests library not available"
                })
            }
        
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
        
        # Call Square API (production endpoint)
        response = requests.post(
            api_url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {square_access_token}",
                "Square-Version": "2024-01-18",
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
                return {
                    "statusCode": response.status_code,
                    "headers": cors_headers,
                    "body": json.dumps({
                        "success": False,
                        "error": error_detail,
                        "error_code": error_code
                    })
                }
            else:
                error_detail = error_data.get("detail", f"Square API error: {response.status_code}")
                return {
                    "statusCode": response.status_code,
                    "headers": cors_headers,
                    "body": json.dumps({
                        "success": False,
                        "error": error_detail
                    })
                }
        
        # Parse successful response
        try:
            data = response.json()
        except:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": "Invalid JSON response from Square API"
                })
            }
        
        payment_data = data.get("payment", {})
        payment_id = payment_data.get("id")
        
        print(f"[Square] Payment successful: {payment_id}")
        
        return {
            "statusCode": 200,
            "headers": cors_headers,
            "body": json.dumps({
                "success": True,
                "payment_id": payment_id,
                "order_id": payment_data.get("order_id"),
                "transaction_id": payment_id,
                "message": "Payment processed successfully",
            })
        }
    
    except Exception as e:
        # Check if it's a timeout or connection error
        error_type = type(e).__name__
        error_module = type(e).__module__
        
        # Handle timeout errors
        if error_type == "Timeout" or (error_module == "requests.exceptions" and error_type == "Timeout"):
            print(f"[Square] Square API request timed out: {e}")
            return {
                "statusCode": 504,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": f"Square API request timed out: {str(e)}"
                })
            }
        # Handle connection errors
        elif error_type == "ConnectionError" or (error_module == "requests.exceptions" and error_type == "ConnectionError"):
            print(f"[Square] Cannot connect to Square API: {e}")
            return {
                "statusCode": 503,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": f"Cannot connect to Square API: {str(e)}"
                })
            }
        else:
            # Generic exception handler
            print(f"[Square] Unexpected error: {e}")
            traceback.print_exc()
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": False,
                    "error": f"Internal server error: {str(e)}"
                })
            }
    except Exception as e:
        print(f"[Square] Unexpected error: {e}")
        traceback.print_exc()
        return {
            "statusCode": 500,
            "headers": cors_headers,
            "body": json.dumps({
                "success": False,
                "error": f"Internal server error: {str(e)}"
            })
        }
