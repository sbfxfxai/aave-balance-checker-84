"""
Derive Ethereum address from private key
Uses eth_account library for secp256k1 key derivation
"""
import os
import json
import sys

# Try to import eth_account
try:
    from eth_account import Account  # type: ignore[import-untyped]
    ETH_ACCOUNT_AVAILABLE = True
except ImportError:
    ETH_ACCOUNT_AVAILABLE = False
    print("[Wallet Create] WARNING: eth_account not available")

def handler(event, context):
    """Vercel Python serverless function handler"""
    cors_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
    
    # Handle OPTIONS (CORS preflight)
    method = event.get("httpMethod") or event.get("method") or "GET"
    if method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": cors_headers,
            "body": ""
        }
    
    if method != "POST":
        return {
            "statusCode": 405,
            "headers": cors_headers,
            "body": json.dumps({"error": "Method not allowed. Use POST."})
        }
    
    try:
        # Parse body
        body = event.get("body", "") or ""
        if isinstance(body, str):
            request_data = json.loads(body)
        else:
            request_data = body
        
        private_key = request_data.get("private_key")
        
        if not private_key:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"error": "private_key is required"})
            }
        
        # Validate private key format
        if not isinstance(private_key, str):
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"error": "private_key must be a string"})
            }
        
        # Remove 0x prefix if present
        if private_key.startswith('0x'):
            private_key = private_key[2:]
        
        # Validate hex format and length (64 hex chars = 32 bytes)
        if len(private_key) != 64:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"error": "private_key must be 64 hex characters (32 bytes)"})
            }
        
        try:
            # Validate it's valid hex
            int(private_key, 16)
        except ValueError:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"error": "private_key must be valid hexadecimal"})
            }
        
        # Check if eth_account is available
        if not ETH_ACCOUNT_AVAILABLE:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "error": "Server configuration error: eth_account library not available",
                    "message": "Please ensure requirements.txt includes 'eth-account>=0.8.0'"
                })
            }
        
        # Derive Ethereum address from private key
        # Add 0x prefix back for eth_account
        private_key_with_prefix = '0x' + private_key
        account = Account.from_key(private_key_with_prefix)
        
        return {
            "statusCode": 200,
            "headers": cors_headers,
            "body": json.dumps({
                "address": account.address,
                "success": True
            })
        }
        
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        
        print(f"[Wallet Create] Error: {error_type}: {error_msg}")
        
        return {
            "statusCode": 500,
            "headers": cors_headers,
            "body": json.dumps({
                "error": "Internal server error",
                "message": error_msg,
                "type": error_type
            })
        }

