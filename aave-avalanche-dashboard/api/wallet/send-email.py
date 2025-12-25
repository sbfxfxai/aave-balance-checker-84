"""
Wallet Email endpoint for Vercel
Handles POST /api/wallet/send-email
Sends wallet details via Mailgun (wallet is generated on frontend with ethers.js)
"""
from http.server import BaseHTTPRequestHandler
import os
import json
import traceback
import time
from typing import Optional

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False


def get_config():
    """Get configuration from environment variables"""
    return {
        "mailgun_api_key": os.getenv("MAILGUN_API_KEY", ""),
        "mailgun_domain": os.getenv("MAILGUN_DOMAIN", ""),
        "mailgun_from_email": os.getenv("MAILGUN_FROM_EMAIL", "noreply@tiltvault.com"),
        "admin_email": os.getenv("ADMIN_EMAIL", ""),
    }


def send_wallet_email(
    to_email: str,
    wallet_address: str,
    mnemonic: str,
    user_name: Optional[str] = None
) -> dict:
    """Send wallet details via Mailgun"""
    config = get_config()
    
    if not config["mailgun_api_key"]:
        return {"success": False, "error": "MAILGUN_API_KEY not configured"}
    
    if not config["mailgun_domain"]:
        return {"success": False, "error": "MAILGUN_DOMAIN not configured"}
    
    if not REQUESTS_AVAILABLE:
        return {"success": False, "error": "requests library not available"}
    
    greeting = f"Hi {user_name}," if user_name else "Hi,"
    
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }}
            .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
            .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }}
            .content {{ background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px; }}
            .wallet-box {{ background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; }}
            .address {{ font-family: monospace; font-size: 14px; word-break: break-all; background: #f3f4f6; padding: 10px; border-radius: 4px; }}
            .mnemonic {{ font-family: monospace; font-size: 14px; background: #fef3c7; padding: 15px; border-radius: 4px; border: 1px solid #f59e0b; }}
            .warning {{ background: #fee2e2; border: 1px solid #ef4444; padding: 15px; border-radius: 8px; margin: 20px 0; }}
            .warning-title {{ color: #dc2626; font-weight: bold; margin-bottom: 10px; }}
            .footer {{ text-align: center; color: #6b7280; font-size: 12px; margin-top: 30px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="margin: 0;">🔐 Your Stack Wallet</h1>
                <p style="margin: 10px 0 0 0; opacity: 0.9;">Powered by TiltVault</p>
            </div>
            <div class="content">
                <p>{greeting}</p>
                <p>Your new wallet has been created on the Avalanche network. Below are your wallet details.</p>
                
                <div class="wallet-box">
                    <h3 style="margin-top: 0;">📍 Wallet Address</h3>
                    <p>Use this address to receive USDC and other tokens:</p>
                    <div class="address">{wallet_address}</div>
                </div>
                
                <div class="wallet-box">
                    <h3 style="margin-top: 0;">🔑 Recovery Phrase (12 words)</h3>
                    <p>This is your secret recovery phrase. You can use it to restore your wallet in Trust Wallet, MetaMask, or any compatible wallet.</p>
                    <div class="mnemonic">{mnemonic}</div>
                </div>
                
                <div class="warning">
                    <div class="warning-title">⚠️ IMPORTANT - READ CAREFULLY</div>
                    <ul style="margin: 0; padding-left: 20px;">
                        <li><strong>Never share</strong> your recovery phrase with anyone</li>
                        <li><strong>Write it down</strong> and store it in a safe place</li>
                        <li><strong>Delete this email</strong> after saving your recovery phrase securely</li>
                        <li>Anyone with your recovery phrase can access your funds</li>
                        <li>TiltVault will <strong>never</strong> ask for your recovery phrase</li>
                    </ul>
                </div>
                
                <h3>📱 Import to Trust Wallet</h3>
                <ol>
                    <li>Open Trust Wallet app</li>
                    <li>Tap "Add Wallet" → "I already have a wallet"</li>
                    <li>Select "Multi-Coin Wallet"</li>
                    <li>Enter your 12-word recovery phrase</li>
                    <li>Your wallet is ready!</li>
                </ol>
                
                <p>Your USDC deposit will be sent to this wallet once your payment clears.</p>
                
                <div class="footer">
                    <p>TiltVault • Avalanche C-Chain • USDC</p>
                    <p>This is an automated message. Please do not reply.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    """
    
    text_content = f"""
{greeting}

Your new wallet has been created on the Avalanche network.

WALLET ADDRESS:
{wallet_address}

RECOVERY PHRASE (12 words):
{mnemonic}

⚠️ IMPORTANT:
- Never share your recovery phrase with anyone
- Write it down and store it in a safe place
- Delete this email after saving your recovery phrase securely
- Anyone with your recovery phrase can access your funds

TO IMPORT TO TRUST WALLET:
1. Open Trust Wallet app
2. Tap "Add Wallet" → "I already have a wallet"
3. Select "Multi-Coin Wallet"
4. Enter your 12-word recovery phrase
5. Your wallet is ready!

Your USDC deposit will be sent to this wallet once your payment clears.

---
TiltVault • Avalanche C-Chain • USDC
    """
    
    try:
        mailgun_url = f"https://api.mailgun.net/v3/{config['mailgun_domain']}/messages"
        # Use simple email format without display name to avoid parsing issues
        from_email = config['mailgun_from_email'] or f"noreply@{config['mailgun_domain']}"
        
        print(f"[Mailgun] Sending to: {to_email}")
        print(f"[Mailgun] From: {from_email}")
        print(f"[Mailgun] URL: {mailgun_url}")
        print(f"[Mailgun] API Key (first 10 chars): {config['mailgun_api_key'][:10]}...")
        
        response = requests.post(
            mailgun_url,
            auth=("api", config["mailgun_api_key"]),
            data={
                "from": f"TiltVault <noreply@{config['mailgun_domain']}>",
                "to": to_email,
                "subject": "Your Stack Wallet - Recovery Phrase Inside",
                "text": text_content,
                "html": html_content,
            },
            timeout=30,
        )
        
        print(f"[Mailgun] Response status: {response.status_code}")
        print(f"[Mailgun] Response body: {response.text[:500]}")
        
        if response.ok:
            return {"success": True, "message_id": response.json().get("id")}
        else:
            return {"success": False, "error": f"Mailgun error ({response.status_code}): {response.text}"}
            
    except Exception as e:
        print(f"[Mailgun] Exception: {e}")
        return {"success": False, "error": str(e)}


def create_json_response(handler, status_code, data):
    """Helper to send JSON response"""
    handler.send_response(status_code)
    handler.send_header('Content-type', 'application/json')
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    handler.end_headers()
    handler.wfile.write(json.dumps(data).encode())


def handle_send_email(request_data: dict) -> tuple:
    """Handle wallet email request - wallet generated on frontend"""
    # Validate required fields
    email = request_data.get("email")
    if not email:
        return 400, {"success": False, "error": "email is required"}
    
    wallet_address = request_data.get("wallet_address")
    if not wallet_address:
        return 400, {"success": False, "error": "wallet_address is required"}
    
    mnemonic = request_data.get("mnemonic")
    if not mnemonic:
        return 400, {"success": False, "error": "mnemonic is required"}
    
    user_name = request_data.get("name")
    
    # Debug: Check config
    config = get_config()
    print(f"[Wallet] Config check - API Key length: {len(config['mailgun_api_key'])}")
    print(f"[Wallet] Config check - Domain: {config['mailgun_domain']}")
    print(f"[Wallet] Config check - From: {config['mailgun_from_email']}")
    
    try:
        print(f"[Wallet] Sending wallet email to {email}")
        email_result = send_wallet_email(
            to_email=email,
            wallet_address=wallet_address,
            mnemonic=mnemonic,
            user_name=user_name,
        )
        
        if not email_result["success"]:
            print(f"[Wallet] Email failed: {email_result.get('error')}")
            # Return the actual error message to frontend for debugging
            return 200, {
                "success": False,
                "error": email_result.get("error"),
                "debug": {
                    "domain": config['mailgun_domain'],
                    "api_key_length": len(config['mailgun_api_key']),
                }
            }
        
        print(f"[Wallet] Email sent successfully to {email}")
        return 200, {
            "success": True,
            "email_sent": True,
            "message": f"Wallet details sent to {email}",
            "timestamp": int(time.time()),
        }
        
    except Exception as e:
        print(f"[Wallet] Error: {e}")
        traceback.print_exc()
        return 200, {"success": False, "error": str(e)}


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()
    
    def do_GET(self):
        """GET - return service status"""
        config = get_config()
        create_json_response(self, 200, {
            "service": "wallet-send-email",
            "status": "ready",
            "requests_available": REQUESTS_AVAILABLE,
            "mailgun_configured": bool(config["mailgun_api_key"] and config["mailgun_domain"]),
        })
    
    def do_POST(self):
        """Handle POST requests for sending wallet email"""
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else '{}'
        
        try:
            request_data = json.loads(body)
        except json.JSONDecodeError as e:
            create_json_response(self, 400, {
                "success": False,
                "error": f"Invalid JSON: {e}"
            })
            return
        
        print(f"[Wallet] Send email request received")
        status_code, response_data = handle_send_email(request_data)
        create_json_response(self, status_code, response_data)
