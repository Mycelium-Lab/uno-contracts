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
     * {tokenA} - Pool's first token address.
     * {tokenB} - Pool's second token address.
     */
    struct _PoolInfo {
        IUnoAssetRouter assetRouter;
        address pool;
    }

    struct PoolInfo {
        IUnoAssetRouter assetRouter;
        address pool;
        IERC20Upgradeable tokenA;
        IERC20Upgradeable tokenB;
    }

    /**
     * @dev MoveLiquidityInfo:
     * {leftoverA} - TokenA leftovers after MoveLiquidity() call.
     * {leftoverB} - TokenB leftovers after MoveLiquidity() call. 
     * {totalSupply} - totalSupply after MoveLiquidity() call.
     * {block} - MoveLiquidity() call block.
     */
    struct MoveLiquidityInfo {
        uint256 leftoverA;
        uint256 leftoverB;
        uint256 totalSupply;
        uint256 block;
    }
    
    /**
     * @dev inputToken, outputToken - structs used in OdosRouter contract.
     */
    struct inputToken {
      address tokenAddress;
      uint256 amountIn;
      address receiver;
      bytes permit;
    }

    struct outputToken {
      address tokenAddress;
      uint256 relativeValue;
      address receiver;
    }
    
    /**
     * @dev Contract Variables:
     * {OdosRouter} - Contract that executes swaps.

     * {poolID} - Current pool the strategy uses ({pools} index).
     * {pools} - Pools this strategy can use and move liquidity to.

     * {reserveLP} - LP token reserve.
     * {lastMoveInfo} - Info on last MoveLiquidity() block.
     * {blockedLiquidty} - User's blocked LP tokens. Prevents user from stealing leftover tokens by depositing and exiting before moveLiquidity() has been called.

     * {accessManager} - Role manager contract.
     * {factory} - The address of AutoStrategyFactory this contract was deployed by.

     * {MINIMUM_LIQUIDITY} - Ameliorates rounding errors.
     */

    address private constant OdosRouter = 0xa32EE1C40594249eb3183c10792BcF573D4Da47C;

    uint256 public poolID;
    PoolInfo[] public pools;

    uint256 private reserveLP;
    MoveLiquidityInfo private lastMoveInfo;
    mapping(address =>  mapping(uint256 => uint256)) private blockedLiquidty;

    IUnoAccessManager public accessManager;
    IUnoAutoStrategyFactory public factory;

    uint256 private constant MINIMUM_LIQUIDITY = 10**3;
    bytes32 private constant LIQUIDITY_MANAGER_ROLE = keccak256('LIQUIDITY_MANAGER_ROLE');

    event Deposit(uint256 indexed poolID, address indexed from, address indexed recipient, uint256 amountA, uint256 amountB);
    event Withdraw(uint256 indexed poolID, address indexed from, address indexed recipient, uint256 amountA, uint256 amountB);
    event MoveLiquidity(uint256 indexed previousPoolID, uint256 indexed nextPoolID);

    modifier whenNotPaused(){
        require(factory.paused() == false, 'PAUSABLE: PAUSED');
        _;
    }

    //TODO: ADD TOKENA TOKENB FETCH FUNCTION

    // ============ Methods ============

    function initialize(_PoolInfo[] calldata poolInfos, string calldata _name, string calldata _symbol, IUnoAccessManager _accessManager) external initializer {
        require (poolInfos.length >= 2, 'NOT_ENOUGH_POOLS_PROVIDED');
        
        for (uint256 i = 0; i < poolInfos.length; i++) {
            (address _tokenA, address _tokenB) = poolInfos[i].assetRouter.getTokens(poolInfos[i].pool);
            PoolInfo memory pool = PoolInfo({
                assetRouter: poolInfos[i].assetRouter,
                pool: poolInfos[i].pool,
                tokenA: IERC20Upgradeable(_tokenA),
                tokenB: IERC20Upgradeable(_tokenB)
            });
            pools.push(pool);

            if (pool.tokenA.allowance(address(this), address(pool.assetRouter)) == 0) {
                pool.tokenA.approve(OdosRouter, type(uint256).max);
                pool.tokenA.approve(address(pool.assetRouter), type(uint256).max);
            }
            if (pool.tokenB.allowance(address(this), address(pool.assetRouter)) == 0) {
                pool.tokenB.approve(OdosRouter, type(uint256).max);
                pool.tokenB.approve(address(pool.assetRouter), type(uint256).max);
            }
        }

        __ERC20_init(_name, _symbol);
        __ReentrancyGuard_init();
        accessManager = _accessManager;

        lastMoveInfo.block = block.number;
        factory = IUnoAutoStrategyFactory(msg.sender);
    }

    /**
     * @dev Deposits tokens in the pools[poolID] pool. Mints tokens representing user share. Emits {Deposit} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param amountA - Token A amount to deposit.
     * @param amountB  - Token B amount to deposit.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param recipient - Address which will recieve the deposit.
     
     * @return sentA - Deposited token A amount.
     * @return sentB - Deposited token B amount.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function deposit(uint256 pid, uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, address recipient) whenNotPaused nonReentrant external returns (uint256 sentA, uint256 sentB, uint256 liquidity) {
        require (pid == poolID, 'BAD_POOL_ID');
        PoolInfo memory pool = pools[poolID];

        pool.tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        pool.tokenB.safeTransferFrom(msg.sender, address(this), amountB);

        (sentA, sentB,) = pool.assetRouter.deposit(pool.pool, amountA, amountB, amountAMin, amountBMin, 0, address(this));
        liquidity = mint(recipient);

        pool.tokenA.safeTransfer(msg.sender, amountA - sentA);
        pool.tokenB.safeTransfer(msg.sender, amountB - sentB);

        emit Deposit(poolID, msg.sender, recipient, sentA, sentB); 
    }

    /**
     * @dev Withdraws tokens from the {pools[poolID]} pool and sends them to the recipient. Burns tokens representing user share. Emits {Withdraw} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param liquidity - Liquidity to burn from this user.
     * @param amountAMin - The minimum amount of tokenA that must be received for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be received for the transaction not to revert.
     * @param recipient - Address which will recieve withdrawn tokens.
     
     * @return amountA - Token A amount sent to the {recipient}.
     * @return amountB - Token B amount sent to the {recipient}.
     */
    function withdraw(uint256 pid, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address recipient) whenNotPaused nonReentrant external returns (uint256 amountA, uint256 amountB) {
        require (pid == poolID, 'BAD_POOL_ID');
        PoolInfo memory pool = pools[poolID];

        uint256 _leftoverA;
        uint256 _leftoverB;
        // Transfer lefover tokens to recipient.
        if((liquidity > blockedLiquidty[msg.sender][lastMoveInfo.block]) && (lastMoveInfo.totalSupply != 0)){
            uint256 leftoverLiquidity = liquidity - blockedLiquidty[msg.sender][lastMoveInfo.block];
            _leftoverA = leftoverLiquidity * lastMoveInfo.leftoverA / lastMoveInfo.totalSupply;
            _leftoverB = leftoverLiquidity * lastMoveInfo.leftoverB / lastMoveInfo.totalSupply;
            pool.tokenA.safeTransfer(recipient, _leftoverA);
            pool.tokenB.safeTransfer(recipient, _leftoverB);
        }

        uint256 amountLP = burn(liquidity);
        (amountA, amountB) = pool.assetRouter.withdraw(pool.pool, amountLP, amountAMin, amountBMin, false, recipient);

        amountA += _leftoverA;
        amountB += _leftoverB;

        emit Withdraw(poolID, msg.sender, recipient, amountA, amountB); 
    }

    /**
     * @dev Moves liquidity from {pools[poolID]} to {pools[_poolID]}. Emits {MoveLiquidity} event.
     * @param _poolID - Pool ID to move liquidity to.
     * @param swapAData - Data for tokenA swap.
     * @param swapBData - Data for tokenB swap.
     * @param amountAMin - The minimum amount of tokenA that must be deposited in {pools[_poolID]} for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be deposited in {pools[_poolID]} for the transaction not to revert.
     *
     * Note: This function can only be called by LiquidityManager.
     */
    function moveLiquidity(uint256 _poolID, bytes calldata swapAData, bytes calldata swapBData, uint256 amountAMin, uint256 amountBMin) whenNotPaused nonReentrant external {
        require(accessManager.hasRole(LIQUIDITY_MANAGER_ROLE, msg.sender), 'CALLER_NOT_LIQUIDITY_MANAGER');

        require(totalSupply() != 0, 'NO_LIQUIDITY');
        require(lastMoveInfo.block != block.number, 'CANT_CALL_ON_THE_SAME_BLOCK');
        require((_poolID < pools.length) && (_poolID != poolID), 'BAD_POOL_ID');

        PoolInfo memory currentPool = pools[poolID];
        PoolInfo memory newPool = pools[_poolID];

        (uint256 totalDeposits,,) = currentPool.assetRouter.userStake(address(this), currentPool.pool);
        currentPool.assetRouter.withdraw(currentPool.pool, totalDeposits, 0, 0, false, address(this));

        if(currentPool.tokenA != newPool.tokenA){
            (inputToken[] memory inputTokens, outputToken[] memory outputTokens,,,,) = abi.decode(swapAData[4:], (inputToken[],outputToken[],uint256,uint256,address,bytes));
            require((inputTokens.length == 1) && (outputTokens.length == 1), 'BAD_SWAP_A_TOKENS_LENGTH');
            require(inputTokens[0].tokenAddress == address(currentPool.tokenA), 'BAD_SWAP_A_INPUT_TOKEN');
            require(outputTokens[0].tokenAddress == address(newPool.tokenA), 'BAD_SWAP_A_OUTPUT_TOKEN');

            (bool success,) = OdosRouter.call(swapAData);
            require(success, 'SWAP_A_FAILED');
        }

        if(currentPool.tokenB != newPool.tokenB){
            (inputToken[] memory inputTokens, outputToken[] memory outputTokens,,,,) = abi.decode(swapBData[4:], (inputToken[],outputToken[],uint256,uint256,address,bytes));
            require((inputTokens.length == 1) && (outputTokens.length == 1), 'BAD_SWAP_B_TOKENS_LENGTH');
            require(inputTokens[0].tokenAddress == address(currentPool.tokenB), 'BAD_SWAP_B_INPUT_TOKEN');
            require(outputTokens[0].tokenAddress == address(newPool.tokenB), 'BAD_SWAP_B_OUTPUT_TOKEN');

            (bool success,) = OdosRouter.call(swapBData);
            require(success, 'SWAP_B_FAILED');
        }
        
        (,,reserveLP) = newPool.assetRouter.deposit(newPool.pool, newPool.tokenA.balanceOf(address(this)), newPool.tokenB.balanceOf(address(this)), amountAMin, amountBMin, 0, address(this));
       
        // Set variables for leftover token share calculations.
        lastMoveInfo = MoveLiquidityInfo({
            leftoverA: newPool.tokenA.balanceOf(address(this)),
            leftoverB: newPool.tokenB.balanceOf(address(this)),
            totalSupply: totalSupply(),
            block: block.number
        });

        emit MoveLiquidity(poolID, _poolID); 
        poolID = _poolID;
    }

    /**
     * @dev Returns tokens staked by the {_address}.
     * @param _address - The address to check stakes for.

     * @return stakeA - Token A stake.
     * @return stakeB - Token B stake.
     */
    function userStake(address _address) external view returns (uint256 stakeA, uint256 stakeB) {
        PoolInfo memory pool = pools[poolID];
        (, uint256 balanceA, uint256 balanceB) = pool.assetRouter.userStake(address(this), pool.pool);

        uint256 _balance = balanceOf(_address);
        if(_balance != 0){
            uint256 _totalSupply = totalSupply();
            stakeA = _balance * balanceA / _totalSupply; 
            stakeB = _balance * balanceB / _totalSupply; 
            // Add leftover tokens.
            if(lastMoveInfo.totalSupply != 0){
                stakeA += (_balance - blockedLiquidty[_address][lastMoveInfo.block]) * lastMoveInfo.leftoverA / lastMoveInfo.totalSupply;
                stakeB += (_balance - blockedLiquidty[_address][lastMoveInfo.block]) * lastMoveInfo.leftoverB / lastMoveInfo.totalSupply;
            }
        }
    }
        
    /**
     * @dev Returns total amount locked in the pool. 
     * @return totalDepositsA - Token A deposits.
     * @return totalDepositsB - Token B deposits.
     */     
    function getTotalDeposits() external view returns(uint256 totalDepositsA, uint256 totalDepositsB){
        PoolInfo memory pool = pools[poolID];
        (, totalDepositsA, totalDepositsB) = pool.assetRouter.userStake(address(this), pool.pool);

        // Add leftover tokens.
        totalDepositsA += pool.tokenA.balanceOf(address(this));
        totalDepositsB += pool.tokenB.balanceOf(address(this));
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

    function _beforeTokenTransfer(address from, address to, uint256 amount) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);

        // Decrease blockedLiquidty from {from} address, but no less then 0.
        if(amount > blockedLiquidty[from][lastMoveInfo.block]){
            blockedLiquidty[from][lastMoveInfo.block] = 0;
        } else {
            blockedLiquidty[from][lastMoveInfo.block] -= amount;
        }
        // Block {to} address from withdrawing their share of leftover tokens immediately.
        blockedLiquidty[to][lastMoveInfo.block] += amount;
    }
}