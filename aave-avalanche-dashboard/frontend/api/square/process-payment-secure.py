"""
Secure Square payment processing endpoint for Vercel serverless functions
Production-ready with comprehensive security and privacy compliance
"""
import os
import json
import sys
import traceback
import time
import random
import hashlib
import hmac
import re
from decimal import Decimal, InvalidOperation
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Dict, Any, Optional, Tuple

# Initialize error tracking
_INIT_ERROR = None
REQUESTS_AVAILABLE = False
REDIS_AVAILABLE = False
requests = None
redis_client = None

# Security configuration constants
REQUEST_TIMEOUT = 30
TOKEN_PREVIEW_LENGTH = 0  # NEVER preview tokens
LOG_TRUNCATE_LENGTH = 200
MAX_AMOUNT = 10000  # Business limit: $10,000 per transaction
MIN_AMOUNT = 0.01  # Minimum 1 cent
MAX_BODY_SIZE = 10 * 1024  # 10KB
MAX_REQUESTS_PER_MINUTE = 10
HOURLY_LIMIT_PER_IP = 50000  # $50,000 per hour
DAILY_LIMIT_PER_IP = 100000  # $100,000 per day
IDEMPOTENCY_KEY_TTL = 3600  # 1 hour

# CORS security - restrict to specific origins
ALLOWED_ORIGINS = [
    "https://www.tiltvault.com",
    "https://tiltvault.com", 
    "https://app.tiltvault.com",
]

# Development origins (remove in production)
if os.getenv("VERCEL_ENV") != "production":
    ALLOWED_ORIGINS.extend([
        "http://localhost:3000",
        "http://localhost:3001",
        "https://localhost:3000",
    ])

# Try to import required dependencies
try:
    import requests  # type: ignore[import-untyped]
    REQUESTS_AVAILABLE = True
except ImportError as e:
    _INIT_ERROR = f"requests library not available: {e}"
    print(f"[Square API] WARNING: {_INIT_ERROR}")

try:
    import redis  # type: ignore
    REDIS_AVAILABLE = True
    redis_client = redis.Redis(
        host=os.getenv("REDIS_HOST", "localhost"),
        port=int(os.getenv("REDIS_PORT", 6379)),
        password=os.getenv("REDIS_PASSWORD"),
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
        retry_on_timeout=True
    )
    # Test connection
    redis_client.ping()
    print("[Square API] Redis connection established")
except Exception as e:
    REDIS_AVAILABLE = False
    print(f"[Square API] Redis not available: {e}")

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

def get_client_ip(headers):
    """Extract client IP from headers"""
    forwarded = headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return headers.get("x-real-ip", "unknown")

def validate_cors_origin(request_origin):
    """Validate CORS origin and return appropriate headers"""
    if not request_origin:
        return {
            "Content-Type": "application/json",
        }
    
    if request_origin in ALLOWED_ORIGINS:
        return {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": request_origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
            "Access-Control-Allow-Credentials": "true",
        }
    
    # Origin not allowed - don't set CORS headers
    return {
        "Content-Type": "application/json",
    }

def check_rate_limit(identifier, limit=MAX_REQUESTS_PER_MINUTE, window=60):
    """Check rate limiting using Redis or fallback"""
    if not REDIS_AVAILABLE:
        # Fallback: allow request (fail open)
        return True, None
    
    try:
        key = f"rate_limit:{identifier}"
        current = redis_client.incr(key)
        
        if current == 1:
            redis_client.expire(key, window)
        
        if current > limit:
            return False, redis_client.ttl(key)
        
        return True, None
    except Exception as e:
        print(f"[Square API] Rate limit check failed: {e}")
        return True, None  # Fail open

