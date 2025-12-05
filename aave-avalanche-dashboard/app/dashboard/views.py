from fastapi import APIRouter, Depends, HTTPException  # type: ignore
from app.wallet.auth import validate_session
from app.aave.positions import get_user_summary
from app.wallet.provider import get_web3_provider

router = APIRouter()

@router.get("/positions")
async def get_user_positions(session_token: str):
    session = validate_session(session_token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    
    web3 = get_web3_provider()
    return get_user_summary(web3, session["address"])

@router.get("/health")
async def health_check():
    return {"status": "ok", "chain": "avalanche"}
