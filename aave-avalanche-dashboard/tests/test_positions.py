import pytest  # type: ignore
from app.aave.positions import get_user_summary
from app.config import USDC_E
from web3 import Web3  # type: ignore

# Mock Web3 provider
@pytest.fixture
def mock_web3(mocker):
    web3 = mocker.MagicMock()
    return web3

# Test get_user_summary
def test_get_user_summary(mock_web3, mocker):
    # Mock reserves data
    mock_reserve = mocker.MagicMock()
    mock_reserve.get_deposit_balance.return_value = 1000000  # 1 USDC
    mock_reserve.get_variable_debt_balance.return_value = 500000  # 0.5 USDC
    mock_reserve.get_stable_debt_balance.return_value = 300000  # 0.3 USDC
    mock_reserve.get_health_factor.return_value = 1.5
    
    # Mock fetch_all_reserves
    mocker.patch(
        "eth_defi.aave_v3.fetch_all_reserves",
        return_value={USDC_E.lower(): mock_reserve}
    )
    
    result = get_user_summary(mock_web3, "0xWalletAddress")
    
    assert result["supplied_usdc"] == 1.0
    assert result["borrowed_usdc"] == 0.8
    assert result["health_factor"] == 1.5
