from eth_defi.aave_v3 import fetch_all_reserves
from app.wallet.provider import get_web3_provider

# Get all reserves with additional metadata
def get_reserves_metadata():
    web3 = get_web3_provider()
    reserves = fetch_all_reserves(web3)
    
    result = {}
    for address, reserve in reserves.items():
        result[address] = {
            "symbol": reserve.symbol,
            "decimals": reserve.decimals,
            "liquidity_rate": reserve.get_liquidity_rate(),
            "variable_borrow_rate": reserve.get_variable_borrow_rate(),
            "stable_borrow_rate": reserve.get_stable_borrow_rate(),
            "liquidity_index": reserve.get_liquidity_index(),
            "variable_borrow_index": reserve.get_variable_borrow_index()
        }
    
    return result
