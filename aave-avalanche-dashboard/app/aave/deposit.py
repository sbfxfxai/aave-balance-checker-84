from eth_defi.aave_v3.deposit import supply_erc20
from app.config import AAVE_REFERRAL_CODE
from app.wallet.provider import get_web3_provider

# Supply tokens to Aave
def supply_to_aave(token_address: str, amount: int, on_behalf_of: str):
    web3 = get_web3_provider()
    return supply_erc20(
        web3,
        pool_address=AAVE_V3_POOL,
        token_address=token_address,
        amount=amount,
        who=on_behalf_of,
        referral_code=AAVE_REFERRAL_CODE
    )
