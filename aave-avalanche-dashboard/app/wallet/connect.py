from web3 import Web3  # type: ignore
from eth_defi.chain import install_chain_middleware  # type: ignore
from app.config import RPC_URL

# Initialize Web3 with Avalanche RPC
def init_web3():
    web3 = Web3(Web3.HTTPProvider(RPC_URL))
    install_chain_middleware(web3)
    return web3

# Validate Ethereum address
def validate_address(address: str) -> bool:
    return Web3.is_address(address)

# Create WalletConnect session
def create_walletconnect_session():
    # In production, integrate with WalletConnect Cloud
    return {"status": "success", "message": "WalletConnect session created"}
