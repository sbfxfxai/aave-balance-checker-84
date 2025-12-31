from fastapi import APIRouter, HTTPException  # type: ignore[import-untyped]

router = APIRouter()

# Note: validate_session import removed - authentication is handled via Privy/Web3 wallet signatures
# If session validation is needed, implement it using Privy server-auth or wallet signature verification
