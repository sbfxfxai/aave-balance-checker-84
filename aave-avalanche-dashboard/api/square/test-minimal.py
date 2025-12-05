"""
Minimal test handler for Vercel Python functions
This is the simplest possible handler to verify Vercel can invoke Python functions
"""
import json

def handler(event, context):
    """
    Minimal handler - just returns success
    This tests if Vercel can invoke Python functions at all
    """
    try:
        print("[TEST-MINIMAL] Handler called")
        print(f"[TEST-MINIMAL] Event type: {type(event)}")
        print(f"[TEST-MINIMAL] Event keys: {list(event.keys()) if isinstance(event, dict) else 'Not a dict'}")
        
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "status": "ok",
                "message": "Minimal Python handler working",
                "event_type": str(type(event)),
                "event_keys": list(event.keys()) if isinstance(event, dict) else None,
            })
        }
    except Exception as e:
        print(f"[TEST-MINIMAL] Error: {e}")
        import traceback
        traceback.print_exc()
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "error": str(e),
                "type": type(e).__name__
            })
        }

