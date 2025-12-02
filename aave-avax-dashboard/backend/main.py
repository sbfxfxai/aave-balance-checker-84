import os
from decimal import Decimal
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from web3 import Web3

# eth-defi imports
from eth_defi.aave_v3 import AaveV3Reserve, get_aave_v3_reserves
from eth_defi.aave_v3.deposit import supply_erc20
from eth_defi.aave_v3.withdraw import withdraw_erc20
from eth_defi.uniswap_v2 import swap_with_uniswap_v2
from eth_defi.token import fetch_erc20_details
from eth_defi.chain import install_chain_middleware

app = FastAPI(title="Avalanche Aave Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AVALANCHE CONFIG
RPC_URL = os.getenv("AVAX_RPC_URL", "https://api.avax.network/ext/bc/C/rpc")
web3 = Web3(Web3.HTTPProvider(RPC_URL))
install_chain_middleware(web3)

# Key tokens
AVAX = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
USDC_E = "0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664"
WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7"

# DeFi contracts
TRADERJOE_ROUTER = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4"
AAVE_POOL = "0x794a1aE18D657714751C9b0F82B9538f22f4625A"

class WalletConnect(BaseModel):
    address: str
    signature: str = None

@app.get("/")
def home():
    return {"chain": "Avalanche", "status": "ready"}

@app.get("/positions/{wallet}")
def get_positions(wallet: str):
    try:
        reserves = get_aave_v3_reserves(web3)
        usdc_reserve: AaveV3Reserve = reserves[USDC_E.lower()]

        supplied = usdc_reserve.get_deposit_balance(wallet)
        stable_debt = usdc_reserve.get_stable_debt_balance(wallet)
        variable_debt = usdc_reserve.get_variable_debt_balance(wallet)

        usdc = fetch_erc20_details(web3, USDC_E)
        def fmt(x): return round(Decimal(x) / 10**6, 4) if x else 0

        return {
            "wallet": wallet,
            "usdc_supplied": fmt(supplied),
            "usdc_stable_debt": fmt(stable_debt),
            "usdc_variable_debt": fmt(variable_debt),
            "total_debt": fmt(stable_debt + variable_debt),
            "health_factor": usdc_reserve.get_health_factor(wallet),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/deposit")
def deposit_flow(wallet: WalletConnect, amount_avax: float):
    try:
        txs = []
        
        # Wrap AVAX → WAVAX
        wrap_tx = {
            "to": WAVAX,
            "value": int(amount_avax * 1e18),
            "data": "0xd0e30db0"  # deposit() function
        }
        txs.append(wrap_tx)

        # Swap WAVAX → USDC.e
        swap_tx = swap_with_uniswap_v2(
            web3,
            router_address=TRADERJOE_ROUTER,
            token_in=WAVAX,
            token_out=USDC_E,
            amount_in=int(amount_avax * 1e18),
            recipient=wallet.address,
            slippage_tolerance=0.5,
        )
        txs.append(swap_tx)

        # Supply to Aave
        supply_tx = supply_erc20(
            web3,
            pool_address=AAVE_POOL,
            token_address=USDC_E,
            amount=int(amount_avax * 1e18 * 0.99),  # estimate after swap
            who=wallet.address,
        )
        txs.extend(supply_tx)

        return {"transactions": txs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/withdraw")
def withdraw_flow(wallet: WalletConnect, amount_usdc: float):
    try:
        txs = []

        # Withdraw from Aave
        withdraw_tx = withdraw_erc20(
            web3,
            pool_address=AAVE_POOL,
            token_address=USDC_E,
            amount=int(amount_usdc * 1e6),
            to_address=wallet.address,
        )
        txs.extend(withdraw_tx)

        # Swap USDC.e → AVAX
        swap_tx = swap_with_uniswap_v2(
            web3,
            router_address=TRADERJOE_ROUTER,
            token_in=USDC_E,
            token_out=AVAX,
            amount_in=int(amount_usdc * 1e6),
            recipient=wallet.address,
            slippage_tolerance=0.5,
        )
        txs.append(swap_tx)

        return {"transactions": txs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
