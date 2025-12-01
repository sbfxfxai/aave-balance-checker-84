from eth_defi.aave_v3.withdraw import withdraw_erc20
from app.wallet.provider import get_web3_provider

# Withdraw tokens from Aave
def withdraw_from_aave(token_address: str, amount: int, to_address: str):
    web3 = get_web3_provider()
    return withdraw_erc20(
        web3,
        pool_address=AAVE_V3_POOL,
        token_address=token_address,
        amount=amount,
        to_address=to_address
    )
