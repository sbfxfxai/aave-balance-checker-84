"""
Send encrypted wallet backup via email
Uses Mailgun or similar email service
"""
import os
import json
import sys

# Try to import requests for email API calls
try:
    import requests  # type: ignore[import-untyped]
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    print("[Wallet Backup] WARNING: requests library not available")

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
        
        encrypted_wallet = request_data.get("encrypted_wallet")
        wallet_address = request_data.get("wallet_address")
        user_email = request_data.get("user_email")
        
        # Validate required fields
        if not encrypted_wallet:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"error": "encrypted_wallet is required"})
            }
        
        if not wallet_address:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"error": "wallet_address is required"})
            }
        
        if not user_email or '@' not in user_email:
            return {
                "statusCode": 400,
                "headers": cors_headers,
                "body": json.dumps({"error": "user_email is required and must be valid"})
            }
        
        # Check if requests is available
        if not REQUESTS_AVAILABLE or not requests:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "error": "Server configuration error: requests library not available",
                    "message": "Please ensure requirements.txt includes 'requests>=2.31.0'"
                })
            }
        
        # Send email using Mailgun API
        mailgun_api_key = os.getenv("MAILGUN_API_KEY", "")
        mailgun_domain = os.getenv("MAILGUN_DOMAIN", "")
        
        if not mailgun_api_key or not mailgun_domain:
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "error": "Email service not configured",
                    "message": "MAILGUN_API_KEY and MAILGUN_DOMAIN environment variables required"
                })
            }
        
        # Prepare email content
        email_subject = "TiltVault Wallet Recovery - Save This Email!"
        email_text = f"""
Hello,

Your TiltVault wallet has been created successfully!

Wallet Address: {wallet_address}

IMPORTANT: Your encrypted wallet backup is attached below. 
To recover your wallet:
1. Use your email address as the password
2. Decrypt the backup using Web Crypto API (AES-GCM)
3. The encrypted data is base64 encoded

Encrypted Wallet Backup:
{encrypted_wallet}

SECURITY NOTES:
- This backup is encrypted with your email address
- Never share this encrypted backup with anyone
- Store this email securely
- You can decrypt it using your email address as the password

If you have any questions, please contact support.

Best regards,
TiltVault Team
        """.strip()
        
        email_html = f"""
<html>
<body>
<h2>Your TiltVault Wallet Recovery</h2>
<p>Your wallet has been created successfully!</p>
<p><strong>Wallet Address:</strong> <code>{wallet_address}</code></p>
<p><strong>IMPORTANT:</strong> Your encrypted wallet backup is below.</p>
<p><strong>To recover your wallet:</strong></p>
<ol>
<li>Use your email address as the password</li>
<li>Decrypt the backup using Web Crypto API (AES-GCM)</li>
<li>The encrypted data is base64 encoded</li>
</ol>
<pre style="background: #f5f5f5; padding: 10px; word-wrap: break-word; white-space: pre-wrap;">{encrypted_wallet}</pre>
<p><strong>SECURITY NOTES:</strong></p>
<ul>
<li>This backup is encrypted with your email address</li>
<li>Never share this encrypted backup with anyone</li>
<li>Store this email securely</li>
</ul>
<p>If you have any questions, please contact support.</p>
<p>Best regards,<br>TiltVault Team</p>
</body>
</html>
        """.strip()
        
        # Send via Mailgun API
        mailgun_url = f"https://api.mailgun.net/v3/{mailgun_domain}/messages"
        
        response = requests.post(
            mailgun_url,
            auth=("api", mailgun_api_key),
            data={
                "from": f"TiltVault <noreply@{mailgun_domain}>",
                "to": user_email,
                "subject": email_subject,
                "text": email_text,
                "html": email_html,
            },
            timeout=10,
        )
        
        if response.status_code == 200:
            print(f"[Wallet Backup] Email sent successfully to {user_email}")
            return {
                "statusCode": 200,
                "headers": cors_headers,
                "body": json.dumps({
                    "success": True,
                    "message": "Recovery email sent successfully",
                    "email": user_email
                })
            }
        else:
            error_msg = response.text or f"HTTP {response.status_code}"
            print(f"[Wallet Backup] Mailgun error: {error_msg}")
            return {
                "statusCode": 500,
                "headers": cors_headers,
                "body": json.dumps({
                    "error": "Failed to send email",
                    "message": error_msg
                })
            }
        
    except Exception as e:
        error_type = type(e).__name__
        error_msg = str(e)
        
        print(f"[Wallet Backup] Error: {error_type}: {error_msg}")
        
        return {
            "statusCode": 500,
            "headers": cors_headers,
            "body": json.dumps({
                "error": "Internal server error",
                "message": error_msg,
                "type": error_type
            })
        }