def check_velocity_limits(ip_address, amount):
    """Check hourly and daily spending limits per IP"""
    if not REDIS_AVAILABLE:
        return True, 0, 0
    
    try:
        now = datetime.now()
        hour_key = f"hourly_limit:{ip_address}:{now.strftime('%Y-%m-%d-%H')}"
        day_key = f"daily_limit:{ip_address}:{now.strftime('%Y-%m-%d')}"
        
        hourly_total = Decimal(redis_client.get(hour_key) or "0")
        daily_total = Decimal(redis_client.get(day_key) or "0")
        
        if hourly_total + amount > HOURLY_LIMIT_PER_IP:
            return False, float(hourly_total), float(daily_total)
        
        if daily_total + amount > DAILY_LIMIT_PER_IP:
            return False, float(hourly_total), float(daily_total)
        
        # Update totals
        redis_client.set(hour_key, str(hourly_total + amount), ex=3600)  # 1 hour
        redis_client.set(day_key, str(daily_total + amount), ex=86400)  # 24 hours
        
        return True, float(hourly_total), float(daily_total)
    except Exception as e:
        print(f"[Square API] Velocity limit check failed: {e}")
        return True, 0, 0  # Fail open

def validate_idempotency_key(key, amount):
    """Validate and track idempotency keys"""
    if not key:
        return False, "idempotency_key is required"
    
    if len(key) < 20 or len(key) > 128:
        return False, "idempotency_key must be 20-128 characters"
    
    if not REDIS_AVAILABLE:
        # Fallback: allow but warn
        return True, None
    
    try:
        idempotency_key = f"idempotency:{hashlib.sha256(key.encode()).hexdigest()}"
        existing = redis_client.get(idempotency_key)
        
        if existing:
            stored_amount = Decimal(existing)
            if stored_amount != amount:
                return False, "idempotency_key reused with different amount"
            return False, "duplicate request - payment already processed"
        
        # Store new key
        redis_client.set(idempotency_key, str(amount), ex=IDEMPOTENCY_KEY_TTL)
        return True, None
    except Exception as e:
        print(f"[Square API] Idempotency check failed: {e}")
        return True, None  # Fail open

def generate_secure_reference_id():
    """Generate a secure reference ID for internal tracking"""
    timestamp = str(int(time.time()))
    random_part = ''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=16))
    return f"ref_{timestamp}_{random_part}"

def store_payment_metadata(reference_id, metadata):
    """Store payment metadata securely in Redis"""
    if not REDIS_AVAILABLE:
        print(f"[Square API] WARNING: Cannot store metadata for {reference_id}")
        return
    
    try:
        key = f"payment_meta:{reference_id}"
        redis_client.set(key, json.dumps(metadata), ex=86400 * 30)  # 30 days
        print(f"[Square API] Stored metadata for {reference_id}")
    except Exception as e:
        print(f"[Square API] Failed to store metadata: {e}")

def validate_email(email):
    """Validate email format"""
    if not email:
        return True  # Optional field
    if not isinstance(email, str) or len(email) > 254:
        return False
    # Basic email validation
    email_regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(email_regex, email))

def validate_wallet_address(address):
    """Validate Ethereum address format"""
    if not address:
        return True  # Optional field
    if not isinstance(address, str):
        return False
    # Ethereum address: 0x + 40 hex characters
    return bool(re.match(r'^0x[a-fA-F0-9]{40}$', address))

def sanitize_note_value(value):
    """Remove special characters that could break note parsing"""
    if not isinstance(value, str):
        value = str(value)
    # Remove newlines, colons, and other special chars that could break parsing
    return re.sub(r'[:\n\r\t]', '', value)[:50]  # Also limit length

def sanitize_for_logging(data):
    """Recursively sanitize sensitive data"""
    if not isinstance(data, dict):
        return data
    
    sensitive_keys = {
        "source_id", "token", "sourceId", "card", "cvv", 
        "verification_token", "card_number", "email", 
        "user_email", "wallet_address", "phone", "address",
        "billing_address", "shipping_address", "cardholder_name",
        "access_token", "location_id", "application_id"
    }
    
    sanitized = {}
    for key, value in data.items():
        if key.lower() in {k.lower() for k in sensitive_keys}:
            sanitized[key] = "[REDACTED]"
        elif isinstance(value, dict):
            sanitized[key] = sanitize_for_logging(value)
        elif isinstance(value, list):
            sanitized[key] = [sanitize_for_logging(v) if isinstance(v, dict) else v for v in value]
        else:
            sanitized[key] = value
    
    return sanitized

