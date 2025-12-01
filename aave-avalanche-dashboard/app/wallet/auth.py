import time
from web3 import Web3

# Session management for authenticated users
sessions = {}

# Create session token
def create_session(address: str) -> str:
    session_token = Web3.keccak(text=f"{address}-{time.time()}").hex()
    sessions[session_token] = {
        "address": address,
        "created_at": time.time(),
        "expires_at": time.time() + 3600  # 1 hour expiration
    }
    return session_token

# Validate session token
def validate_session(session_token: str) -> dict:
    session = sessions.get(session_token)
    if not session:
        return None
    
    if time.time() > session["expires_at"]:
        del sessions[session_token]
        return None
    
    return session
