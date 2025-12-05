from fastapi import APIRouter, Depends, HTTPException  # type: ignore
from app.wallet.auth import validate_session
from app.aave.withdraw import withdraw_from_aave
from app.swap.traderjoe import execute_swap
from app.config import USDC_E, AVAX

router = APIRouter()

@router.post("/withdraw")
async def withdraw_flow(amount_usdc: float, session: dict = Depends(validate_session)):
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    address = session["address"]
    
    try:
        # 1. Withdraw from Aave
        withdraw_txs = withdraw_from_aave(
            token_address=USDC_E,
            amount=int(amount_usdc * 1e6),
            to_address=address
        )
        
        # 2. Swap USDC.e → AVAX
        swap_tx = execute_swap(
            token_in=USDC_E,
            token_out=AVAX,
            amount_in=int(amount_usdc * 1e6),
            recipient=address
        )
        
        return {"transactions": [*withdraw_txs, swap_tx]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