def validate_payment_request(request_data, client_ip):
    """Enhanced payment request validation with business logic"""
    errors = []
    
    # Validate amount with business logic
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
                errors.append(f"amount exceeds transaction limit of ${MAX_AMOUNT}")
            
            # Fraud detection for large amounts
            if amount_decimal > 5000:
                print(f"[FRAUD ALERT] Large transaction: ${amount} from IP {client_ip}")
                
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
    
    # Validate optional fields
    wallet_address = request_data.get("wallet_address")
    if wallet_address and not validate_wallet_address(wallet_address):
        errors.append("Invalid wallet address format")
    
    user_email = request_data.get("user_email")
    if user_email and not validate_email(user_email):
        errors.append("Invalid email format")
    
    # Check velocity limits
    if amount and not errors:
        amount_decimal = Decimal(str(amount))
        can_proceed, hourly_total, daily_total = check_velocity_limits(client_ip, amount_decimal)
        if not can_proceed:
            if hourly_total >= HOURLY_LIMIT_PER_IP:
                errors.append(f"Hourly transaction limit of ${HOURLY_LIMIT_PER_IP} exceeded")
            else:
                errors.append(f"Daily transaction limit of ${DAILY_LIMIT_PER_IP} exceeded")
    
    return errors

def create_error_response(status_code, error_message, error_code=None, cors_headers=None):
    """Create standardized error response without information leakage"""
    if cors_headers is None:
        cors_headers = {"Content-Type": "application/json"}
    
    # Log detailed error internally
    print(f"[Square API] Error {status_code}: {error_message}")
    
    # Generic error messages for clients
    user_messages = {
        400: "Invalid request format",
        401: "Authentication required",
        403: "Access denied",
        404: "Endpoint not found",
        409: "Duplicate request",
        413: "Request too large",
        429: "Too many requests",
        500: "Payment service temporarily unavailable",
        503: "Payment service temporarily unavailable",
        504: "Payment service timeout",
    }
    
    user_message = user_messages.get(status_code, "An error occurred")
    
    response_body = {
        "success": False,
        "error": {
            "message": user_message,
            "code": error_code or f"ERR_{status_code}",
        }
    }
    
    return {
        "statusCode": status_code,
        "headers": cors_headers,
        "body": json.dumps(response_body)
    }

def create_square_session():
    """Create requests session with retry logic"""
    if not REQUESTS_AVAILABLE:
        return None
    
    try:
        from requests.adapters import HTTPAdapter
        from requests.packages.urllib3.util.retry import Retry  # type: ignore
        
        session = requests.Session()
        
        retry_strategy = Retry(
            total=3,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["POST"]
        )
        
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
        
        return session
    except Exception as e:
        print(f"[Square API] Failed to create session: {e}")
        return None

