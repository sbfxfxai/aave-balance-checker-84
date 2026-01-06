// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title TiltVault Manager V2 (Upgradeable)
 * @notice Delegated position management for AAVE and GMX on Avalanche
 * @dev Upgradeable contract using UUPS proxy pattern
 * 
 * IMPORTANT: This contract is upgradeable. Only the owner can upgrade.
 * State variables must be added at the end to preserve storage layout.
 */
contract TiltVaultManagerV2 is 
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    PausableUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // ============ Constants ============
    
    // Avalanche C-Chain addresses
    address public constant USDC = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    address public constant WAVAX = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;
    
    // AAVE V3 on Avalanche
    address public constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address public constant aUSDC = 0x625E7708f30cA75bfd92586e17077590C60eb4cD;
    
    // GMX V2 on Avalanche
    address public constant GMX_ROUTER = 0x820F5FfC5b525cD4d88Cd91aCf2c28F16530Cc68;
    address public constant GMX_EXCHANGE_ROUTER = 0x8f550E53DFe96C055D5Bdb267c21F268fCAF63B2;
    address public constant GMX_ORDER_VAULT = 0xD3D60D22d415aD43b7e64b510D86A30f19B1B12C;
    address public constant GMX_BTC_MARKET = 0xFb02132333A79C8B5Bd0b64E3AbccA5f7fAf2937;
    address public constant BTC_TOKEN = 0x152b9d0FdC40C096757F570A51E494bd4b943E50;

    // ============ State Variables ============
    
    // Mapping of user address => authorized status
    mapping(address => bool) public isAuthorized;
    
    // Mapping of user address => authorized manager addresses
    mapping(address => mapping(address => bool)) public authorizedManagers;
    
    // Backend executor address (TiltVault server)
    address public executor;
    
    // Timelock for executor changes
    address public pendingExecutor;
    uint256 public executorChangeTime;
    uint256 public constant EXECUTOR_CHANGE_DELAY = 2 days;
    
    // Version tracking
    uint256 public version;

    // ============ Events ============
    
    event UserAuthorized(address indexed user, uint256 timestamp);
    event UserRevoked(address indexed user, uint256 timestamp);
    event ManagerAuthorized(address indexed user, address indexed manager, uint256 timestamp);
    event ManagerRevoked(address indexed user, address indexed manager, uint256 timestamp);
    event ExecutorUpdateProposed(address indexed oldExecutor, address indexed newExecutor, uint256 executeTime);
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);
    event Upgraded(address indexed implementation);
    event VersionUpdated(uint256 oldVersion, uint256 newVersion);
    
    event AaveDeposit(address indexed user, uint256 amount, uint256 timestamp);
    event AaveWithdraw(address indexed user, uint256 amount, uint256 timestamp);
    event GmxPositionOpened(address indexed user, uint256 collateral, uint256 leverage, uint256 timestamp);
    event GmxCollateralAdded(address indexed user, uint256 amount, uint256 timestamp);
    event GmxCollateralRemoved(address indexed user, uint256 amount, uint256 timestamp);
    event GmxPositionClosed(address indexed user, uint256 timestamp);
    event ExcessAvaxReturned(address indexed user, uint256 amount);

    // ============ Modifiers ============
    
    modifier onlyAuthorizedFor(address user) {
        require(!paused(), "Contract is paused");
        require(isAuthorized[user], "User not authorized");
        require(
            msg.sender == executor || authorizedManagers[user][msg.sender],
            "Not authorized for this user"
        );
        _;
    }

    // ============ Initializer ============
    
    /**
     * @notice Initialize the contract (replaces constructor for upgradeable contracts)
     * @param _executor Initial executor address
     */
    function initialize(address _executor) public initializer {
        require(_executor != address(0), "Invalid executor address");
        
        __ReentrancyGuard_init();
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __Pausable_init();
        
        executor = _executor;
        version = 1;
        
        // Approve AAVE Pool to spend USDC
        IERC20Upgradeable(USDC).approve(AAVE_POOL, type(uint256).max);
        
        // Approve GMX Router to spend USDC
        IERC20Upgradeable(USDC).approve(GMX_ROUTER, type(uint256).max);
    }

    // ============ UUPS Upgrade Authorization ============
    
    /**
     * @notice Authorize contract upgrades (UUPS pattern)
     * @dev Only owner can upgrade
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        emit Upgraded(newImplementation);
    }

    // ============ User Authorization Functions ============
    
    function authorizeManager() external {
        isAuthorized[msg.sender] = true;
        emit UserAuthorized(msg.sender, block.timestamp);
    }
    
    function revokeAccess() external {
        isAuthorized[msg.sender] = false;
        emit UserRevoked(msg.sender, block.timestamp);
    }
    
    function authorizeSpecificManager(address manager) external {
        require(manager != address(0), "Invalid manager address");
        authorizedManagers[msg.sender][manager] = true;
        emit ManagerAuthorized(msg.sender, manager, block.timestamp);
    }
    
    function revokeSpecificManager(address manager) external {
        authorizedManagers[msg.sender][manager] = false;
        emit ManagerRevoked(msg.sender, manager, block.timestamp);
    }
    
    function isManagerAuthorized(address user, address manager) external view returns (bool) {
        return isAuthorized[user] && (manager == executor || authorizedManagers[user][manager]);
    }

    // ============ AAVE Functions ============
    
    function depositToAave(address user, uint256 amount) external nonReentrant onlyAuthorizedFor(user) {
        require(amount > 0, "Amount must be greater than 0");
        
        IERC20Upgradeable(USDC).safeTransferFrom(user, address(this), amount);
        IAavePool(AAVE_POOL).supply(USDC, amount, user, 0);
        
        emit AaveDeposit(user, amount, block.timestamp);
    }
    
    function withdrawFromAave(address user, uint256 amount) external nonReentrant onlyAuthorizedFor(user) {
        require(amount > 0, "Amount must be greater than 0");
        
        uint256 aTokenBalance = IERC20Upgradeable(aUSDC).balanceOf(user);
        uint256 withdrawAmount = amount == type(uint256).max ? aTokenBalance : amount;
        
        require(withdrawAmount <= aTokenBalance, "Insufficient aToken balance");
        require(withdrawAmount > 0, "Withdraw amount must be greater than 0");
        
        IERC20Upgradeable(aUSDC).safeTransferFrom(user, address(this), withdrawAmount);
        IAavePool(AAVE_POOL).withdraw(USDC, withdrawAmount, user);
        
        emit AaveWithdraw(user, withdrawAmount, block.timestamp);
    }

    // ============ GMX Functions ============
    
    function openGmxPosition(
        address user,
        uint256 collateralAmount,
        uint256 sizeDeltaUsd,
        uint256 executionFee
    ) external payable nonReentrant onlyAuthorizedFor(user) {
        require(collateralAmount > 0, "Collateral must be greater than 0");
        require(sizeDeltaUsd > 0, "Size must be greater than 0");
        require(msg.value >= executionFee, "Insufficient execution fee");
        
        // Return excess AVAX
        if (msg.value > executionFee) {
            uint256 excess = msg.value - executionFee;
            (bool success, ) = payable(msg.sender).call{value: excess}("");
            require(success, "AVAX refund failed");
            emit ExcessAvaxReturned(msg.sender, excess);
        }
        
        IERC20Upgradeable(USDC).safeTransferFrom(user, address(this), collateralAmount);
        IERC20Upgradeable(USDC).safeTransfer(GMX_ORDER_VAULT, collateralAmount);
        
        IGmxExchangeRouter.CreateOrderParams memory params = IGmxExchangeRouter.CreateOrderParams({
            addresses: IGmxExchangeRouter.CreateOrderParamsAddresses({
                receiver: user,
                cancellationReceiver: user,
                callbackContract: address(0),
                uiFeeReceiver: address(0),
                market: GMX_BTC_MARKET,
                initialCollateralToken: USDC,
                swapPath: new address[](0)
            }),
            numbers: IGmxExchangeRouter.CreateOrderParamsNumbers({
                sizeDeltaUsd: sizeDeltaUsd,
                initialCollateralDeltaAmount: collateralAmount,
                triggerPrice: 0,
                acceptablePrice: type(uint256).max,
                executionFee: executionFee,
                callbackGasLimit: 0,
                minOutputAmount: 0,
                validFromTime: 0
            }),
            orderType: IGmxExchangeRouter.OrderType.MarketIncrease,
            decreasePositionSwapType: IGmxExchangeRouter.DecreasePositionSwapType.NoSwap,
            isLong: true,
            shouldUnwrapNativeToken: false,
            autoCancel: false,
            referralCode: bytes32(0)
        });
        
        IGmxExchangeRouter(GMX_EXCHANGE_ROUTER).createOrder{value: executionFee}(params);
        
        emit GmxPositionOpened(user, collateralAmount, sizeDeltaUsd / collateralAmount, block.timestamp);
    }
    
    function addGmxCollateral(
        address user,
        uint256 amount,
        uint256 executionFee
    ) external payable nonReentrant onlyAuthorizedFor(user) {
        require(amount > 0, "Amount must be greater than 0");
        require(msg.value >= executionFee, "Insufficient execution fee");
        
        if (msg.value > executionFee) {
            uint256 excess = msg.value - executionFee;
            (bool success, ) = payable(msg.sender).call{value: excess}("");
            require(success, "AVAX refund failed");
            emit ExcessAvaxReturned(msg.sender, excess);
        }
        
        IERC20Upgradeable(USDC).safeTransferFrom(user, GMX_ORDER_VAULT, amount);
        
        IGmxExchangeRouter.CreateOrderParams memory params = IGmxExchangeRouter.CreateOrderParams({
            addresses: IGmxExchangeRouter.CreateOrderParamsAddresses({
                receiver: user,
                cancellationReceiver: user,
                callbackContract: address(0),
                uiFeeReceiver: address(0),
                market: GMX_BTC_MARKET,
                initialCollateralToken: USDC,
                swapPath: new address[](0)
            }),
            numbers: IGmxExchangeRouter.CreateOrderParamsNumbers({
                sizeDeltaUsd: 0,
                initialCollateralDeltaAmount: amount,
                triggerPrice: 0,
                acceptablePrice: type(uint256).max,
                executionFee: executionFee,
                callbackGasLimit: 0,
                minOutputAmount: 0,
                validFromTime: 0
            }),
            orderType: IGmxExchangeRouter.OrderType.MarketIncrease,
            decreasePositionSwapType: IGmxExchangeRouter.DecreasePositionSwapType.NoSwap,
            isLong: true,
            shouldUnwrapNativeToken: false,
            autoCancel: false,
            referralCode: bytes32(0)
        });
        
        IGmxExchangeRouter(GMX_EXCHANGE_ROUTER).createOrder{value: executionFee}(params);
        
        emit GmxCollateralAdded(user, amount, block.timestamp);
    }
    
    function removeGmxCollateral(
        address user,
        uint256 amount,
        uint256 executionFee
    ) external payable nonReentrant onlyAuthorizedFor(user) {
        require(amount > 0, "Amount must be greater than 0");
        require(msg.value >= executionFee, "Insufficient execution fee");
        
        if (msg.value > executionFee) {
            uint256 excess = msg.value - executionFee;
            (bool success, ) = payable(msg.sender).call{value: excess}("");
            require(success, "AVAX refund failed");
            emit ExcessAvaxReturned(msg.sender, excess);
        }
        
        IGmxExchangeRouter.CreateOrderParams memory params = IGmxExchangeRouter.CreateOrderParams({
            addresses: IGmxExchangeRouter.CreateOrderParamsAddresses({
                receiver: user,
                cancellationReceiver: user,
                callbackContract: address(0),
                uiFeeReceiver: address(0),
                market: GMX_BTC_MARKET,
                initialCollateralToken: USDC,
                swapPath: new address[](0)
            }),
            numbers: IGmxExchangeRouter.CreateOrderParamsNumbers({
                sizeDeltaUsd: 0,
                initialCollateralDeltaAmount: amount,
                triggerPrice: 0,
                acceptablePrice: 0,
                executionFee: executionFee,
                callbackGasLimit: 0,
                minOutputAmount: 0,
                validFromTime: 0
            }),
            orderType: IGmxExchangeRouter.OrderType.MarketDecrease,
            decreasePositionSwapType: IGmxExchangeRouter.DecreasePositionSwapType.NoSwap,
            isLong: true,
            shouldUnwrapNativeToken: false,
            autoCancel: false,
            referralCode: bytes32(0)
        });
        
        IGmxExchangeRouter(GMX_EXCHANGE_ROUTER).createOrder{value: executionFee}(params);
        
        emit GmxCollateralRemoved(user, amount, block.timestamp);
    }
    
    function closeGmxPosition(
        address user,
        uint256 sizeDeltaUsd,
        uint256 executionFee
    ) external payable nonReentrant onlyAuthorizedFor(user) {
        require(msg.value >= executionFee, "Insufficient execution fee");
        
        if (msg.value > executionFee) {
            uint256 excess = msg.value - executionFee;
            (bool success, ) = payable(msg.sender).call{value: excess}("");
            require(success, "AVAX refund failed");
            emit ExcessAvaxReturned(msg.sender, excess);
        }
        
        IGmxExchangeRouter.CreateOrderParams memory params = IGmxExchangeRouter.CreateOrderParams({
            addresses: IGmxExchangeRouter.CreateOrderParamsAddresses({
                receiver: user,
                cancellationReceiver: user,
                callbackContract: address(0),
                uiFeeReceiver: address(0),
                market: GMX_BTC_MARKET,
                initialCollateralToken: USDC,
                swapPath: new address[](0)
            }),
            numbers: IGmxExchangeRouter.CreateOrderParamsNumbers({
                sizeDeltaUsd: sizeDeltaUsd,
                initialCollateralDeltaAmount: 0,
                triggerPrice: 0,
                acceptablePrice: 0,
                executionFee: executionFee,
                callbackGasLimit: 0,
                minOutputAmount: 0,
                validFromTime: 0
            }),
            orderType: IGmxExchangeRouter.OrderType.MarketDecrease,
            decreasePositionSwapType: IGmxExchangeRouter.DecreasePositionSwapType.NoSwap,
            isLong: true,
            shouldUnwrapNativeToken: false,
            autoCancel: false,
            referralCode: bytes32(0)
        });
        
        IGmxExchangeRouter(GMX_EXCHANGE_ROUTER).createOrder{value: executionFee}(params);
        
        emit GmxPositionClosed(user, block.timestamp);
    }

    // ============ Admin Functions ============
    
    function proposeExecutorChange(address newExecutor) external onlyOwner {
        require(newExecutor != address(0), "Invalid executor address");
        require(newExecutor != executor, "Same as current executor");
        
        pendingExecutor = newExecutor;
        executorChangeTime = block.timestamp + EXECUTOR_CHANGE_DELAY;
        
        emit ExecutorUpdateProposed(executor, newExecutor, executorChangeTime);
    }
    
    function executeExecutorChange() external onlyOwner {
        require(pendingExecutor != address(0), "No pending executor change");
        require(block.timestamp >= executorChangeTime, "Timelock not expired");
        
        address oldExecutor = executor;
        executor = pendingExecutor;
        pendingExecutor = address(0);
        executorChangeTime = 0;
        
        emit ExecutorUpdated(oldExecutor, executor);
    }
    
    function cancelExecutorChange() external onlyOwner {
        pendingExecutor = address(0);
        executorChangeTime = 0;
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        require(!paused() || token == USDC, "Can only withdraw USDC when paused");
        
        uint256 contractBalance = IERC20Upgradeable(token).balanceOf(address(this));
        uint256 withdrawAmount = amount == type(uint256).max ? contractBalance : amount;
        
        require(withdrawAmount <= contractBalance, "Insufficient contract balance");
        
        IERC20Upgradeable(token).safeTransfer(to, withdrawAmount);
    }
    
    function emergencyWithdrawAvax(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        
        uint256 contractBalance = address(this).balance;
        uint256 withdrawAmount = amount == type(uint256).max ? contractBalance : amount;
        
        require(withdrawAmount <= contractBalance, "Insufficient contract balance");
        
        (bool success, ) = to.call{value: withdrawAmount}("");
        require(success, "AVAX transfer failed");
    }

    // ============ Upgrade Functions ============
    
    /**
     * @notice Update version number after upgrade
     * @dev Should be called after each upgrade to track version
     */
    function updateVersion(uint256 newVersion) external onlyOwner {
        uint256 oldVersion = version;
        version = newVersion;
        emit VersionUpdated(oldVersion, newVersion);
    }

    // ============ View Functions ============
    
    function checkAuthorization(address user) external view returns (bool) {
        return isAuthorized[user];
    }
    
    function getUserAllowance(address user) external view returns (uint256) {
        return IERC20Upgradeable(USDC).allowance(user, address(this));
    }
    
    function getUserATokenAllowance(address user) external view returns (uint256) {
        return IERC20Upgradeable(aUSDC).allowance(user, address(this));
    }
    
    function getPendingExecutorChange() external view returns (address, uint256) {
        return (pendingExecutor, executorChangeTime);
    }
    
    function getVersion() external view returns (uint256) {
        return version;
    }

    receive() external payable {}
}

