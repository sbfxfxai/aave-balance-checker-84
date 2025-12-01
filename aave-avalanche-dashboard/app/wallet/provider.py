from app.wallet.connect import init_web3
from eth_defi.gas import apply_gas_estimation_override

# Get Web3 provider with middleware
def get_web3_provider():
    web3 = init_web3()
    return web3

# Estimate gas with buffer
def estimate_gas_with_buffer(web3, tx, buffer_percent=10):
    base_gas = web3.eth.estimate_gas(tx)
    return int(base_gas * (1 + buffer_percent/100))

# Get current gas price
def get_current_gas_price(web3):
    return web3.eth.gas_price
