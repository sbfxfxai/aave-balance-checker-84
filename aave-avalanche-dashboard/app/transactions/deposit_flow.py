from fastapi import APIRouter, Depends, HTTPException  # type: ignore
from app.wallet.auth import validate_session
from app.aave.deposit import supply_to_aave
from app.swap.traderjoe import execute_swap
from app.config import WAVAX, USDC_E, AVAX

router = APIRouter()

@router.post("/deposit")
async def deposit_flow(amount_avax: float, session: dict = Depends(validate_session)):
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    
    address = session["address"]
    
    try:
        # 1. Wrap AVAX → WAVAX
        wrap_tx = {
            "to": WAVAX,
            "value": int(amount_avax * 1e18),
            "data": "0xd0e30db0"  # deposit()
        }
        
        # 2. Swap WAVAX → USDC.e
        swap_tx = execute_swap(
            token_in=WAVAX,
            token_out=USDC_E,
            amount_in=int(amount_avax * 1e18),
            recipient=address
        )
        
        # 3. Supply to Aave
        supply_txs = supply_to_aave(
            token_address=USDC_E,
            amount=int(amount_avax * 1e18 * 0.99),  # Estimate after swap
            on_behalf_of=address
        )
        
        return {"transactions": [wrap_tx, swap_tx, *supply_txs]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
