from web3 import Web3  # type: ignore
from app.config import RPC_URL, USDC_E
from eth_defi.token import fetch_erc20_details  # type: ignore

# Connect to Avalanche
w3 = Web3(Web3.HTTPProvider(RPC_URL))

# Check USDC.e balance
def check_balance(wallet_address):
    usdc = fetch_erc20_details(w3, USDC_E)
    balance = usdc.contract.functions.balanceOf(wallet_address).call()
    return balance / 10 ** usdc.decimals

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python check_usdc_balance.py <wallet_address>")
        sys.exit(1)
    
    wallet_address = sys.argv[1]
    balance = check_balance(wallet_address)
    print(f"USDC.e Balance: {balance:.4f}")
