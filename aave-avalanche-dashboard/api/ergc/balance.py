"""
ERGC balance check endpoint for Vercel
Handles GET /api/ergc/balance?address=0x...
"""
from http.server import BaseHTTPRequestHandler
import os
import json
from urllib.parse import urlparse, parse_qs

# Try to import web3
WEB3_AVAILABLE = False
Web3 = None
try:
    from web3 import Web3
    WEB3_AVAILABLE = True
except ImportError:
    pass

# Configuration
AVALANCHE_RPC = os.getenv("AVALANCHE_RPC_URL", "https://api.avax.network/ext/bc/C/rpc")
ERGC_CONTRACT = "0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B"

# Minimal ERC20 ABI for balanceOf
ERC20_ABI = [
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
    }
]


def create_json_response(handler, status_code, data):
    """Helper to send JSON response"""
    handler.send_response(status_code)
    handler.send_header('Content-type', 'application/json')
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type')
    handler.end_headers()
    handler.wfile.write(json.dumps(data).encode())


def get_ergc_balance(address: str) -> dict:
    """Get ERGC balance for an address"""
    if not WEB3_AVAILABLE:
        return {"success": False, "error": "Web3 not available"}
    
    try:
        w3 = Web3(Web3.HTTPProvider(AVALANCHE_RPC))
        
        if not w3.is_connected():
            return {"success": False, "error": "Failed to connect to Avalanche RPC"}
        
        # Validate address
        if not w3.is_address(address):
            return {"success": False, "error": "Invalid address format"}
        
        checksum_address = w3.to_checksum_address(address)
        
        # Create contract instance
        contract = w3.eth.contract(
            address=w3.to_checksum_address(ERGC_CONTRACT),
            abi=ERC20_ABI
        )
        
        # Get balance
        balance_wei = contract.functions.balanceOf(checksum_address).call()
        balance = balance_wei / (10 ** 18)  # ERGC has 18 decimals
        
        return {
            "success": True,
            "address": checksum_address,
            "balance": balance,
            "balance_raw": str(balance_wei),
            "has_discount": balance >= 1,  # Need at least 1 ERGC for discount
            "tokens_needed": max(0, 1 - balance) if balance < 1 else 0
        }
        
    except Exception as e:
        print(f"[ERGC] Balance check error: {e}")
        return {"success": False, "error": str(e)}


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests for ERGC balance check"""
        # Parse query parameters
        parsed_url = urlparse(self.path)
        query_params = parse_qs(parsed_url.query)
        
        address = query_params.get('address', [None])[0]
        
        if not address:
            create_json_response(self, 400, {
                "success": False,
                "error": "address parameter is required"
            })
            return
        
        print(f"[ERGC] Checking balance for {address}")
        
        result = get_ergc_balance(address)
        
        if result.get("success"):
            create_json_response(self, 200, result)
        else:
            create_json_response(self, 400, result)
