"""
Square Banking Balance endpoint for Vercel
Handles GET /api/square/balance
Returns Square account balance and recent payments to track cleared deposits
"""
from http.server import BaseHTTPRequestHandler
import os
import json
import traceback
import time

# Try to import requests
REQUESTS_AVAILABLE = False
requests = None
try:
    import requests  # type: ignore[import-untyped]
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


def create_json_response(handler, status_code, data):
    """Helper to send JSON response"""
    handler.send_response(status_code)
    handler.send_header('Content-type', 'application/json')
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    handler.end_headers()
    handler.wfile.write(json.dumps(data).encode())


def get_balance():
    """Get Square account balance"""
    config = get_square_config()
    
    if not config["access_token"]:
        return 500, {"success": False, "error": "SQUARE_ACCESS_TOKEN not configured"}
    
    if not REQUESTS_AVAILABLE:
        return 500, {"success": False, "error": "requests library not available"}
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['access_token']}",
        "Square-Version": os.getenv("SQUARE_API_VERSION", "2024-10-16"),
    }
    
    result = {
        "success": True,
        "timestamp": int(time.time()),
        "environment": config["environment"],
        "location_id": config["location_id"],
    }
    
    try:
        # Get location info (includes currency)
        location_url = f"{config['api_base_url']}/v2/locations/{config['location_id']}"
        location_response = requests.get(location_url, headers=headers, timeout=10)
        
        if location_response.ok:
            location_data = location_response.json()
            location = location_data.get("location", {})
            result["location"] = {
                "name": location.get("name"),
                "currency": location.get("currency", "USD"),
                "status": location.get("status"),
            }
        
        # Get recent payments (last 24 hours) to track cleared deposits
        # This shows what payments have been processed
        from datetime import datetime, timedelta
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(days=7)  # Last 7 days
        
        payments_url = f"{config['api_base_url']}/v2/payments"
        payments_params = {
            "location_id": config["location_id"],
            "begin_time": start_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end_time": end_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "sort_order": "DESC",
            "limit": 50,
        }
        
        payments_response = requests.get(
            payments_url, 
            headers=headers, 
            params=payments_params,
            timeout=15
        )
        
        if payments_response.ok:
            payments_data = payments_response.json()
            payments = payments_data.get("payments", [])
            
            # Categorize payments by status
            completed_payments = []
            pending_payments = []
            total_completed = 0
            total_pending = 0
            
            for payment in payments:
                status = payment.get("status", "")
                amount_money = payment.get("amount_money", {})
                amount_cents = amount_money.get("amount", 0)
                amount_usd = amount_cents / 100.0
                
                payment_summary = {
                    "id": payment.get("id"),
                    "status": status,
                    "amount": amount_usd,
                    "currency": amount_money.get("currency", "USD"),
                    "created_at": payment.get("created_at"),
                    "updated_at": payment.get("updated_at"),
                    "source_type": payment.get("source_type"),
                    "card_brand": payment.get("card_details", {}).get("card", {}).get("card_brand"),
                    "last_4": payment.get("card_details", {}).get("card", {}).get("last_4"),
                }
                
                if status == "COMPLETED":
                    completed_payments.append(payment_summary)
                    total_completed += amount_usd
                elif status in ["PENDING", "APPROVED"]:
                    pending_payments.append(payment_summary)
                    total_pending += amount_usd
            
            result["payments"] = {
                "completed": completed_payments[:10],  # Last 10 completed
                "pending": pending_payments,
                "total_completed_7d": round(total_completed, 2),
                "total_pending": round(total_pending, 2),
                "count_completed": len(completed_payments),
                "count_pending": len(pending_payments),
            }
        else:
            result["payments_error"] = payments_response.text[:200]
        
        # Try to get bank accounts (if available)
        # Note: This requires BANK_ACCOUNTS_READ permission
        try:
            bank_url = f"{config['api_base_url']}/v2/bank-accounts"
            bank_response = requests.get(bank_url, headers=headers, timeout=10)
            
            if bank_response.ok:
                bank_data = bank_response.json()
                bank_accounts = bank_data.get("bank_accounts", [])
                result["bank_accounts"] = [
                    {
                        "id": acc.get("id"),
                        "account_number_suffix": acc.get("account_number_suffix"),
                        "bank_name": acc.get("bank_name"),
                        "status": acc.get("status"),
                        "primary": acc.get("primary_bank_identifier_type") == "PRIMARY",
                    }
                    for acc in bank_accounts
                ]
            else:
                # Bank accounts API might not be available
                result["bank_accounts_note"] = "Bank accounts API not available or no accounts linked"
        except Exception as e:
            result["bank_accounts_error"] = str(e)
        
        return 200, result
        
    except Exception as e:
        print(f"[Square Balance] Error: {e}")
        traceback.print_exc()
        return 500, {"success": False, "error": str(e)}


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests for balance"""
        print("[Square Balance] Fetching balance and payments...")
        status_code, response_data = get_balance()
        create_json_response(self, status_code, response_data)
    
    def do_POST(self):
        """POST not allowed"""
        create_json_response(self, 405, {
            "success": False,
            "error": "Use GET for balance check"
        })
