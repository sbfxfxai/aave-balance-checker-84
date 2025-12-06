"""
Square API handler for Vercel serverless functions
Uses BaseHTTPRequestHandler format required by Vercel
"""
from http.server import BaseHTTPRequestHandler
import os
import json
import traceback
import time
import random
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, urlparse

# Configuration constants
REQUEST_TIMEOUT = 30
TOKEN_PREVIEW_LENGTH = 10
LOG_TRUNCATE_LENGTH = 500
MAX_AMOUNT = 999999
MIN_AMOUNT = 0.01

# Try to import requests
REQUESTS_AVAILABLE = False
requests = None
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    pass


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
    sensitive_keys = ["source_id", "token", "sourceId", "card", "cvv", "verification_token"]
    for key in sensitive_keys:
        if key in sanitized:
            value = sanitized[key]
            if isinstance(value, str) and len(value) > 0:
                sanitized[key] = value[:TOKEN_PREVIEW_LENGTH] + "..."
            else:
                sanitized[key] = "[REDACTED]"
    return sanitized


def validate_payment_request(request_data):
    """Validate payment request data"""
    errors = []
    
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
    
    currency = request_data.get("currency", "USD")
    if not isinstance(currency, str) or len(currency) != 3 or not currency.isalpha():
        errors.append("currency must be a 3-letter ISO code")
    
    source_id = request_data.get("source_id") or request_data.get("sourceId") or request_data.get("token")
    if not source_id:
        errors.append("source_id is required")
    elif not isinstance(source_id, str) or len(source_id) < 10:
        errors.append("source_id must be a valid payment token")
    
    return errors


def create_json_response(handler, status_code, data):
    """Helper to send JSON response"""
    handler.send_response(status_code)
    handler.send_header('Content-type', 'application/json')
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    handler.end_headers()
    handler.wfile.write(json.dumps(data).encode())


def handle_health():
    """Health check response"""
    config = get_square_config()
    return {
        "status": "healthy",
        "service": "square-api",
        "timestamp": int(time.time()),
        "credentials_configured": bool(config["access_token"] and config["location_id"]),
        "environment": config["environment"],
        "requests_available": REQUESTS_AVAILABLE,
    }


def process_payment(request_data):
    """Process Square payment"""
    config = get_square_config()
    
    if not config["access_token"]:
        return 500, {"success": False, "error": {"message": "SQUARE_ACCESS_TOKEN not configured", "code": "MISSING_CREDENTIALS"}}
    
    if not config["location_id"]:
        return 500, {"success": False, "error": {"message": "SQUARE_LOCATION_ID not configured", "code": "MISSING_CREDENTIALS"}}
    
    validation_errors = validate_payment_request(request_data)
    if validation_errors:
        return 400, {"success": False, "error": {"message": "; ".join(validation_errors), "code": "VALIDATION_ERROR"}}
    
    if not REQUESTS_AVAILABLE:
        return 500, {"success": False, "error": {"message": "requests library not available", "code": "MISSING_DEPENDENCY"}}
    
    source_id = request_data.get("source_id") or request_data.get("sourceId") or request_data.get("token")
    amount = request_data.get("amount")
    currency = request_data.get("currency", "USD").upper()
    idempotency_key = request_data.get("idempotency_key") or request_data.get("idempotencyKey") or request_data.get("orderId")
    
    if not idempotency_key:
        idempotency_key = f"{int(time.time() * 1000)}-{''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=9))}"
    
    try:
        amount_decimal = Decimal(str(amount))
        amount_cents = int(amount_decimal * 100)
    except (InvalidOperation, ValueError) as e:
        return 400, {"success": False, "error": {"message": f"Invalid amount: {e}", "code": "INVALID_AMOUNT"}}
    
    square_payload = {
        "source_id": source_id,
        "idempotency_key": idempotency_key,
        "amount_money": {
            "amount": amount_cents,
            "currency": currency,
        },
        "location_id": config["location_id"],
        "autocomplete": True,
    }
    
    api_url = f"{config['api_base_url']}/v2/payments"
    print(f"[Square] Calling API: {api_url}")
    
    try:
        response = requests.post(
            api_url,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {config['access_token']}",
                "Square-Version": os.getenv("SQUARE_API_VERSION", "2024-10-16"),
            },
            json=square_payload,
            timeout=REQUEST_TIMEOUT,
        )
        
        print(f"[Square] Response status: {response.status_code}")
        
        if not response.ok:
            error_data = {}
            try:
                error_data = response.json()
            except:
                error_data = {"detail": response.text or f"HTTP {response.status_code}"}
            
            errors = error_data.get("errors", [])
            if errors:
                error_detail = errors[0].get("detail", "Payment failed")
                error_code = errors[0].get("code", "UNKNOWN")
                return response.status_code, {"success": False, "error": {"message": error_detail, "code": f"SQUARE_{error_code}"}}
            else:
                return response.status_code, {"success": False, "error": {"message": error_data.get("detail", "Square API error"), "code": "SQUARE_API_ERROR"}}
        
        data = response.json()
        payment = data.get("payment", {})
        
        return 200, {
            "success": True,
            "payment_id": payment.get("id"),
            "status": payment.get("status"),
            "order_id": payment.get("order_id"),
            "transaction_id": payment.get("id"),
            "message": "Payment processed successfully",
            "amount_money": payment.get("amount_money", {}),
        }
    
    except Exception as e:
        print(f"[Square] Error: {e}")
        traceback.print_exc()
        return 500, {"success": False, "error": {"message": str(e), "code": "INTERNAL_ERROR"}}


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests"""
        path = urlparse(self.path).path
        
        # Health check
        if path.endswith('/health') or path == '/api/square' or path == '/api/square/':
            create_json_response(self, 200, handle_health())
            return
        
        # Test endpoint
        if path.endswith('/test'):
            create_json_response(self, 200, {"status": "ok", "message": "Square API test endpoint"})
            return
        
        # Process payment requires POST
        if path.endswith('/process-payment'):
            create_json_response(self, 405, {"success": False, "error": {"message": "Use POST for payment processing", "code": "METHOD_NOT_ALLOWED"}})
            return
        
        # Default: return health
        create_json_response(self, 200, handle_health())
    
    def do_POST(self):
        """Handle POST requests"""
        path = urlparse(self.path).path
        
        # Only process-payment accepts POST
        if not path.endswith('/process-payment'):
            create_json_response(self, 404, {"success": False, "error": {"message": "Not found", "code": "NOT_FOUND"}})
            return
        
        # Read body
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        
        try:
            request_data = json.loads(body)
        except json.JSONDecodeError as e:
            create_json_response(self, 400, {"success": False, "error": {"message": f"Invalid JSON: {e}", "code": "INVALID_JSON"}})
            return
        
        print(f"[Square] Processing payment request")
        print(f"[Square] Request data: {json.dumps(sanitize_for_logging(request_data))[:LOG_TRUNCATE_LENGTH]}")
        
        status_code, response_data = process_payment(request_data)
        create_json_response(self, status_code, response_data)
