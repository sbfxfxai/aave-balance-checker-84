from app.config import WAVAX, USDC_E
from app.swap.traderjoe import execute_swap

# Find best route for swap (currently only supports Trader Joe)
def get_best_route(token_in: str, token_out: str, amount_in: int):
    # In production, this would compare multiple DEXs
    # For now, we only support Trader Joe
    return {
        "exchange": "TraderJoe",
        "expected_output": 0,  # Would be calculated in real implementation
        "slippage_tolerance": 0.5
    }

# Execute optimized swap
def execute_optimized_swap(token_in: str, token_out: str, amount_in: int, recipient: str):
    # Currently only uses Trader Joe
    return execute_swap(token_in, token_out, amount_in, recipient)