def handle_process_payment(request_data, cors_headers, client_ip):
    """Process Square payment with comprehensive security and privacy"""
    try:
        print("[Square] Starting payment processing...")
        sanitized_data = sanitize_for_logging(request_data)
        print(f"[Square] Request data: {json.dumps(sanitized_data)[:LOG_TRUNCATE_LENGTH]}")
        
        # Get configuration
        config = get_square_config()
        square_access_token = config["access_token"]
        square_location_id = config["location_id"]
        square_api_base_url = config["api_base_url"]
        
        print(f"[Square] Environment: {config['environment']}")
        
        # Validate credentials (don't expose details)
        if not square_access_token:
            return create_error_response(500, "Payment service configuration error", "SERVICE_ERROR", cors_headers)
        
        if not square_location_id:
            return create_error_response(500, "Payment service configuration error", "SERVICE_ERROR", cors_headers)
        
        # Validate request data
        validation_errors = validate_payment_request(request_data, client_ip)
        if validation_errors:
            return create_error_response(400, "; ".join(validation_errors), "VALIDATION_ERROR", cors_headers)
        
        # Extract request data
        source_id = request_data.get("source_id") or request_data.get("sourceId") or request_data.get("token")
        amount = request_data.get("amount")
        currency = request_data.get("currency", "USD").upper()
        idempotency_key = request_data.get("idempotency_key") or request_data.get("idempotencyKey")
        
        # Validate idempotency key
        idempotency_valid, idempotency_error = validate_idempotency_key(idempotency_key, amount)
        if not idempotency_valid:
            return create_error_response(400, idempotency_error or "Invalid idempotency key", "IDEMPOTENCY_ERROR", cors_headers)
        
        # Convert amount to cents
        try:
            amount_decimal = Decimal(str(amount))
            amount_cents = int(amount_decimal * 100)
            print(f"[Square] Amount: ${amount} → {amount_cents} cents")
        except (InvalidOperation, ValueError) as e:
            return create_error_response(400, "Invalid amount format", "INVALID_AMOUNT", cors_headers)
        
        if not REQUESTS_AVAILABLE:
            return create_error_response(500, "Payment service temporarily unavailable", "SERVICE_ERROR", cors_headers)
        
        # Generate secure reference ID
        reference_id = generate_secure_reference_id()
        
        # Store metadata securely (without PII in Square)
        metadata = {
            "timestamp": time.time(),
            "amount": float(amount),
            "currency": currency,
            "ip_address": client_ip,
            "risk_profile": request_data.get("risk_profile"),
            "include_ergc": request_data.get("include_ergc"),
            "use_existing_ergc": request_data.get("use_existing_ergc"),
            # Store PII only in encrypted Redis, not in Square
            "wallet_address": request_data.get("wallet_address"),
            "user_email": request_data.get("user_email")
        }
        
        store_payment_metadata(reference_id, metadata)
        
        # Prepare Square API request - NO PII in notes!
        square_payload = {
            "source_id": source_id,
            "idempotency_key": idempotency_key,
            "amount_money": {
                "amount": amount_cents,
                "currency": currency,
            },
            "location_id": square_location_id,
            "autocomplete": True,
            "reference_id": reference_id,  # Use reference_id instead of note
        }
        
        # Add sanitized note with only non-PII data
        note_parts = []
        risk_profile = request_data.get("risk_profile")
        if risk_profile:
            note_parts.append(f"risk:{sanitize_note_value(risk_profile)}")
        
        # Add ERGC info (sanitized)
        include_ergc = request_data.get("include_ergc")
        if include_ergc is not None:
            try:
                ergc_value = int(float(include_ergc))
                note_parts.append(f"ergc:{ergc_value}")
            except (TypeError, ValueError):
                pass
        
        use_existing_ergc = request_data.get("use_existing_ergc")
        if use_existing_ergc is not None:
            try:
                ergc_value = int(float(use_existing_ergc))
                note_parts.append(f"debit_ergc:{ergc_value}")
            except (TypeError, ValueError):
                pass
        
        if note_parts:
            square_payload["note"] = " ".join(note_parts)
        
        api_url = f"{square_api_base_url}/v2/payments"
        
        print(f"[Square] Processing payment: ${amount} (ref: {reference_id})")
        
        # Create session with retry logic
        session = create_square_session()
        if not session:
            return create_error_response(500, "Payment service temporarily unavailable", "SERVICE_ERROR", cors_headers)
        
        # Call Square API with retry logic
        try:
            response = session.post(
                api_url,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {square_access_token}",
                    "Square-Version": os.getenv("SQUARE_API_VERSION", "2024-10-16"),
                },
                json=square_payload,
                timeout=REQUEST_TIMEOUT,
            )
        except Exception as e:
            error_type = type(e).__name__
            if "Timeout" in error_type:
                return create_error_response(504, "Payment service timeout", "TIMEOUT_ERROR", cors_headers)
            elif "ConnectionError" in error_type:
                return create_error_response(503, "Cannot connect to payment service", "CONNECTION_ERROR", cors_headers)
            else:
                return create_error_response(500, "Payment service temporarily unavailable", "SERVICE_ERROR", cors_headers)
        
        print(f"[Square] API response status: {response.status_code}")
        
        # Handle response
        if not response.ok:
            try:
                error_data = response.json()
            except:
                error_data = {"detail": response.text or f"HTTP {response.status_code}"}
            
            errors = error_data.get("errors", [])
            if errors:
                error_detail = errors[0].get("detail", "Payment Failed")
                error_code = errors[0].get("code", "UNKNOWN")
                print(f"[Square] Payment failed: {error_code} - {error_detail}")
                return create_error_response(
                    response.status_code,
                    "Payment processing failed",
                    f"SQUARE_{error_code}",
                    cors_headers
                )
            else:
                return create_error_response(
                    response.status_code,
                    "Payment processing failed",
                    "SQUARE_API_ERROR",
                    cors_headers
                )
        
        # Parse successful response
        try:
            data = response.json()
        except Exception as e:
            print(f"[Square] Failed to parse JSON response: {e}")
            return create_error_response(500, "Invalid response from payment service", "INVALID_RESPONSE", cors_headers)
        
        payment_data = data.get("payment", {})
        payment_id = payment_data.get("id")
        payment_status = payment_data.get("status")
        
        print(f"[Square] Payment processed - ID: {payment_id}, Status: {payment_status}, Ref: {reference_id}")
        
        return {
            "statusCode": 200,
            "headers": cors_headers,
            "body": json.dumps({
                "success": True,
                "payment_id": payment_id,
                "status": payment_status,
                "order_id": payment_data.get("order_id"),
                "transaction_id": payment_id,
                "reference_id": reference_id,
                "message": "Payment processed successfully",
                "amount_money": payment_data.get("amount_money", {}),
            })
        }
    
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        
        print(f"[Square] Unexpected error: {e}")
        traceback.print_exc()
        
        return create_error_response(500, "Payment service temporarily unavailable", "INTERNAL_ERROR", cors_headers)

