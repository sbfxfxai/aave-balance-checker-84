from fastapi import APIRouter, HTTPException  # type: ignore
from app.wallet import connect, auth

router = APIRouter()

@router.post("/connect")
async def connect_wallet(address: str):
    if not connect.validate_address(address):
        raise HTTPException(status_code=400, detail="Invalid Ethereum address")
    
    session_token = auth.create_session(address)
    return {
        "status": "connected",
        "address": address,
        "session_token": session_token
    }

@router.get("/session/{session_token}")
async def get_session(session_token: str):
    session = auth.validate_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return session
