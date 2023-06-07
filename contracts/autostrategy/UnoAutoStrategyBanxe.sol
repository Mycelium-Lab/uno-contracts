// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "../interfaces/IOdosRouter.sol";
import "../interfaces/IUnoAssetRouter.sol";   
import "../interfaces/IUnoAutoStrategyFactory.sol";
import "../interfaces/IAggregationRouterV5.sol";
import '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

contract UnoAutoStrategyBanxe is Initializable, ERC20Upgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;
    /**
     * @dev PoolInfo:
     * {assetRouter} - UnoAssetRouter contract.
     * {pool} - Pool address. 
     * {tokenA} - Pool's first token address.
     * {tokenB} - Pool's second token address.
     */
    struct _PoolInfo {
        address pool;
        IUnoAssetRouter assetRouter;
    }

    struct PoolInfo {
        address pool;
        IUnoAssetRouter assetRouter;
        IERC20 tokenA;
        IERC20 tokenB;
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
     * @dev Contract Variables:
     * banxe - Banxe account that can make deposits to autostrats.
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

    address public banxe;
    IOdosRouter private constant OdosRouter = IOdosRouter(0xa32EE1C40594249eb3183c10792BcF573D4Da47C);

    uint256 public poolID;
    PoolInfo[] public pools;

    uint256 private reserveLP;
    MoveLiquidityInfo private lastMoveInfo;
    mapping(address => mapping(uint256 => uint256)) private blockedLiquidty;
    mapping(address => mapping(uint256 => bool)) private leftoversCollected;

    IUnoAccessManager public accessManager;
    IUnoAutoStrategyFactory public factory;

    uint256 private constant MINIMUM_LIQUIDITY = 10**3;
    bytes32 private constant LIQUIDITY_MANAGER_ROLE = keccak256('LIQUIDITY_MANAGER_ROLE');
    address public constant WMATIC = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;

    event DepositPairTokens(uint256 indexed poolID, uint256 amountA, uint256 amountB);
    event DepositPairTokensETH(uint256 indexed poolID, uint256 amountToken, uint256 amountETH);
    event DepositTokensWithSwap(uint256 indexed poolID, IERC20 indexed token0, IERC20 indexed token1, uint256 sent0, uint256 sent1);
    // Note: amountLP refers to LP tokens used in farms and staking pools, not UNO-LP this contract is.
    // To get info for UNO-LP use mint/burn events
    event Deposit(uint256 indexed poolID, address indexed from, address indexed recipient, uint256 amountLP);

    event WithdrawPairTokens(uint256 indexed poolID, uint256 amountA, uint256 amountB);
    event WithdrawPairTokensETH(uint256 indexed poolID, uint256 amountToken, uint256 amountETH);
    event WithdrawTokensWithSwap(uint256 indexed poolID, IERC20 indexed token0, IERC20 indexed token1, uint256 amount0, uint256 amount1, uint256 amountA, uint256 amountB);
    // Note: amountLP refers to LP tokens used in farms and staking pools, not UNO-LP this contract is.
    // To get info for UNO-LP use mint/burn events
    event Withdraw(uint256 indexed poolID, address indexed from, address indexed recipient, uint256 amountLP);

    event MoveLiquidity(uint256 indexed previousPoolID, uint256 indexed nextPoolID);
    event BanxeTransferred(address indexed previousBanxe, address indexed newBanxe);

    //To save contract size
    error PAUSED();
    error BAD_POOL_ID();
    error BAD_POOL_COUNT();
    error CALLER_NOT_LIQUIDITY_MANAGER();
    error CALLER_NOT_BANXE();
    error NO_LIQUIDITY();
    error CANT_CALL_ON_THE_SAME_BLOCK();
    error BAD_SWAP_A();
    error BAD_SWAP_B();
    error INSUFFICIENT_LIQUIDITY();
    error NOT_ETH_POOL();
    error TRANSFER_NOT_SUCCESSFUL();
    error ETH_DEPOSIT_REJECTED();
    error INVALID_BANXE();

    modifier whenNotPaused(){
        if(factory.paused()) revert PAUSED();
        _;
    }

    modifier onlyBanxe(){
        if(msg.sender != banxe && !accessManager.hasRole(0x00, msg.sender)) revert CALLER_NOT_BANXE();
        _;
    }

    // ============ Methods ============
    
    receive() external payable {
        //Reject deposits from EOA
        if (msg.sender == tx.origin) revert ETH_DEPOSIT_REJECTED();
    }

    function initialize(_PoolInfo[] calldata poolInfos, IUnoAccessManager _accessManager, address _banxe) external initializer {
        if(_banxe == address(0)) revert INVALID_BANXE();
        if((poolInfos.length < 2) || (poolInfos.length > 50)) revert BAD_POOL_COUNT();

        __ERC20_init("UNO-Banxe-AutoStrategy", "UNO-BANXE-LP");
        __ReentrancyGuard_init();
        
        for (uint256 i = 0; i < poolInfos.length; i++) {
            IERC20[] memory _tokens = IUnoAssetRouter(poolInfos[i].assetRouter).getTokens(poolInfos[i].pool);
            PoolInfo memory pool = PoolInfo({
                pool: poolInfos[i].pool,
                assetRouter: poolInfos[i].assetRouter,
                tokenA: _tokens[0],
                tokenB: _tokens[1]
            });
            pools.push(pool);
        }

        banxe = _banxe;
        emit BanxeTransferred(address(0), _banxe);

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
     * @param recipient - Address which will receive the deposit.
     
     * @return sentA - Deposited token A amount.
     * @return sentB - Deposited token B amount.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function deposit(uint256 pid, uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, address recipient) onlyBanxe whenNotPaused nonReentrant external returns (uint256 sentA, uint256 sentB, uint256 liquidity) {
        if(pid != poolID) revert BAD_POOL_ID();
        PoolInfo memory pool = pools[poolID];

        pool.tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        pool.tokenA.approve(address(pool.assetRouter), amountA);

        pool.tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        pool.tokenB.approve(address(pool.assetRouter), amountB);

        uint256 amountLP;
        (sentA, sentB, amountLP) = pool.assetRouter.deposit(pool.pool, amountA, amountB, amountAMin, amountBMin, address(this));
        liquidity = mint(recipient);

        if(amountA > sentA){
            pool.tokenA.safeTransfer(msg.sender, amountA - sentA);
        }
        if(amountB > sentB){
            pool.tokenB.safeTransfer(msg.sender, amountB - sentB);
        }

        emit DepositPairTokens(poolID, sentA, sentB);
        emit Deposit(poolID, msg.sender, recipient, amountLP); 
    }

    /**
     * @dev Deposits tokens in the pools[poolID] pool. Mints tokens representing user share. Emits {Deposit} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param amountToken - Token amount to deposit.
     * @param amountTokenMin - Bounds the extent to which the TOKEN/WMATIC price can go up before the transaction reverts.
     * @param amountETHMin - Bounds the extent to which the WMATIC/TOKEN price can go up before the transaction reverts.
     * @param recipient - Address which will receive the deposit.
     
     * @return sentToken - Deposited token amount.
     * @return sentETH - Deposited ETH amount.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function depositETH(uint256 pid, uint256 amountToken, uint256 amountTokenMin, uint256 amountETHMin, address recipient) onlyBanxe whenNotPaused nonReentrant external payable returns (uint256 sentToken, uint256 sentETH, uint256 liquidity) {
        if(pid != poolID) revert BAD_POOL_ID();
        PoolInfo memory pool = pools[poolID];

        IERC20 token;
        if (address(pool.tokenA) == WMATIC) {
            token = pool.tokenB;
        } else if (address(pool.tokenB) == WMATIC) {
            token = pool.tokenA;
        } else revert NOT_ETH_POOL();

        token.safeTransferFrom(msg.sender, address(this), amountToken);
        token.approve(address(pool.assetRouter), amountToken);

        uint256 amountLP;
        (sentToken, sentETH, amountLP) = pool.assetRouter.depositETH{value: msg.value}(pool.pool, amountToken, amountTokenMin, amountETHMin, address(this));
        liquidity = mint(recipient);

        if(amountToken > sentToken){
            token.safeTransfer(msg.sender, amountToken - sentToken);
        }
        if(msg.value > sentETH){
            payable(msg.sender).transfer(msg.value - sentETH);
        }

        emit DepositPairTokensETH(poolID, sentToken, sentETH);
        emit Deposit(poolID, msg.sender, recipient, amountLP); 
    }

    /**
     * @dev Deposits tokens in the pools[poolID] pool. Mints tokens representing user share. Emits {Deposit} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param recipient - Address which will receive the deposit.
     
     * @return sent0 - Tokens sent to the farm from the {swapData[0]}.
     * @return sent1 - Tokens sent to the farm from the {swapData[1]}.
     * @return dustA - {pool.tokenA} dust sent to the {msg.sender}.
     * @return dustB - {pool.tokenB} dust sent to the {msg.sender}.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function depositWithSwap(uint256 pid, bytes[2] calldata swapData, address recipient) whenNotPaused nonReentrant payable external returns (uint256 sent0, uint256 sent1, uint256 dustA, uint256 dustB, uint256 liquidity) {
        if(pid != poolID) revert BAD_POOL_ID();
        PoolInfo memory pool = pools[poolID];

        _transferSwapTokens(address(pool.assetRouter), swapData[0]);
        _transferSwapTokens(address(pool.assetRouter), swapData[1]);

        uint256 amountLP;
        (sent0, sent1, dustA, dustB, amountLP) = pool.assetRouter.depositWithSwap{value: msg.value}(pool.pool, swapData, address(this));
        liquidity = mint(recipient);

        pool.tokenA.safeTransfer(msg.sender, dustA);
        pool.tokenB.safeTransfer(msg.sender, dustB);

        (IERC20 token0, uint256 amount0) = _getSwapParams(swapData[0]);//Could have done it in _transferSwapTokens to save gas, but can't because of Stack too deep error
        (IERC20 token1, uint256 amount1) = _getSwapParams(swapData[1]);//Could have done it in _transferSwapTokens to save gas, but can't because of Stack too deep error

        if(amount0 > sent0){
            if(_isETH(token0)){
                (bool success, ) = msg.sender.call{value: amount0 - sent0}("");
                if(!success) revert TRANSFER_NOT_SUCCESSFUL();
            }else{
                token0.safeTransfer(msg.sender, amount0 - sent0);
            }
        }
        if(amount1 > sent1){
            if(_isETH(token1)){
                (bool success, ) = msg.sender.call{value: amount1 - sent1}("");
                if(!success) revert TRANSFER_NOT_SUCCESSFUL();
            }else{
                token1.safeTransfer(msg.sender, amount1 - sent1);
            }
        }

        emit DepositTokensWithSwap(poolID, token0, token1, sent0, sent1);
        emit Deposit(poolID, msg.sender, recipient, amountLP);
    }

    /**
     * @dev Withdraws tokens from the {pools[poolID]} pool and sends them to the recipient. Burns tokens representing user share. Emits {Withdraw} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param liquidity - Liquidity to burn from this user.
     * @param amountAMin - The minimum amount of tokenA that must be received from the pool for the transaction not to revert.
     * @param amountBMin - The minimum amount of tokenB that must be received from the pool for the transaction not to revert.
     * @param recipient - Address which will receive withdrawn tokens.
     
     * @return amountA - Token A amount sent to the {recipient}.
     * @return amountB - Token B amount sent to the {recipient}.
     */
    function withdraw(uint256 pid, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address recipient) whenNotPaused nonReentrant external returns (uint256 amountA, uint256 amountB) {
        if(pid != poolID) revert BAD_POOL_ID();
        PoolInfo memory pool = pools[poolID];

        (uint256 leftoverA, uint256 leftoverB) = collectLeftovers(liquidity, recipient);

        uint256 amountLP = burn(liquidity);
        (amountA, amountB) = pool.assetRouter.withdraw(pool.pool, amountLP, amountAMin, amountBMin, recipient);

        amountA += leftoverA;
        amountB += leftoverB;

        emit WithdrawPairTokens(poolID, amountA, amountB);
        emit Withdraw(poolID, msg.sender, recipient, amountLP);
    }

    /**
     * @dev Withdraws tokens from the {pools[poolID]} pool and sends them to the recipient. Burns tokens representing user share. Emits {Withdraw} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param liquidity - Liquidity to burn from this user.
     * @param amountTokenMin - The minimum amount of tokenA that must be received from the pool for the transaction not to revert.
     * @param amountETHMin - The minimum amount of tokenB that must be received from the pool for the transaction not to revert.
     * @param recipient - Address which will receive withdrawn tokens.
     
     * @return amountToken - Token amount sent to the {recipient}.
     * @return amountETH - MATIC amount sent to the {recipient}.
     */
    function withdrawETH(uint256 pid, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address recipient) whenNotPaused nonReentrant external returns (uint256 amountToken, uint256 amountETH) {
        if(pid != poolID) revert BAD_POOL_ID();
        PoolInfo memory pool = pools[poolID];

        (uint256 leftoverA, uint256 leftoverB) = collectLeftovers(liquidity, recipient);

        uint256 amountLP = burn(liquidity);
        (amountToken, amountETH) = pool.assetRouter.withdrawETH(pool.pool, amountLP, amountTokenMin, amountETHMin, recipient);

        if (address(pool.tokenA) == WMATIC) {
            amountETH += leftoverA;
            amountToken += leftoverB;
        } else if (address(pool.tokenB) == WMATIC) {
            amountToken += leftoverA;
            amountETH += leftoverB;
        } else revert NOT_ETH_POOL();
        
        emit WithdrawPairTokensETH(poolID, amountToken, amountETH);
        emit Withdraw(poolID, msg.sender, recipient, amountLP); 
    }

    /**
     * @dev Withdraws tokens from the {pools[poolID]} pool and sends them to the recipient. Burns tokens representing user share. Emits {Withdraw} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param liquidity - Liquidity to burn from this user.
     * @param swapData - Parameter with which 1inch router is being called with.
     * @param recipient - Address which will receive withdrawn tokens.
     
     * @return amount0 - Amount sent to the {recipient} from swapData[0].
     * @return amount1 - Amount sent to the {recipient} from swapData[1].
     * @return amountA - Token A dust sent to the {recipient}.
     * @return amountB - Token B dust sent to the {recipient}.
     */
    function withdrawWithSwap(uint256 pid, uint256 liquidity, bytes[2] calldata swapData, address recipient) whenNotPaused nonReentrant external returns (uint256 amount0, uint256 amount1, uint256 amountA, uint256 amountB) {
        if(pid != poolID) revert BAD_POOL_ID();
        PoolInfo memory pool = pools[poolID];

        (uint256 leftoverA, uint256 leftoverB) = collectLeftovers(liquidity, recipient);

        uint256 amountLP = burn(liquidity);
        (amount0, amount1, amountA, amountB) = pool.assetRouter.withdrawWithSwap(pool.pool, amountLP, swapData, recipient);

        amountA += leftoverA;
        amountB += leftoverB;

        emit WithdrawTokensWithSwap(poolID, _getSwapDstToken(swapData[0]), _getSwapDstToken(swapData[1]), amount0, amount1, amountA, amountB);
        emit Withdraw(poolID, msg.sender, recipient, amountLP); 
    }

    /**
     * @dev Collects leftover tokens left from moveLiquidity() function.
     * @param recipient - Address which will receive leftover tokens.
     
     * @return leftoverA - Token A amount sent to the {recipient}.
     * @return leftoverB - Token B amount sent to the {recipient}.
     */
    function collectLeftovers(uint256 liquidity, address recipient) internal returns (uint256 leftoverA, uint256 leftoverB){
        uint256 availiableLiquidity = balanceOf(msg.sender) - blockedLiquidty[msg.sender][lastMoveInfo.block];
        if(availiableLiquidity == 0){
            return (0, 0);
        }
        if(liquidity > availiableLiquidity){
            liquidity = availiableLiquidity;
        }

        if(lastMoveInfo.totalSupply != 0){
            PoolInfo memory pool = pools[poolID];
            leftoverA = liquidity * lastMoveInfo.leftoverA / lastMoveInfo.totalSupply;
            leftoverB = liquidity * lastMoveInfo.leftoverB / lastMoveInfo.totalSupply;
            if(leftoverA > 0){
                pool.tokenA.safeTransfer(recipient, leftoverA);
            }
            if(leftoverB > 0){
                pool.tokenB.safeTransfer(recipient, leftoverB);
            }
        }
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
        if(!accessManager.hasRole(LIQUIDITY_MANAGER_ROLE, msg.sender)) revert CALLER_NOT_LIQUIDITY_MANAGER();
        if(totalSupply() == 0) revert NO_LIQUIDITY();
        if(lastMoveInfo.block == block.number) revert CANT_CALL_ON_THE_SAME_BLOCK();
        if((_poolID >= pools.length) || (_poolID == poolID)) revert BAD_POOL_ID();

        PoolInfo memory currentPool = pools[poolID];
        PoolInfo memory newPool = pools[_poolID];

        (uint256 _totalDeposits,,) = currentPool.assetRouter.userStake(address(this), currentPool.pool);
        currentPool.assetRouter.withdraw(currentPool.pool, _totalDeposits, 0, 0, address(this));

        uint256 tokenABalance = currentPool.tokenA.balanceOf(address(this));
        uint256 tokenBBalance = currentPool.tokenB.balanceOf(address(this));

        if(currentPool.tokenA != newPool.tokenA){
            (
                IOdosRouter.inputToken[] memory inputs, 
                IOdosRouter.outputToken[] memory outputs, 
                ,
                uint256 valueOutMin,
                address executor,
                bytes memory pathDefinition
            ) = abi.decode(swapAData[4:], (IOdosRouter.inputToken[],IOdosRouter.outputToken[],uint256,uint256,address,bytes));

            // More descriptive errors would be nice but our contract size is very limited
            if(
                ((inputs.length != 1) || (outputs.length != 1)) ||
                (inputs[0].tokenAddress != address(currentPool.tokenA)) ||
                (outputs[0].tokenAddress != address(newPool.tokenA))
            ) revert BAD_SWAP_A();

            inputs[0].amountIn = tokenABalance;
            currentPool.tokenA.approve(address(OdosRouter), tokenABalance);
            OdosRouter.swap(inputs, outputs, type(uint256).max, valueOutMin, executor, pathDefinition);
        }

        if(currentPool.tokenB != newPool.tokenB){
            (
                IOdosRouter.inputToken[] memory inputs,
                IOdosRouter.outputToken[] memory outputs,
                ,
                uint256 valueOutMin,
                address executor,
                bytes memory pathDefinition
            ) = abi.decode(swapBData[4:], (IOdosRouter.inputToken[],IOdosRouter.outputToken[],uint256,uint256,address,bytes));

            // More descriptive errors would be nice but our contract size is very limited
            if(
                ((inputs.length != 1) || (outputs.length != 1)) ||
                (inputs[0].tokenAddress != address(currentPool.tokenB)) ||
                (outputs[0].tokenAddress != address(newPool.tokenB))
            ) revert BAD_SWAP_B();

            inputs[0].amountIn = tokenBBalance;
            currentPool.tokenB.approve(address(OdosRouter), tokenBBalance);
            OdosRouter.swap(inputs, outputs, type(uint256).max, valueOutMin, executor, pathDefinition);
        }

        uint256 newTokenABalance = newPool.tokenA.balanceOf(address(this));
        uint256 newTokenBBalance = newPool.tokenB.balanceOf(address(this));
        
        newPool.tokenB.approve(address(newPool.assetRouter), newTokenBBalance);
        newPool.tokenA.approve(address(newPool.assetRouter), newTokenABalance);
        (,,reserveLP) = newPool.assetRouter.deposit(newPool.pool, newTokenABalance, newTokenBBalance, amountAMin, amountBMin, address(this));
       
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
    function totalDeposits() external view returns(uint256 totalDepositsA, uint256 totalDepositsB){
        PoolInfo memory pool = pools[poolID];
        (, totalDepositsA, totalDepositsB) = pool.assetRouter.userStake(address(this), pool.pool);

        // Add leftover tokens.
        totalDepositsA += pool.tokenA.balanceOf(address(this));
        totalDepositsB += pool.tokenB.balanceOf(address(this));
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
        PoolInfo memory pool = pools[poolID];
        return (address(pool.tokenA), address(pool.tokenB));
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

        if(liquidity == 0) revert INSUFFICIENT_LIQUIDITY();
        _mint(to, liquidity);

        reserveLP = balanceLP;
    }

    function burn(uint256 liquidity) internal returns (uint256 amountLP) {
        PoolInfo memory pool = pools[poolID];
        (uint256 balanceLP,,) = pool.assetRouter.userStake(address(this), pool.pool);

        amountLP = liquidity * balanceLP / totalSupply(); 
        if(amountLP == 0) revert INSUFFICIENT_LIQUIDITY();
        _burn(msg.sender, liquidity);

        reserveLP = balanceLP - amountLP;
    }

    function _transferSwapTokens(address assetRouter, bytes calldata swapData) internal {
        (,IAggregationRouterV5.SwapDescription memory desc,) = abi.decode(swapData[4:], (address, IAggregationRouterV5.SwapDescription, bytes));
        if(!_isETH(desc.srcToken)){
            desc.srcToken.safeTransferFrom(msg.sender, address(this), desc.amount);
            desc.srcToken.approve(assetRouter, desc.amount);
        }
    }

    function _getSwapParams(bytes calldata swapData) internal pure returns(IERC20, uint256){
        (,IAggregationRouterV5.SwapDescription memory desc,) = abi.decode(swapData[4:], (address, IAggregationRouterV5.SwapDescription, bytes));
        return (desc.srcToken, desc.amount);
    }

    function _isETH(IERC20 token) internal pure returns(bool){
        return (address(token) == address(0) || address(token) == address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE));
    }

    function _getSwapDstToken(bytes calldata swapData) internal pure returns(IERC20){
        (,IAggregationRouterV5.SwapDescription memory desc,) = abi.decode(swapData[4:], (address, IAggregationRouterV5.SwapDescription, bytes));
        return desc.dstToken;
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

    /**
     * @dev Transfers banxe rights of the contract to a new account (`_banxe`).
     * @param _banxe - Address to transfer banxe rights to.

     * Note: This function can only be called by Banxe.
     */
    function transferBanxe(address _banxe) external onlyBanxe {
        if(_banxe == address(0)) revert INVALID_BANXE();
        emit BanxeTransferred(banxe, _banxe);
        banxe = _banxe;
    }
}