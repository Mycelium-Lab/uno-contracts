// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "../interfaces/IUnoAssetRouter.sol";   
import "../interfaces/IUnoAutoStrategyFactory.sol";  
import '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';

contract UnoAutoStrategy is Initializable, ERC20Upgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    /**
     * @dev PoolInfo:
     * {assetRouter} - UnoAssetRouter contract.
     * {pool} - Pool address. 
     */
    struct PoolInfo {
        IUnoAssetRouter assetRouter;
        address pool;
    }
    
    /**
     * @dev Contract Variables:
     * {tokenA, tokenB} - Token pair that the strategy uses.

     * {currentPoolID} - Current pool the strategy uses ({pools} index).
     * {pools} - Pools the strategy can use and move liquidity to.

     * {reserveLP} - LP token reserve.
     * {leftoverA, leftoverB} - Token leftovers at the {lastMoveLiquidity} block.
     * {lastMoveLiquidity} - Last moveLiquidity() call block.

     * {blockedLiquidty} - Prevents user from stealing leftover tokens by depositing and exiting before moveLiquidity() has occured.
     * {lastTotalSupply} - {totalSupply} at the {lastMoveLiquidity} block.

     * {accessManager} - Role manager contract.
     * {factory} - The address of AutoStrategyFactory this contract was deployed by.

     * {MINIMUM_LIQUIDITY} - Ameliorates rounding errors.
     */
    address public tokenA;
    address public tokenB;

    uint256 public currentPoolID;
    PoolInfo[] public pools;

    uint256 private reserveLP;
    uint256 private leftoverA;
    uint256 private leftoverB;
    uint256 private lastMoveLiquidity;

    mapping(address =>  mapping(uint256 => uint256)) private blockedLiquidty;
    uint256 private lastTotalSupply;

    IUnoAccessManager public accessManager;
    IUnoAutoStrategyFactory public factory;

    uint256 private constant MINIMUM_LIQUIDITY = 10**3;
    bytes32 private constant LIQUIDITY_MANAGER_ROLE = keccak256('LIQUIDITY_MANAGER_ROLE');

    event Deposit(address indexed from, address indexed recipient, uint256 amountA, uint256 amountB);
    event Withdraw(address indexed from, address indexed recipient, uint256 amountA, uint256 amountB);
    event MoveLiquidity(uint256 indexed previousPoolID, uint256 indexed newPoolID);

    modifier onlyLiquidityManager(){
        require(accessManager.hasRole(LIQUIDITY_MANAGER_ROLE, msg.sender), 'CALLER_NOT_LIQUIDITY_MANAGER');
        _;
    }

    modifier whenNotPaused(){
        require(factory.paused() == false, 'PAUSABLE: PAUSED');
        _;
    }

    // ============ Methods ============

    function initialize(PoolInfo[] calldata poolInfos, string calldata _name, string calldata _symbol, IUnoAccessManager _accessManager) external initializer {
        require (poolInfos.length >= 2, 'NOT_ENOUGH_POOLS_PROVIDED');
        (tokenA, tokenB) = poolInfos[0].assetRouter.getTokens(poolInfos[0].pool);
        
        for (uint256 i = 0; i < poolInfos.length; i++) {
            if (i != 0) {
                (address _tokenA, address _tokenB) = poolInfos[i].assetRouter.getTokens(poolInfos[i].pool);
                require(((_tokenA == tokenA) && (_tokenB == tokenB)) || ((_tokenA == tokenB) && (_tokenB == tokenA)), 'WRONG_POOL_TOKENS');
            }

            pools.push(poolInfos[i]);
            IERC20Upgradeable(tokenA).approve(address(poolInfos[i].assetRouter), type(uint256).max);
            IERC20Upgradeable(tokenB).approve(address(poolInfos[i].assetRouter), type(uint256).max);
        }

        __ERC20_init(_name, _symbol);
        __ReentrancyGuard_init();
        accessManager = _accessManager;

        lastMoveLiquidity = block.number;
        factory = IUnoAutoStrategyFactory(msg.sender);
    }

    /**
     * @dev Deposits tokens in the pools[currentPoolID] pool. Mints tokens representing user share. Emits {Deposit} event.
     * @param amountA - Token A amount to deposit.
     * @param amountB  - Token B amount to deposit.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param recipient - Address which will recieve the deposit.
     
     * @return sentA - Deposited token A amount.
     * @return sentB - Deposited token B amount.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function deposit(uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, address recipient) whenNotPaused nonReentrant external returns (uint256 sentA, uint256 sentB, uint256 liquidity) {
        require (amountA > 0 && amountB > 0, 'NO_LIQUIDITY_PROVIDED');

        IERC20Upgradeable(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20Upgradeable(tokenB).safeTransferFrom(msg.sender, address(this), amountB);

        (sentA, sentB,) = _deposit(amountA, amountB, amountAMin, amountBMin);
        liquidity = mint(recipient);

        IERC20Upgradeable(tokenA).safeTransfer(msg.sender, amountA - sentA);
        IERC20Upgradeable(tokenB).safeTransfer(msg.sender, amountB - sentB);

        emit Deposit(msg.sender, recipient, sentA, sentB); 
    }

    /**
     * @dev Withdraws tokens from the {pools[currentPoolID]} pool and sends them to the recipient. Burns tokens representing user share. Emits {Withdraw} event.
     * @param liquidity - Liquidity to burn from this user.
     * @param amountAMin - The minimum amount of tokenA that must be received for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be received for the transaction not to revert.
     * @param recipient - Address which will recieve withdrawn tokens.
     
     * @return amountA - Token A amount sent to the {recipient}.
     * @return amountB - Token B amount sent to the {recipient}.
     */
    function withdraw(uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address recipient) whenNotPaused nonReentrant external returns (uint256 amountA, uint256 amountB) {
        require((liquidity != 0) && (liquidity <= balanceOf(msg.sender)), 'INSUFFICIENT_LIQUIDITY');

        uint256 _leftoverA;
        uint256 _leftoverB;
        // Transfer lefover tokens to recipient.
        if((liquidity > blockedLiquidty[msg.sender][lastMoveLiquidity]) && (lastTotalSupply != 0)){
            uint256 leftoverLiquidity = liquidity - blockedLiquidty[msg.sender][lastMoveLiquidity];
            _leftoverA = leftoverLiquidity * leftoverA / lastTotalSupply;
            _leftoverB = leftoverLiquidity * leftoverB / lastTotalSupply;
            IERC20Upgradeable(tokenA).safeTransfer(recipient, _leftoverA);
            IERC20Upgradeable(tokenB).safeTransfer(recipient, _leftoverB);
        }

        uint256 amountLP = burn(liquidity);
        (amountA, amountB) = _withdraw(amountLP, amountAMin, amountBMin, recipient);

        amountA += _leftoverA;
        amountB += _leftoverB;

        emit Withdraw(msg.sender, recipient, amountA, amountB); 
    }

    /**
     * @dev Moves liquidity from {pools[currentPoolID]} to {pools[newPoolID]}. Emits {MoveLiquidity} event.
     * @param newPoolID - Pool ID to move liquidity to.
     * @param amountAMin - The minimum amount of tokenA that must be moved for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be moved for the transaction not to revert.
     */
    function moveLiquidity(uint256 newPoolID, uint256 amountAMin, uint256 amountBMin) whenNotPaused nonReentrant external onlyLiquidityManager {
        require(lastMoveLiquidity != block.number, 'CANT_CALL_ON_THE_SAME_BLOCK');
        require(totalSupply() != 0, 'NO_LIQUIDITY');
        require((newPoolID < pools.length) && (newPoolID != currentPoolID), 'BAD_POOL_ID');

        emit MoveLiquidity(currentPoolID, newPoolID); 

        PoolInfo memory pool = pools[currentPoolID];
        (uint256 totalDeposits,,) = pool.assetRouter.userStake(address(this), pool.pool);
        _withdraw(totalDeposits, amountAMin, amountBMin, address(this));
        
        currentPoolID = newPoolID;
        (,,reserveLP) = _deposit(IERC20Upgradeable(tokenA).balanceOf(address(this)), IERC20Upgradeable(tokenB).balanceOf(address(this)), amountAMin, amountBMin);

        // Set variables for leftover token share calculations.
        leftoverA = IERC20Upgradeable(tokenA).balanceOf(address(this));
        leftoverB = IERC20Upgradeable(tokenB).balanceOf(address(this));
        lastTotalSupply = totalSupply();
        lastMoveLiquidity = block.number;
    }

    /**
     * @dev Returns tokens staked by the {_address}.
     * @param _address - The address to check stakes for.

     * @return stakeA - Token A stake.
     * @return stakeB - Token B stake.
     */
    function userStake(address _address) external view returns (uint256 stakeA, uint256 stakeB) {
        PoolInfo memory pool = pools[currentPoolID];

        uint256 balanceA;
        uint256 balanceB;
        (address _tokenA,) = pool.assetRouter.getTokens(pool.pool);
        if(tokenA == _tokenA){
            (, balanceA, balanceB) = pool.assetRouter.userStake(address(this), pool.pool);
        }else{
            (, balanceB, balanceA) = pool.assetRouter.userStake(address(this), pool.pool);
        }

        uint256 _balance = balanceOf(_address);
        if(_balance != 0){
            uint256 _totalSupply = totalSupply();
            stakeA = _balance * balanceA / _totalSupply; 
            stakeB = _balance * balanceB / _totalSupply; 
            // Add leftover tokens.
            if(lastTotalSupply != 0){
                stakeA += (_balance - blockedLiquidty[_address][lastMoveLiquidity]) * leftoverA / lastTotalSupply;
                stakeB += (_balance - blockedLiquidty[_address][lastMoveLiquidity]) * leftoverB / lastTotalSupply;
            }
        }
    }
        
    /**
     * @dev Returns total amount locked in the pool. 
     * @return totalDepositsA - Token A deposits.
     * @return totalDepositsB - Token B deposits.
     */     
    function getTotalDeposits() external view returns(uint256 totalDepositsA, uint256 totalDepositsB){
        PoolInfo memory pool = pools[currentPoolID];

        (address _tokenA,) = pool.assetRouter.getTokens(pool.pool);
        if(tokenA == _tokenA){
            (, totalDepositsA, totalDepositsB) = pool.assetRouter.userStake(address(this), pool.pool);
        }else{
            (, totalDepositsB, totalDepositsA) = pool.assetRouter.userStake(address(this), pool.pool);
        }

        // Add leftover tokens.
        totalDepositsA += IERC20Upgradeable(tokenA).balanceOf(address(this));
        totalDepositsB += IERC20Upgradeable(tokenB).balanceOf(address(this));
    }

    function mint(address to) internal returns (uint256 liquidity){
        PoolInfo memory pool = pools[currentPoolID];
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
        PoolInfo memory pool = pools[currentPoolID];
        (uint256 balanceLP,,) = pool.assetRouter.userStake(address(this), pool.pool);

        amountLP = liquidity * balanceLP / totalSupply(); 
        require(amountLP > 0, 'INSUFFICIENT_LIQUIDITY_BURNED');
        _burn(msg.sender, liquidity);

        reserveLP = balanceLP - amountLP;
    }

    function _deposit(uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin) internal returns (uint256 sentA, uint256 sentB, uint256 liquidity){
        PoolInfo memory pool = pools[currentPoolID];
        (address _tokenA,) = pool.assetRouter.getTokens(pool.pool);
        if(tokenA == _tokenA){
            (sentA, sentB, liquidity) = pool.assetRouter.deposit(pool.pool, amountA, amountB, amountAMin, amountBMin, 0, address(this));
        } else {
            (sentB, sentA, liquidity) = pool.assetRouter.deposit(pool.pool, amountB, amountA, amountBMin, amountAMin, 0, address(this));
        }
    }

    function _withdraw(uint256 amountLP, uint256 amountAMin, uint256 amountBMin, address recipient) internal returns (uint256 amountA, uint256 amountB){
        PoolInfo memory pool = pools[currentPoolID];
        (address _tokenA,) = pool.assetRouter.getTokens(pool.pool);
        if(tokenA == _tokenA){
            (amountA, amountB) = pool.assetRouter.withdraw(pool.pool, amountLP, amountAMin, amountBMin, false, recipient);
        } else {
            (amountB, amountA) = pool.assetRouter.withdraw(pool.pool, amountLP, amountBMin, amountAMin, false, recipient);
        }
    }

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);

        // Decrease blockedLiquidty from {from} address, but no less then 0.
        if(amount > blockedLiquidty[from][lastMoveLiquidity]){
            blockedLiquidty[from][lastMoveLiquidity] = 0;
        } else {
            blockedLiquidty[from][lastMoveLiquidity] -= amount;
        }
        // Block {to} address from withdrawing their share of leftover tokens immediately.
        blockedLiquidty[to][lastMoveLiquidity] += amount;
    }
}