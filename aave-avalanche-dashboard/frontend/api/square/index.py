"""
Vercel Python serverless function for Square API endpoints
Uses AWS Lambda format (event, context) which Vercel Python functions expect
"""
import json
import os
import sys
import traceback

def handler(event, context):
    """
    Vercel Python function handler (AWS Lambda format)
    event: dict with httpMethod, path, headers, body, etc.
    context: Lambda context object (not used but required)
    """
    try:
        # Extract request details from event
        method = event.get("httpMethod", event.get("method", "GET"))
        path = event.get("path", event.get("url", ""))
        
        # Handle path parsing (Vercel might pass full path or relative)
        if path.startswith("/api/square"):
            # Already has full path
            pass
        elif path.startswith("/"):
            # Relative path, keep as is
            pass
        else:
            # Might be just the route part
            path = f"/api/square/{path}" if path else "/api/square/health"
        
        # CORS headers
        headers = {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
        }
        
        # Handle OPTIONS (CORS preflight)
        if method == "OPTIONS":
            return {
                "statusCode": 200,
                "headers": headers,
                "body": ""
            }
        
        # Health check endpoint
        if "/api/square/health" in path and method == "GET":
            return {
                "statusCode": 200,
                "headers": headers,
                "body": json.dumps({
                    "status": "healthy",
                    "service": "square-api",
                    "python_version": sys.version.split()[0],
                    "environment": os.getenv("VERCEL_ENV", "unknown"),
                    "credentials_configured": bool(
                        os.getenv("SQUARE_ACCESS_TOKEN") and 
                        os.getenv("SQUARE_LOCATION_ID")
                    ),
                    "path_received": path,
                    "method_received": method
                })
            }
        
        # Process payment endpoint
        if "/api/square/process-payment" in path and method == "POST":
            try:
                # Parse body
                body = event.get("body", "{}")
                if isinstance(body, str):
                    try:
                        data = json.loads(body)
                    except json.JSONDecodeError:
                        return {
                            "statusCode": 400,
                            "headers": headers,
                            "body": json.dumps({"error": "Invalid JSON in request body"})
                        }
                else:
                    data = body
                
                # Validate required fields
                source_id = data.get("source_id")
                amount = data.get("amount")
                idempotency_key = data.get("idempotency_key")
                
                if not source_id:
                    return {
                        "statusCode": 400,
                        "headers": headers,
                        "body": json.dumps({"error": "source_id is required"})
                    }
                
                if not amount or amount <= 0:
                    return {
                        "statusCode": 400,
                        "headers": headers,
                        "body": json.dumps({"error": "Valid amount is required"})
                    }
                
                if not idempotency_key:
                    return {
                        "statusCode": 400,
                        "headers": headers,
                        "body": json.dumps({"error": "idempotency_key is required"})
                    }
                
                # Check credentials
                access_token = os.getenv("SQUARE_ACCESS_TOKEN", "")
                location_id = os.getenv("SQUARE_LOCATION_ID", "")
                
                if not access_token or not location_id:
                    return {
                        "statusCode": 500,
                        "headers": headers,
                        "body": json.dumps({
                            "error": "Square credentials not configured",
                            "access_token_set": bool(access_token),
                            "location_id_set": bool(location_id)
                        })
                    }
                
                # Return test response for now
                # TODO: Add actual Square API call once handler is confirmed working
                return {
                    "statusCode": 200,
                    "headers": headers,
                    "body": json.dumps({
                        "success": True,
                        "message": "Handler is working - ready to process payments",
                        "test_mode": True,
                        "received": {
                            "source_id": source_id[:20] + "..." if len(source_id) > 20 else source_id,
                            "amount": amount,
                            "currency": data.get("currency", "USD"),
                            "idempotency_key": idempotency_key[:20] + "..." if len(idempotency_key) > 20 else idempotency_key
                        },
                        "credentials_configured": True
                    })
                }
            except Exception as e:
                print(f"[Square API] Payment processing error: {e}")
                traceback.print_exc()
                return {
                    "statusCode": 500,
                    "headers": headers,
                    "body": json.dumps({
                        "error": "Error processing request",
                        "message": str(e),
                        "type": type(e).__name__
                    })
                }
        
        # 404 for unknown routes
        return {
            "statusCode": 404,
            "headers": headers,
            "body": json.dumps({
                "error": "Not found",
                "path": path,
                "method": method
            })
        }
        
    except Exception as e:
        print(f"[Square API] Handler error: {e}")
        traceback.print_exc()
        return {
            "statusCode": 500,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            },
            "body": json.dumps({
                "error": "Internal server error",
                "message": str(e),
                "type": type(e).__name__
            })
        }
