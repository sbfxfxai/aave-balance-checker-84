from eth_defi.aave_v3 import AaveV3Pool, fetch_all_reserves  # type: ignore
from app.config import AAVE_V3_POOL
from app.wallet.provider import get_web3_provider

# Initialize Aave V3 Pool client
def get_aave_pool():
    web3 = get_web3_provider()
    return AaveV3Pool(web3, AAVE_V3_POOL)

# Get all reserves with caching
def get_cached_reserves():
    web3 = get_web3_provider()
    return fetch_all_reserves(web3)