// ============ Interfaces ============

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface IGmxExchangeRouter {
    enum OrderType {
        MarketSwap,
        LimitSwap,
        MarketIncrease,
        LimitIncrease,
        MarketDecrease,
        LimitDecrease,
        StopLossDecrease,
        Liquidation
    }
    
    enum DecreasePositionSwapType {
        NoSwap,
        SwapPnlTokenToCollateralToken,
        SwapCollateralTokenToPnlToken
    }
    
    struct CreateOrderParamsAddresses {
        address receiver;
        address cancellationReceiver;
        address callbackContract;
        address uiFeeReceiver;
        address market;
        address initialCollateralToken;
        address[] swapPath;
    }
    
    struct CreateOrderParamsNumbers {
        uint256 sizeDeltaUsd;
        uint256 initialCollateralDeltaAmount;
        uint256 triggerPrice;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint256 callbackGasLimit;
        uint256 minOutputAmount;
        uint256 validFromTime;
    }
    
    struct CreateOrderParams {
        CreateOrderParamsAddresses addresses;
        CreateOrderParamsNumbers numbers;
        OrderType orderType;
        DecreasePositionSwapType decreasePositionSwapType;
        bool isLong;
        bool shouldUnwrapNativeToken;
        bool autoCancel;
        bytes32 referralCode;
    }
    
    function createOrder(CreateOrderParams calldata params) external payable returns (bytes32);
}

