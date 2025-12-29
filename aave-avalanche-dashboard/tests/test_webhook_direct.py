"""
Test webhook directly with mock payment event
This simulates what Square sends to the webhook endpoint
"""
import os
import json
import requests  # type: ignore[import-untyped]

def test_webhook_direct(payment_id: str = None, wallet_address: str = None):
    """Test webhook endpoint directly with mock Square event"""
    
    # Use provided payment ID or generate a test one
    test_payment_id = payment_id or f"test-payment-{int(time.time() * 1000)}"
    test_wallet = wallet_address or "0x1234567890123456789012345678901234567890"
    
    # Mock Square webhook event (payment.updated)
    webhook_event = {
        "type": "payment.updated",
        "event_id": f"test-event-{int(time.time())}",
        "created_at": "2025-01-27T00:00:00Z",
        "data": {
            "type": "payment",
            "id": "test-payment-id",
            "object": {
                "payment": {
                    "id": test_payment_id,
                    "status": "COMPLETED",
                    "amount_money": {
                        "amount": 100,  # $1.00 in cents
                        "currency": "USD"
                    },
                    "note": f"wallet:{test_wallet} risk:conservative email:test@tiltvault.com",
                    "created_at": "2025-01-27T00:00:00Z",
                    "updated_at": "2025-01-27T00:00:00Z"
                }
            }
        }
    }
    
    print("=" * 70)
    print("Direct Webhook Test")
    print("=" * 70)
    print(f"\n📡 Sending mock webhook event to /api/square/webhook")
    print(f"   Payment ID: {test_payment_id}")
    print(f"   Wallet: {test_wallet}")
    print(f"   Status: COMPLETED")
    print()
    
    # Get webhook URL (local or production)
    webhook_url = os.getenv("WEBHOOK_URL", "https://www.tiltvault.com/api/square/webhook")
    
    try:
        print(f"🚀 Sending POST request to {webhook_url}...")
        
        response = requests.post(
            webhook_url,
            json=webhook_event,
            headers={
                "Content-Type": "application/json",
                "X-Square-Signature": "test-signature"  # Mock signature
            },
            timeout=30
        )
        
        print("=" * 70)
        print("Webhook Response")
        print("=" * 70)
        print(f"\nStatus Code: {response.status_code}")
        
        try:
            response_data = response.json()
            print(f"Response: {json.dumps(response_data, indent=2)}")
        except:
            print(f"Response Text: {response.text[:500]}")
        
        if response.status_code == 200:
            print("\n✅ Webhook processed successfully!")
            print("\nCheck Vercel logs to see if:")
            print("  1. Signature verification worked (or was skipped)")
            print("  2. Payment was marked as processed in Redis")
            print("  3. Wallet funding was triggered")
            return True
        else:
            print(f"\n❌ Webhook returned error status: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"\n❌ EXCEPTION: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    finally:
        print("=" * 70)


if __name__ == "__main__":
    import sys
    import time
    
    payment_id = sys.argv[1] if len(sys.argv) > 1 else None
    wallet_address = sys.argv[2] if len(sys.argv) > 2 else None
    
    print("\n⚠️  NOTE: This tests the webhook endpoint directly")
    print("   For a real test, make an actual payment through Square")
    print("   Square will then send the webhook automatically\n")
    
    success = test_webhook_direct(payment_id, wallet_address)
    sys.exit(0 if success else 1)

