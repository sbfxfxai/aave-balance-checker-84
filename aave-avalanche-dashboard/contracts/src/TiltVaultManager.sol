// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TiltVault Manager
 * @notice Delegated position management for AAVE and GMX on Avalanche
 * @dev Users approve this contract to manage their positions without giving up custody
 * 
 * How it works:
 * 1. User approves USDC to this contract
 * 2. User calls authorizeManager() to allow TiltVault to execute on their behalf
 * 3. TiltVault backend calls depositToAave/withdrawFromAave/openGmxPosition etc.
 * 4. User can revoke access anytime with revokeAccess()
 */
contract TiltVaultManager is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    
    // Avalanche C-Chain addresses
    address public constant USDC = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E;
    address public constant WAVAX = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;
    
    // AAVE V3 on Avalanche
    address public constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address public constant aUSDC = 0x625E7708f30cA75bfd92586e17077590C60eb4cD; // aToken for USDC
    
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
    
    // ============ Events ============
    
    event UserAuthorized(address indexed user, uint256 timestamp);
    event UserRevoked(address indexed user, uint256 timestamp);
    event ManagerAuthorized(address indexed user, address indexed manager, uint256 timestamp);
    event ManagerRevoked(address indexed user, address indexed manager, uint256 timestamp);
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);
    
    event AaveDeposit(address indexed user, uint256 amount, uint256 timestamp);
    event AaveWithdraw(address indexed user, uint256 amount, uint256 timestamp);
    event GmxPositionOpened(address indexed user, uint256 collateral, uint256 leverage, uint256 timestamp);
    event GmxCollateralAdded(address indexed user, uint256 amount, uint256 timestamp);
    event GmxCollateralRemoved(address indexed user, uint256 amount, uint256 timestamp);
    event GmxPositionClosed(address indexed user, uint256 timestamp);

    // ============ Modifiers ============
    
    modifier onlyExecutor() {
        require(msg.sender == executor || msg.sender == owner(), "Not authorized executor");
        _;
    }
    
    modifier onlyAuthorizedFor(address user) {
        require(
            isAuthorized[user] && (msg.sender == executor || msg.sender == owner() || authorizedManagers[user][msg.sender]),
            "Not authorized for this user"
        );
        _;
    }

    // ============ Constructor ============
    
    constructor(address _executor) Ownable(msg.sender) {
        require(_executor != address(0), "Invalid executor address");
        executor = _executor;
        
        // Approve AAVE Pool to spend USDC
        IERC20(USDC).approve(AAVE_POOL, type(uint256).max);
        
        // Approve GMX Router to spend USDC
        IERC20(USDC).approve(GMX_ROUTER, type(uint256).max);
    }

    // ============ User Authorization Functions ============
    
    /**
     * @notice Authorize TiltVault to manage positions on your behalf
     * @dev User must first approve USDC to this contract
     */
    function authorizeManager() external {
        isAuthorized[msg.sender] = true;
        emit UserAuthorized(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Revoke TiltVault's access to manage your positions
     * @dev This immediately stops all future operations
     */
    function revokeAccess() external {
        isAuthorized[msg.sender] = false;
        emit UserRevoked(msg.sender, block.timestamp);
    }
    
    /**
     * @notice Authorize a specific address to manage your positions
     * @param manager Address to authorize
     */
    function authorizeSpecificManager(address manager) external {
        require(manager != address(0), "Invalid manager address");
        authorizedManagers[msg.sender][manager] = true;
        emit ManagerAuthorized(msg.sender, manager, block.timestamp);
    }
    
    /**
     * @notice Revoke a specific manager's access
     * @param manager Address to revoke
     */
    function revokeSpecificManager(address manager) external {
        authorizedManagers[msg.sender][manager] = false;
        emit ManagerRevoked(msg.sender, manager, block.timestamp);
    }
    
    /**
     * @notice Check if an address is authorized to manage a user's positions
     * @param user User address
     * @param manager Manager address to check
     */
    function isManagerAuthorized(address user, address manager) external view returns (bool) {
        return isAuthorized[user] && (manager == executor || manager == owner() || authorizedManagers[user][manager]);
    }

    // ============ AAVE Functions ============
    
    /**
     * @notice Deposit USDC to AAVE on behalf of a user
     * @param user User's wallet address
     * @param amount Amount of USDC to deposit (6 decimals)
     */
    function depositToAave(address user, uint256 amount) external nonReentrant onlyAuthorizedFor(user) {
        require(amount > 0, "Amount must be greater than 0");
        
        // Transfer USDC from user to this contract
        IERC20(USDC).safeTransferFrom(user, address(this), amount);
        
        // Deposit to AAVE Pool - aTokens go directly to user
        IAavePool(AAVE_POOL).supply(USDC, amount, user, 0);
        
        emit AaveDeposit(user, amount, block.timestamp);
    }
    
    /**
     * @notice Withdraw USDC from AAVE on behalf of a user
     * @param user User's wallet address
     * @param amount Amount of USDC to withdraw (6 decimals), use type(uint256).max for all
     */
    function withdrawFromAave(address user, uint256 amount) external nonReentrant onlyAuthorizedFor(user) {
        require(amount > 0, "Amount must be greater than 0");
        
        // User must have approved aUSDC to this contract
        // Transfer aTokens from user to this contract
        uint256 aTokenBalance = IERC20(aUSDC).balanceOf(user);
        uint256 withdrawAmount = amount == type(uint256).max ? aTokenBalance : amount;
        
        IERC20(aUSDC).safeTransferFrom(user, address(this), withdrawAmount);
        
        // Withdraw from AAVE Pool - USDC goes directly to user
        IAavePool(AAVE_POOL).withdraw(USDC, withdrawAmount, user);
        
        emit AaveWithdraw(user, withdrawAmount, block.timestamp);
    }

    // ============ GMX Functions ============
    
    /**
     * @notice Open a GMX long position on behalf of a user
     * @param user User's wallet address
     * @param collateralAmount Amount of USDC collateral (6 decimals)
     * @param sizeDeltaUsd Position size in USD (30 decimals for GMX)
     * @param executionFee AVAX execution fee for GMX keeper
     */
    function openGmxPosition(
        address user,
        uint256 collateralAmount,
        uint256 sizeDeltaUsd,
        uint256 executionFee
    ) external payable nonReentrant onlyAuthorizedFor(user) {
        require(collateralAmount > 0, "Collateral must be greater than 0");
        require(sizeDeltaUsd > 0, "Size must be greater than 0");
        require(msg.value >= executionFee, "Insufficient execution fee");
        
        // Transfer USDC from user to this contract
        IERC20(USDC).safeTransferFrom(user, address(this), collateralAmount);
        
        // Transfer USDC to GMX Order Vault
        IERC20(USDC).safeTransfer(GMX_ORDER_VAULT, collateralAmount);
        
        // Create increase order via GMX Exchange Router
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
                acceptablePrice: type(uint256).max, // Market order
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
    
    /**
     * @notice Add collateral to an existing GMX position
     * @param user User's wallet address
     * @param amount Amount of USDC to add (6 decimals)
     * @param executionFee AVAX execution fee for GMX keeper
     */
    function addGmxCollateral(
        address user,
        uint256 amount,
        uint256 executionFee
    ) external payable nonReentrant onlyAuthorizedFor(user) {
        require(amount > 0, "Amount must be greater than 0");
        require(msg.value >= executionFee, "Insufficient execution fee");
        
        // Transfer USDC from user to GMX Order Vault
        IERC20(USDC).safeTransferFrom(user, GMX_ORDER_VAULT, amount);
        
        // Create increase order with 0 size delta (collateral only)
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
                sizeDeltaUsd: 0, // No size change, just collateral
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
    
    /**
     * @notice Remove collateral from an existing GMX position
     * @param user User's wallet address
     * @param amount Amount of USDC to remove (6 decimals)
     * @param executionFee AVAX execution fee for GMX keeper
     */
    function removeGmxCollateral(
        address user,
        uint256 amount,
        uint256 executionFee
    ) external payable nonReentrant onlyAuthorizedFor(user) {
        require(amount > 0, "Amount must be greater than 0");
        require(msg.value >= executionFee, "Insufficient execution fee");
        
        // Create decrease order with 0 size delta (collateral only)
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
                sizeDeltaUsd: 0, // No size change, just collateral
                initialCollateralDeltaAmount: amount,
                triggerPrice: 0,
                acceptablePrice: 0, // For decrease, 0 is acceptable
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
    
    /**
     * @notice Close a GMX position entirely
     * @param user User's wallet address
     * @param sizeDeltaUsd Size to close in USD (30 decimals), use max for full close
     * @param executionFee AVAX execution fee for GMX keeper
     */
    function closeGmxPosition(
        address user,
        uint256 sizeDeltaUsd,
        uint256 executionFee
    ) external payable nonReentrant onlyAuthorizedFor(user) {
        require(msg.value >= executionFee, "Insufficient execution fee");
        
        // Create decrease order to close position
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
                initialCollateralDeltaAmount: 0, // Withdraw all collateral
                triggerPrice: 0,
                acceptablePrice: 0, // For decrease, 0 is acceptable
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
    
    /**
     * @notice Update the executor address
     * @param newExecutor New executor address
     */
    function setExecutor(address newExecutor) external onlyOwner {
        require(newExecutor != address(0), "Invalid executor address");
        address oldExecutor = executor;
        executor = newExecutor;
        emit ExecutorUpdated(oldExecutor, newExecutor);
    }
    
    /**
     * @notice Emergency withdraw stuck tokens
     * @param token Token address
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        IERC20(token).safeTransfer(to, amount);
    }
    
    /**
     * @notice Emergency withdraw stuck AVAX
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdrawAvax(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid recipient");
        (bool success, ) = to.call{value: amount}("");
        require(success, "AVAX transfer failed");
    }

    // ============ View Functions ============
    
    /**
     * @notice Check if a user has authorized TiltVault
     * @param user User address
     */
    function checkAuthorization(address user) external view returns (bool) {
        return isAuthorized[user];
    }
    
    /**
     * @notice Get user's USDC allowance to this contract
     * @param user User address
     */
    function getUserAllowance(address user) external view returns (uint256) {
        return IERC20(USDC).allowance(user, address(this));
    }
    
    /**
     * @notice Get user's aUSDC allowance to this contract (for withdrawals)
     * @param user User address
     */
    function getUserATokenAllowance(address user) external view returns (uint256) {
        return IERC20(aUSDC).allowance(user, address(this));
    }

    // Allow contract to receive AVAX for execution fees
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
