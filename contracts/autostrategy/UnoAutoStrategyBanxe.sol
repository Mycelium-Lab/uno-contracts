// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "../interfaces/IUnoAssetRouter.sol";   
import '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract UnoAutoStrategyBanxe is Initializable, ERC20Upgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    /**
     * @dev PoolInfo:
     * {assetRouter} - UnoAssetRouter contract.
     * {pool} - Pool address. 
     */
    struct PoolInfo {
        address pool;
        IUnoAssetRouter assetRouter;
    }
    
    /**
     * @dev Contract Variables:
     * {banxe} - Banxe account that can make deposits to this autostrat.
     * {poolID} - Current pool the strategy uses ({pools} index).
     * {pools} - Pools this strategy can use and move liquidity to.

     * {tokenA} - Pool's first token address.
     * {tokenB} - Pool's second token address.

     * {reserveLP} - LP token reserve.
     * {MINIMUM_LIQUIDITY} - Ameliorates rounding errors.

     * {accessManager} - Role manager contract.
     */

    address public banxe;

    uint256 public poolID;
    PoolInfo[] public pools;

    IERC20Upgradeable public tokenA;
    IERC20Upgradeable public tokenB;

    uint256 private reserveLP;
    uint256 private constant MINIMUM_LIQUIDITY = 10**3;

    IUnoAccessManager public accessManager;
    bytes32 private constant LIQUIDITY_MANAGER_ROLE = keccak256('LIQUIDITY_MANAGER_ROLE');
    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');
    bytes32 private ADMIN_ROLE;

    event Deposit(uint256 indexed poolID, address indexed from, address indexed recipient, uint256 amountA, uint256 amountB);
    event Withdraw(uint256 indexed poolID, address indexed from, address indexed recipient, uint256 amountA, uint256 amountB);
    event MoveLiquidity(uint256 indexed previousPoolID, uint256 indexed nextPoolID);
    event BanxeTransferred(address indexed previousBanxe, address indexed newBanxe);

    modifier onlyRole(bytes32 role){
        require(accessManager.hasRole(role, msg.sender), 'CALLER_NOT_AUTHORIZED');
        _;
    }

    modifier onlyBanxe(){
        require(msg.sender == banxe, 'CALLER_NOT_BANXE');
        _;
    }

    // ============ Methods ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(PoolInfo[] calldata poolInfos, IUnoAccessManager _accessManager, address _banxe) external initializer {
        require ((poolInfos.length >= 2) && (poolInfos.length <= 50), 'BAD_POOL_COUNT');

        __ERC20_init("UNO-Banxe-AutoStrategy", "UNO-BANXE-LP");
        __ReentrancyGuard_init();
        __Pausable_init();

        address[] memory poolTokens = poolInfos[0].assetRouter.getTokens(poolInfos[0].pool);
        tokenA = IERC20Upgradeable(poolTokens[0]);
        tokenB = IERC20Upgradeable(poolTokens[1]);
        
        for (uint256 i = 0; i < poolInfos.length; i++) {
            PoolInfo memory poolInfo = poolInfos[i];
            if(i != 0){
                address[] memory _tokens = poolInfo.assetRouter.getTokens(poolInfo.pool);
                require(((_tokens[0] == address(tokenA)) && (_tokens[1] == address(tokenB))) || ((_tokens[0] == address(tokenB)) && (_tokens[1] == address(tokenA))), 'WRONG_POOL_TOKENS');
            }
            pools.push(poolInfo);

            tokenA.approve(address(poolInfo.assetRouter), type(uint256).max);
            tokenB.approve(address(poolInfo.assetRouter), type(uint256).max);
        }

        accessManager = _accessManager;
        ADMIN_ROLE = accessManager.ADMIN_ROLE();

        banxe = _banxe;
    }

    /**
     * @dev Deposits tokens in the pools[poolID] pool. Mints tokens representing user share. Emits {Deposit} event.
     * @param amountA - Token A amount to deposit.
     * @param amountB  - Token B amount to deposit.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     
     * @return sentA - Deposited token A amount.
     * @return sentB - Deposited token B amount.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function deposit(uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, address recipient) onlyBanxe whenNotPaused nonReentrant external returns (uint256 sentA, uint256 sentB, uint256 liquidity) {
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        (sentA, sentB,) = _deposit(amountA, amountB, amountAMin, amountBMin);
        liquidity = mint(recipient);

        tokenA.safeTransfer(msg.sender, amountA - sentA);
        tokenB.safeTransfer(msg.sender, amountB - sentB);

        emit Deposit(poolID, msg.sender, recipient, sentA, sentB); 
    }

    /**
     * @dev Withdraws tokens from the {pools[poolID]} pool and sends them to the recipient. Burns tokens representing user share. Emits {Withdraw} event.
     * @param liquidity - Liquidity to burn from this user.
     * @param amountAMin - The minimum amount of tokenA that must be received from the pool for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be received from the pool for the transaction not to revert.
     
     * @return amountA - Token A amount sent to the {recipient}.
     * @return amountB - Token B amount sent to the {recipient}.
     */
    function withdraw(uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address recipient) whenNotPaused nonReentrant external returns (uint256 amountA, uint256 amountB) {
        uint256 amountLP = burn(liquidity);
        (amountA, amountB) = _withdraw(amountLP, amountAMin, amountBMin, recipient);

        uint256 leftoverA = tokenA.balanceOf(address(this));
        if(leftoverA > 0){
            amountA += leftoverA;
            tokenA.safeTransfer(recipient, leftoverA);
        }

        uint256 leftoverB = tokenA.balanceOf(address(this));
        if(leftoverB > 0){
            amountB += leftoverB;
            tokenB.safeTransfer(recipient, leftoverB);
        }

        emit Withdraw(poolID, msg.sender, recipient, amountA, amountB);
    }

    /**
     * @dev Moves liquidity from {pools[poolID]} to {pools[_poolID]}. Emits {MoveLiquidity} event.
     * @param _poolID - Pool ID to move liquidity to.
     * @param amountAMin - The minimum amount of tokenA that must be deposited in {pools[_poolID]} for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be deposited in {pools[_poolID]} for the transaction not to revert.
     *
     * Note: This function can only be called by LiquidityManager.
     */
    function moveLiquidity(uint256 _poolID, uint256 amountAMin, uint256 amountBMin) whenNotPaused nonReentrant external {
        require(accessManager.hasRole(LIQUIDITY_MANAGER_ROLE, msg.sender), 'CALLER_NOT_LIQUIDITY_MANAGER');
        require(totalSupply() != 0, 'NO_LIQUIDITY');
        require((_poolID < pools.length) && (_poolID != poolID), 'BAD_POOL_ID');

        PoolInfo memory pool = pools[poolID];
        (uint256 _totalDeposits,,) = pool.assetRouter.userStake(address(this), pool.pool);
        _withdraw(_totalDeposits, amountAMin, amountBMin, address(this));

        emit MoveLiquidity(poolID, _poolID); 
        poolID = _poolID;
        (,,reserveLP) = _deposit(tokenA.balanceOf(address(this)), tokenB.balanceOf(address(this)), amountAMin, amountBMin);
    }

    /**
     * @dev Adds new pool to the strat.
     * @param poolInfo - New pool info to add.

     * Note: This function can only be called by Admin.
     */
    function addPool(PoolInfo calldata poolInfo) external onlyRole(ADMIN_ROLE) {
        address[] memory _tokens = poolInfo.assetRouter.getTokens(poolInfo.pool);
        require(((_tokens[0] == address(tokenA)) && (_tokens[1] == address(tokenB))) || ((_tokens[0] == address(tokenB)) && (_tokens[1] == address(tokenA))), 'WRONG_POOL_TOKENS');
        
        pools.push(poolInfo);
        require(pools.length <= 50, "TOO_MANY_POOLS");

        tokenA.approve(address(poolInfo.assetRouter), type(uint256).max);
        tokenB.approve(address(poolInfo.assetRouter), type(uint256).max);
    }

    /**
     * @dev Returns tokens staked by the {_address}. 
     * @param _address - The address to check stakes for.

     * @return stakeA - Token A stake.
     * @return stakeB - Token B stake.
     */
    function userStake(address _address) external view returns (uint256 stakeA, uint256 stakeB) {
        PoolInfo memory pool = pools[poolID];

        uint256 balanceA;
        uint256 balanceB;
        address[] memory _tokens = pool.assetRouter.getTokens(pool.pool);
        if(_tokens[0] == address(tokenA)){
            (, balanceA, balanceB) = pool.assetRouter.userStake(address(this), pool.pool);
        } else {
            (, balanceB, balanceA) = pool.assetRouter.userStake(address(this), pool.pool);
        }

        uint256 _balance = balanceOf(_address);
        if(_balance != 0){
            uint256 _totalSupply = totalSupply();
            uint256 leftoverA = tokenA.balanceOf(address(this));
            uint256 leftoverB = tokenB.balanceOf(address(this));

            stakeA = _balance * balanceA / _totalSupply + leftoverA;
            stakeB = _balance * balanceB / _totalSupply + leftoverB;
        }
    }
        
    /**
     * @dev Returns total amount locked in the pool. 
     * @return totalDepositsA - Token A deposits.
     * @return totalDepositsB - Token B deposits.
     */     
    function totalDeposits() external view returns(uint256 totalDepositsA, uint256 totalDepositsB){
        PoolInfo memory pool = pools[poolID];

        address[] memory _tokens = pool.assetRouter.getTokens(pool.pool);
        if(_tokens[0] == address(tokenA)){
            (, totalDepositsA, totalDepositsB) = pool.assetRouter.userStake(address(this), pool.pool);
        } else {
            (, totalDepositsB, totalDepositsA) = pool.assetRouter.userStake(address(this), pool.pool);
        }

        // Add leftover tokens.
        totalDepositsA += tokenA.balanceOf(address(this));
        totalDepositsB += tokenB.balanceOf(address(this));
    }

    /**
     * @dev Returns the number of pools in the strategy. 
     */
    function poolsLength() external view returns(uint256){
        return pools.length;
    }

    /**
     * @dev Returns pair of tokens currently in use. 
     */
    function tokens() external view returns(address, address){
        return (address(tokenA), address(tokenB));
    }

    function mint(address to) internal returns (uint256 liquidity){
        PoolInfo memory pool = pools[poolID];
        (uint256 balanceLP,,) = pool.assetRouter.userStake(address(this), pool.pool);
        uint256 amountLP = balanceLP - reserveLP;

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = amountLP - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            liquidity = amountLP * _totalSupply / reserveLP;
        }

        require(liquidity > 0, 'INSUFFICIENT_LIQUIDITY_MINTED');
        _mint(to, liquidity);

        reserveLP = balanceLP;
    }

    function burn(uint256 liquidity) internal returns (uint256 amountLP) {
        PoolInfo memory pool = pools[poolID];
        (uint256 balanceLP,,) = pool.assetRouter.userStake(address(this), pool.pool);

        amountLP = liquidity * balanceLP / totalSupply(); 
        require(amountLP > 0, 'INSUFFICIENT_LIQUIDITY_BURNED');
        _burn(msg.sender, liquidity);

        reserveLP = balanceLP - amountLP;
    }

    function _deposit(uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin) internal returns (uint256 sentA, uint256 sentB, uint256 liquidity){
        PoolInfo memory pool = pools[poolID];
        address[] memory _tokens = pool.assetRouter.getTokens(pool.pool);
        if(_tokens[0] == address(tokenA)){
            (sentA, sentB, liquidity) = pool.assetRouter.deposit(pool.pool, amountA, amountB, amountAMin, amountBMin, 0, address(this));
        } else {
            (sentB, sentA, liquidity) = pool.assetRouter.deposit(pool.pool, amountB, amountA, amountBMin, amountAMin, 0, address(this));
        }
    }

    function _withdraw(uint256 amountLP, uint256 amountAMin, uint256 amountBMin, address recipient) internal returns (uint256 amountA, uint256 amountB){
        PoolInfo memory pool = pools[poolID];
        address[] memory _tokens = pool.assetRouter.getTokens(pool.pool);
        if(_tokens[0] == address(tokenA)){
            (amountA, amountB) = pool.assetRouter.withdraw(pool.pool, amountLP, amountAMin, amountBMin, false, recipient);
        } else {
            (amountB, amountA) = pool.assetRouter.withdraw(pool.pool, amountLP, amountBMin, amountAMin, false, recipient);
        }
    }

    /**
     * @dev Transfers banxe rights of the contract to a new account (`_banxe`).
     * @param _banxe - Address to transfer banxe rights to.

     * Note: This function can only be called by Banxe.
     */
    function transferBanxe(address _banxe) external onlyBanxe {
        require(_banxe != address(0), "TRANSFER_TO_ZERO_ADDRESS");
        emit BanxeTransferred(banxe, _banxe);
        banxe = _banxe;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyRole(ADMIN_ROLE) {

    }
}