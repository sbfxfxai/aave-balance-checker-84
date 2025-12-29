"""
Test payment to trigger webhook
This script makes a test payment and checks if the webhook processes it correctly

Usage:
    python tests/test_webhook_payment.py SOURCE_ID
    
    Where SOURCE_ID is a payment token from Square Web Payments SDK
    To get a token, use the frontend payment form with test card: 4111 1111 1111 1111
"""
import os
import sys
import json
import time
import requests  # type: ignore[import-untyped]

def make_test_payment(source_id: str, wallet_address: str = None):
    """Make a test payment to trigger webhook"""
    
    # Get credentials from environment
    access_token = os.getenv("SQUARE_ACCESS_TOKEN")
    location_id = os.getenv("SQUARE_LOCATION_ID")
    api_base_url = os.getenv("SQUARE_API_BASE_URL", "https://connect.squareup.com")
    
    if not access_token or not location_id:
        print("❌ ERROR: Square credentials not set!")
        print("Set environment variables:")
        print("  SQUARE_ACCESS_TOKEN")
        print("  SQUARE_LOCATION_ID")
        return False
    
    print("=" * 70)
    print("Test Payment to Trigger Webhook")
    print("=" * 70)
    print(f"\n💰 Amount: $1.00")
    print(f"📍 Location ID: {location_id}")
    print(f"🎫 Payment Token: {source_id[:30]}...")
    if wallet_address:
        print(f"👛 Wallet Address: {wallet_address}")
    print()
    
    # Generate unique idempotency key
    idempotency_key = f"webhook-test-{int(time.time() * 1000)}"
    
    # Prepare payment request with wallet info (so webhook can process it)
    payment_data = {
        "source_id": source_id,
        "amount": 1.00,
        "currency": "USD",
        "idempotency_key": idempotency_key,
        "wallet_address": wallet_address or "0x0000000000000000000000000000000000000000",
        "user_email": "test@tiltvault.com",
        "risk_profile": "conservative"
    }
    
    print("🚀 Making payment request...")
    print(f"   Idempotency Key: {idempotency_key}")
    print()
    
    try:
        # Call the payment endpoint
        api_url = f"{api_base_url}/v2/payments"
        
        payload = {
            "source_id": source_id,
            "idempotency_key": idempotency_key,
            "amount_money": {
                "amount": 100,  # $1.00 in cents
                "currency": "USD"
            },
            "location_id": location_id,
            "autocomplete": True,
            "note": f"wallet:{wallet_address or '0x0000000000000000000000000000000000000000'} risk:conservative email:test@tiltvault.com"
        }
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
            "Square-Version": os.getenv("SQUARE_API_VERSION", "2024-10-16"),
        }
        
        response = requests.post(api_url, json=payload, headers=headers, timeout=30)
        
        print("=" * 70)
        print("Payment Response")
        print("=" * 70)
        print(f"\nStatus Code: {response.status_code}")
        
        if response.ok:
            data = response.json()
            payment = data.get("payment", {})
            payment_id = payment.get("id")
            status = payment.get("status")
            
            print("\n✅ PAYMENT SUCCESSFUL!")
            print(f"   Payment ID: {payment_id}")
            print(f"   Status: {status}")
            print(f"   Transaction ID: {payment.get('id')}")
            print()
            print("📡 Webhook should be triggered automatically by Square")
            print(f"   Check Vercel logs for payment ID: {payment_id}")
            print()
            print("To check webhook logs:")
            print(f"   vercel logs https://www.tiltvault.com --since=now")
            print()
            return True
        else:
            error_data = response.json() if response.text else {}
            errors = error_data.get("errors", [])
            if errors:
                error_detail = errors[0].get("detail", "Payment failed")
                error_code = errors[0].get("code", "UNKNOWN")
                print(f"\n❌ PAYMENT FAILED")
                print(f"   Error: {error_detail}")
                print(f"   Code: {error_code}")
            else:
                print(f"\n❌ PAYMENT FAILED: {response.status_code}")
                print(f"   Response: {response.text[:200]}")
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
        print("  python tests/test_webhook_payment.py SOURCE_ID [WALLET_ADDRESS]")
        print("\nExample:")
        print("  python tests/test_webhook_payment.py cnon:CA4SE... 0x1234...")
        print("\nTo get a payment token:")
        print("  1. Go to your frontend payment page")
        print("  2. Use Square Web Payments SDK")
        print("  3. Tokenize test card: 4111 1111 1111 1111")
        print("  4. Copy the token (starts with 'cnon:')")
        print("\nOptional: Provide wallet address to test full webhook flow")
        sys.exit(1)
    
    source_id = sys.argv[1]
    wallet_address = sys.argv[2] if len(sys.argv) > 2 else None
    
    success = make_test_payment(source_id, wallet_address)
    sys.exit(0 if success else 1)

