from fastapi import APIRouter  # type: ignore
from . import deposit_flow, withdraw_flow, broadcaster

router = APIRouter()

router.include_router(deposit_flow.router, prefix="/transactions")
router.include_router(withdraw_flow.router, prefix="/transactions")
router.include_router(broadcaster.router, prefix="/transactions")
