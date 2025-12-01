from eth_defi.aave_v3 import fetch_all_reserves
from decimal import Decimal
from app.config import USDC_E

# Get user positions summary
def get_user_summary(web3, wallet: str):
    reserves = fetch_all_reserves(web3)
    usdc = reserves[USDC_E.lower()]

    supplied = usdc.get_deposit_balance(wallet)
    variable_debt = usdc.get_variable_debt_balance(wallet)
    stable_debt = usdc.get_stable_debt_balance(wallet)
    health = usdc.get_health_factor(wallet)

    def fmt(n): return round(Decimal(n or 0) / 1e6, 4)
    
    return {
        "supplied_usdc": fmt(supplied),
        "borrowed_usdc": fmt(variable_debt + stable_debt),
        "health_factor": float(health) if health else None,
    }
