"""
Process a Real $1.00 Payment to Square
This script processes an actual payment using Square API

Usage:
    python tests/process_real_payment.py SOURCE_ID
    
    Where SOURCE_ID is a payment token from Square Web Payments SDK
    Format: cnon:... or card-nonce:...
"""
import os
import sys
import json
import time

# Add api directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api', 'square'))

from index import handle_process_payment


def process_one_dollar_payment(source_id: str):
    """Process a real $1.00 payment"""
    
    # Set credentials
    access_token = os.getenv("SQUARE_ACCESS_TOKEN", "EAAAlygTphTRCrNzZ8GoYXNPWp1ipsp9kp3qArPdqAb9tReNEgCw8TNDr1rvAC-M")
    location_id = os.getenv("SQUARE_LOCATION_ID", "6PA5SZ9GE68E0")
    
    os.environ["SQUARE_ACCESS_TOKEN"] = access_token
    os.environ["SQUARE_LOCATION_ID"] = location_id
    os.environ["SQUARE_API_BASE_URL"] = os.getenv("SQUARE_API_BASE_URL", "https://connect.squareup.com")
    os.environ["SQUARE_ENVIRONMENT"] = os.getenv("SQUARE_ENVIRONMENT", "production")
    
    print("=" * 70)
    print("Square Payment Handler - Process $1.00 Real Payment")
    print("=" * 70)
    print(f"\n💰 Amount: $1.00")
    print(f"📍 Location ID: {location_id}")
    print(f"🔑 Access Token: {access_token[:20]}...")
    print(f"🎫 Payment Token: {source_id}")
    print()
    
    # Generate unique idempotency key
    idempotency_key = f"real-payment-{int(time.time() * 1000)}"
    
    # Prepare payment request
    payment_data = {
        "source_id": source_id,
        "amount": 1.00,
        "currency": "USD",
        "idempotency_key": idempotency_key,
        "risk_profile": "conservative"
    }
    
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
    
    print("🚀 Processing payment...")
    print(f"   Idempotency Key: {idempotency_key}")
    print()
    
    try:
        response = handle_process_payment(payment_data, cors_headers)
        body = json.loads(response["body"])
        
        print("=" * 70)
        print("Payment Result")
        print("=" * 70)
        print(f"\nStatus Code: {response['statusCode']}")
        print(f"Success: {body.get('success', False)}")
        
        if body.get('success'):
            print("\n✅ PAYMENT SUCCESSFUL!")
            print(f"   Payment ID: {body.get('payment_id')}")
            print(f"   Transaction ID: {body.get('transaction_id')}")
            print(f"   Order ID: {body.get('order_id', 'N/A')}")
            print(f"   Message: {body.get('message', 'N/A')}")
            print("\n💰 $1.00 has been successfully processed!")
            return True
        else:
            print("\n❌ PAYMENT FAILED")
            print(f"   Error: {body.get('error', 'Unknown error')}")
            if 'error_code' in body:
                print(f"   Error Code: {body['error_code']}")
            return False
            
    except Exception as e:
        print(f"\n❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    finally:
        print("=" * 70)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("❌ ERROR: Payment token (source_id) required!")
        print("\nUsage:")
        print("  python tests/process_real_payment.py SOURCE_ID")
        print("\nExample:")
        print("  python tests/process_real_payment.py cnon:card-nonce-ok")
        print("\nTo get a payment token:")
        print("  1. Use Square Web Payments SDK in your frontend")
        print("  2. Tokenize a card using card.tokenize()")
        print("  3. Pass the token to this script")
        print("\nFor testing, you can use Square's test card:")
        print("  Card Number: 4111 1111 1111 1111")
        print("  CVV: Any 3 digits")
        print("  Expiry: Any future date")
        sys.exit(1)
    
    source_id = sys.argv[1]
    success = process_one_dollar_payment(source_id)
    sys.exit(0 if success else 1)

