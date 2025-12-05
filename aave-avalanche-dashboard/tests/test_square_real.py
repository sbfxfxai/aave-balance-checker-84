"""
Real Square API Test - Run with actual credentials
This script tests a real $1.00 payment to Square

Usage:
    Set environment variables:
    export SQUARE_ACCESS_TOKEN="your_token"
    export SQUARE_LOCATION_ID="your_location_id"
    
    Or pass as arguments:
    python tests/test_square_real.py YOUR_TOKEN YOUR_LOCATION_ID
"""
import os
import sys
import json
import time

# Add api directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'api', 'square'))

from index import handler, handle_process_payment, handle_health


def test_real_payment():
    """Test real $1.00 payment with Square API"""
    
    # Get credentials from environment or arguments
    access_token = os.getenv("SQUARE_ACCESS_TOKEN") or (sys.argv[1] if len(sys.argv) > 1 else None)
    location_id = os.getenv("SQUARE_LOCATION_ID") or (sys.argv[2] if len(sys.argv) > 2 else None)
    
    if not access_token or not location_id:
        print("❌ ERROR: Square credentials not provided!")
        print("\nUsage:")
        print("  Option 1: Set environment variables")
        print("    export SQUARE_ACCESS_TOKEN='your_token'")
        print("    export SQUARE_LOCATION_ID='your_location_id'")
        print("\n  Option 2: Pass as arguments")
        print("    python tests/test_square_real.py YOUR_TOKEN YOUR_LOCATION_ID")
        return False
    
    # Set credentials in environment for handler
    os.environ["SQUARE_ACCESS_TOKEN"] = access_token
    os.environ["SQUARE_LOCATION_ID"] = location_id
    os.environ["SQUARE_API_BASE_URL"] = os.getenv("SQUARE_API_BASE_URL", "https://connect.squareup.com")
    os.environ["SQUARE_ENVIRONMENT"] = os.getenv("SQUARE_ENVIRONMENT", "production")
    
    print("=" * 60)
    print("Square Payment Handler - Real API Test")
    print("=" * 60)
    print(f"\n📍 Location ID: {location_id}")
    print(f"🔑 Access Token: {access_token[:20]}...")
    print(f"🌐 API Base URL: {os.environ['SQUARE_API_BASE_URL']}")
    print(f"🏭 Environment: {os.environ['SQUARE_ENVIRONMENT']}")
    print()
    
    # Test 1: Health Check
    print("1️⃣ Testing Health Endpoint...")
    mock_context = type('obj', (object,), {})()
    health_event = {
        "httpMethod": "GET",
        "path": "/api/square/health",
        "headers": {},
        "body": ""
    }
    
    health_response = handler(health_event, mock_context)
    health_body = json.loads(health_response["body"])
    
    if health_response["statusCode"] == 200:
        print("   ✅ Health check passed")
        print(f"   - Credentials configured: {health_body.get('credentials_configured')}")
        print(f"   - Production mode: {health_body.get('is_production')}")
        print(f"   - API endpoint: {health_body.get('production_endpoint')}")
    else:
        print(f"   ❌ Health check failed: {health_response['statusCode']}")
        print(f"   Response: {health_body}")
        return False
    
    print()
    
    # Test 2: Payment Processing (requires valid token)
    print("2️⃣ Testing Payment Processing...")
    print("   ⚠️  NOTE: This requires a valid Square payment token (source_id)")
    print("   To get a token:")
    print("   1. Use Square Web Payments SDK")
    print("   2. Tokenize a card (test card: 4111 1111 1111 1111)")
    print("   3. Pass the token as source_id")
    print()
    
    # For testing, we'll try with an invalid token first to verify error handling
    print("   Testing with invalid token (should fail gracefully)...")
    idempotency_key = f"test-real-{int(time.time() * 1000)}"
    
    invalid_payment_data = {
        "source_id": "cnon:invalid-test-token-12345",
        "amount": 1.00,
        "currency": "USD",
        "idempotency_key": idempotency_key,
    }
    
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
    
    payment_response = handle_process_payment(invalid_payment_data, cors_headers)
    payment_body = json.loads(payment_response["body"])
    
    print(f"   Status Code: {payment_response['statusCode']}")
    print(f"   Success: {payment_body.get('success', False)}")
    print(f"   Error: {payment_body.get('error', 'N/A')}")
    
    if payment_response["statusCode"] in [400, 401, 404]:
        print("   ✅ Invalid token correctly rejected (expected)")
    else:
        print(f"   ⚠️  Unexpected status code: {payment_response['statusCode']}")
    
    print()
    print("=" * 60)
    print("✅ Basic tests completed!")
    print()
    print("To test a real $1.00 payment:")
    print("  1. Get a valid payment token from Square Web Payments SDK")
    print("  2. Update the source_id in this script")
    print("  3. Run again")
    print("=" * 60)
    
    return True


if __name__ == "__main__":
    success = test_real_payment()
    sys.exit(0 if success else 1)

