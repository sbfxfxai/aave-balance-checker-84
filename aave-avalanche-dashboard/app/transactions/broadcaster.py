from fastapi import APIRouter, Depends, HTTPException  # type: ignore[import-untyped]
from app.wallet.auth import validate_session

router = APIRouter()

@router.post("/broadcast")
async def broadcast_transaction(tx_data: dict, session: dict = Depends(validate_session)):
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    # In production, this would send the transaction via WalletConnect
    # For now, we just return the transaction data
    return {
        "status": "success",
        "message": "Transaction would be broadcasted via WalletConnect",
        "tx_data": tx_data
    }
