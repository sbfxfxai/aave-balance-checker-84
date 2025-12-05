from eth_defi.uniswap_v2 import swap_with_uniswap_v2  # type: ignore
from app.config import TRADERJOE_ROUTER
from app.wallet.provider import get_web3_provider

# Execute swap on Trader Joe
def execute_swap(
    token_in: str,
    token_out: str,
    amount_in: int,
    recipient: str,
    slippage_tolerance: float = 0.5
):
    web3 = get_web3_provider()
    return swap_with_uniswap_v2(
        web3,
        router_address=TRADERJOE_ROUTER,
        token_in=token_in,
        token_out=token_out,
        amount_in=amount_in,
        recipient=recipient,
        slippage_tolerance=slippage_tolerance
    )