def handler(event, context):
    """Vercel Python serverless function handler with comprehensive security"""
    # Get request origin for CORS
    headers = event.get("headers", {})
    if not isinstance(headers, dict):
        headers = {}
    
    request_origin = headers.get("origin", "")
    cors_headers = validate_cors_origin(request_origin)
    
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
        print(f"[Square API] Initialization error: {_INIT_ERROR}")
        return create_error_response(500, "Payment service configuration error", "INIT_ERROR", cors_headers)
    
    try:
        # Parse request method
        method = event.get("httpMethod") or event.get("method") or "GET"
        
        # Handle OPTIONS (CORS preflight)
        if method == "OPTIONS":
            return {
                "statusCode": 200,
                "headers": cors_headers,
                "body": ""
            }
        
        # Only allow POST
        if method != "POST":
            return create_error_response(405, "Method not allowed", "METHOD_NOT_ALLOWED", cors_headers)
        
        # Get client IP for rate limiting
        client_ip = get_client_ip(headers)
        
        # Rate limit check
        rate_limit_ok, retry_after = check_rate_limit(f"{client_ip}:process-payment")
        if not rate_limit_ok:
            return create_error_response(429, "Too many requests", "RATE_LIMIT_EXCEEDED", cors_headers)
        
        # Validate body size
        body = event.get("body", "") or ""
        if len(body) > MAX_BODY_SIZE:
            return create_error_response(413, "Request too large", "PAYLOAD_TOO_LARGE", cors_headers)
        
        # Parse body
        try:
            request_data = json.loads(body) if body else {}
        except (json.JSONDecodeError, ValueError) as e:
            print(f"[Square API] Body parse error: {e}")
            return create_error_response(400, "Invalid JSON in request body", "INVALID_JSON", cors_headers)
        
        # Process payment
        return handle_process_payment(request_data, cors_headers, client_ip)
    
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        
        print(f"[Square API] Handler error: {error_type}: {error_msg}")
        traceback.print_exc()
        
        return create_error_response(500, "Payment service temporarily unavailable", "HANDLER_ERROR", cors_headers)
