// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../interfaces/IOdosRouter.sol";   
import "../interfaces/IUnoAssetRouter.sol";   
import "../interfaces/IUnoAutoStrategyFactory.sol";  
import "../interfaces/IAggregationRouterV5.sol";
import '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

contract UnoAutoStrategy is Initializable, ERC20Upgradeable, ReentrancyGuardUpgradeable {
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
     * {OdosRouter} - Contract that executes swaps.

     * {poolID} - Current pool the strategy uses ({pools} index).
     * {pools} - Pools this strategy can use and move liquidity to.

     * {reserveLP} - LP token reserve.
     * {lastMoveInfo} - Info on last MoveLiquidity() block.
     * {blockedLiquidty} - User's blocked LP tokens. Prevents user from stealing leftover tokens by depositing and exiting before moveLiquidity() has been called.
     * {leftoversCollected} - Flag that prevents leftover token collection if they were already collected this MoveLiquidity() cycle.

     * {accessManager} - Role manager contract.
     * {factory} - The address of AutoStrategyFactory this contract was deployed by.

     * {MINIMUM_LIQUIDITY} - Ameliorates rounding errors.
     */

    IOdosRouter private constant OdosRouter = IOdosRouter(0x9f138be5aA5cC442Ea7cC7D18cD9E30593ED90b9);

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
    address private constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    bytes32 private constant FEE_COLLECTOR_ROLE = keccak256('FEE_COLLECTOR_ROLE');

    struct ReferrerInfo {
        uint256 lastFeeCollection;
        uint256 deposits;
        uint256 feeCollected;
    }
    /// @dev maps referrer address to referrer info
    mapping(address => ReferrerInfo) private referrerInfo;
    /// @dev maps referral to referrer
    mapping(address => address) private referrers;
    /// @dev This is added to totalSupply internaly to get rid of _mint() inside _collectFee() to avoid recursive fee collection.
    uint256 private fantomTotalSupply;
    bool private isInitialized;

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
    event CollectFee(address indexed recipient, uint256 fee);

    //To save contract size
    error PAUSED();
    error BAD_POOL_ID();
    error BAD_POOL_COUNT();
    error CALLER_NOT_LIQUIDITY_MANAGER();
    error NO_LIQUIDITY();
    error CANT_CALL_ON_THE_SAME_BLOCK();
    error BAD_SWAP_A();
    error BAD_SWAP_B();
    error INSUFFICIENT_LIQUIDITY();
    error NOT_ETH_POOL();
    error TRANSFER_NOT_SUCCESSFUL();
    error ETH_DEPOSIT_REJECTED();

    modifier whenNotPaused(){
        if(factory.paused()) revert PAUSED();
        _;
    }

    // ============ Methods ============

    receive() external payable {
        //Reject deposits from EOA
        if (msg.sender == tx.origin) revert ETH_DEPOSIT_REJECTED();
    }

    function initialize(_PoolInfo[] calldata poolInfos, IUnoAccessManager _accessManager) external initializer {
        if((poolInfos.length < 2) || (poolInfos.length > 50)) revert BAD_POOL_COUNT();

        __ERC20_init("UNO-AutoStrategy", "UNO-LP");
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

        accessManager = _accessManager;
        lastMoveInfo.block = block.number;
        factory = IUnoAutoStrategyFactory(msg.sender);
        isInitialized = true;
    }

    /**
     * @dev Deposits tokens in the pools[poolID] pool. Mints tokens representing user share. Emits {Deposit} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param amountA - Token A amount to deposit.
     * @param amountB  - Token B amount to deposit.
     * @param amountAMin - Bounds the extent to which the B/A price can go up before the transaction reverts.
     * @param amountBMin - Bounds the extent to which the A/B price can go up before the transaction reverts.
     * @param recipient - Address which will receive the deposit.
     * @param referrer - Address the fees from {msg.sender}'s liquidity will be collected to
     
     * @return sentA - Deposited token A amount.
     * @return sentB - Deposited token B amount.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function deposit(uint256 pid, uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, address recipient, address referrer) whenNotPaused nonReentrant external returns (uint256 sentA, uint256 sentB, uint256 liquidity) {
        if(pid != poolID) revert BAD_POOL_ID();
        PoolInfo memory pool = pools[poolID];

        pool.tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        pool.tokenA.approve(address(pool.assetRouter), amountA);

        pool.tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        pool.tokenB.approve(address(pool.assetRouter), amountB);

        uint256 amountLP;
        (sentA, sentB, amountLP) = pool.assetRouter.deposit(pool.pool, amountA, amountB, amountAMin, amountBMin, address(this));
        liquidity = mint(recipient, referrer);

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
     * @param amountTokenMin - Bounds the extent to which the TOKEN/WBNB price can go up before the transaction reverts.
     * @param amountETHMin - Bounds the extent to which the WBNB/TOKEN price can go up before the transaction reverts.
     * @param recipient - Address which will receive the deposit.
     * @param referrer - Address the fees from {msg.sender}'s liquidity will be collected to
     
     * @return sentToken - Deposited token amount.
     * @return sentETH - Deposited ETH amount.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function depositETH(uint256 pid, uint256 amountToken, uint256 amountTokenMin, uint256 amountETHMin, address recipient, address referrer) whenNotPaused nonReentrant external payable returns (uint256 sentToken, uint256 sentETH, uint256 liquidity) {
        if(pid != poolID) revert BAD_POOL_ID();
        PoolInfo memory pool = pools[poolID];

        IERC20 token;
        if (address(pool.tokenA) == WBNB) {
            token = pool.tokenB;
        } else if (address(pool.tokenB) == WBNB) {
            token = pool.tokenA;
        } else revert NOT_ETH_POOL();

        token.safeTransferFrom(msg.sender, address(this), amountToken);
        token.approve(address(pool.assetRouter), amountToken);

        uint256 amountLP;
        (sentToken, sentETH, amountLP) = pool.assetRouter.depositETH{value: msg.value}(pool.pool, amountToken, amountTokenMin, amountETHMin, address(this));
        liquidity = mint(recipient, referrer);

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
     * @param referrer - Address the fees from {msg.sender}'s liquidity will be collected to
     
     * @return sent0 - Tokens sent to the farm from the {swapData[0]}.
     * @return sent1 - Tokens sent to the farm from the {swapData[1]}.
     * @return dustA - {pool.tokenA} dust sent to the {msg.sender}.
     * @return dustB - {pool.tokenB} dust sent to the {msg.sender}.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function depositWithSwap(uint256 pid, bytes[2] calldata swapData, address recipient, address referrer) whenNotPaused nonReentrant payable external returns (uint256 sent0, uint256 sent1, uint256 dustA, uint256 dustB, uint256 liquidity) {
        if(pid != poolID) revert BAD_POOL_ID();
        PoolInfo memory pool = pools[poolID];

        _transferSwapTokens(address(pool.assetRouter), swapData);

        uint256 amountLP;
        (sent0, sent1, dustA, dustB, amountLP) = pool.assetRouter.depositWithSwap{value: msg.value}(pool.pool, swapData, address(this));
        liquidity = mint(recipient, referrer);

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

        (uint256 leftoverA, uint256 leftoverB) = collectLeftovers(recipient);

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

        (uint256 leftoverA, uint256 leftoverB) = collectLeftovers(recipient);

        uint256 amountLP = burn(liquidity);
        (amountToken, amountETH) = pool.assetRouter.withdrawETH(pool.pool, amountLP, amountTokenMin, amountETHMin, recipient);

        if (address(pool.tokenA) == WBNB) {
            amountETH += leftoverA;
            amountToken += leftoverB;
        } else if (address(pool.tokenB) == WBNB) {
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

        (uint256 leftoverA, uint256 leftoverB) = collectLeftovers(recipient);

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
    function collectLeftovers(address recipient) internal returns (uint256 leftoverA, uint256 leftoverB){
        if(!leftoversCollected[msg.sender][lastMoveInfo.block]){
            if(lastMoveInfo.totalSupply != 0){
                PoolInfo memory pool = pools[poolID];
                leftoverA = (balanceOf(msg.sender) - blockedLiquidty[msg.sender][lastMoveInfo.block]) * lastMoveInfo.leftoverA / lastMoveInfo.totalSupply;
                leftoverB = (balanceOf(msg.sender) - blockedLiquidty[msg.sender][lastMoveInfo.block]) * lastMoveInfo.leftoverB / lastMoveInfo.totalSupply;

                if(leftoverA > 0){
                    pool.tokenA.safeTransfer(recipient, leftoverA);
                }
                if(leftoverB > 0){
                    pool.tokenB.safeTransfer(recipient, leftoverB);
                }
            }

            leftoversCollected[msg.sender][lastMoveInfo.block] = true;
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
     * @return leftoverA - Token A Leftovers obligated to the {_address} after moveLiquidity() function call.
     * @return leftoverB - Token B Leftovers obligated to the {_address} after moveLiquidity() function call.
     */
    function userStake(address _address) external view returns (uint256 stakeA, uint256 stakeB, uint256 leftoverA, uint256 leftoverB) {
        uint256 _balance;
        if(_address == address(0)){
            revert();
        } else if(accessManager.hasRole(FEE_COLLECTOR_ROLE, _address)){
            _balance = balanceOf(_address) + (referrerInfo[_address].feeCollected + _getReferrerFee(address(0)) * 2) / 1 ether;
        } else {
            _balance = balanceOf(_address) + (referrerInfo[_address].feeCollected + _getReferrerFee(_address)) / 1 ether;
        }

        if(_balance != 0){
            PoolInfo memory pool = pools[poolID];
            (, uint256 balanceA, uint256 balanceB) = pool.assetRouter.userStake(address(this), pool.pool);

            uint256 _totalSupply = totalSupply();
            stakeA = _balance * balanceA / _totalSupply; 
            stakeB = _balance * balanceB / _totalSupply; 
            if((!leftoversCollected[msg.sender][lastMoveInfo.block]) && (lastMoveInfo.totalSupply != 0)){
                leftoverA = (_balance - blockedLiquidty[_address][lastMoveInfo.block]) * lastMoveInfo.leftoverA / lastMoveInfo.totalSupply;
                leftoverB = (_balance - blockedLiquidty[_address][lastMoveInfo.block]) * lastMoveInfo.leftoverB / lastMoveInfo.totalSupply;
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

    function mint(address to, address referrer) internal returns (uint256 liquidity){
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

        address _referrer = referrers[msg.sender];
        // Can change referrer only for sender
        if(_referrer != referrer){
            referrers[msg.sender] = referrer;
            uint256 balance = balanceOf(msg.sender);
            // If == 0, we don't need to call _collectFee
            if(balance > 0){
                // Update referrer fee & subtract balance from referrer's deposits
                _collectFee(_referrer);
                referrerInfo[_referrer].deposits -= balance;

                // Add balance to new referrer's deposits
                _collectFee(referrer);
                referrerInfo[referrer].deposits += balance;
            }
        }

        _mint(to, liquidity);
        reserveLP = balanceLP;
    }

    function burn(uint256 liquidity) internal returns (uint256 amountLP) {
        PoolInfo memory pool = pools[poolID];
        (uint256 balanceLP,,) = pool.assetRouter.userStake(address(this), pool.pool);

        uint256 _totalSupply = totalSupply();
        // Collect fee for the caller to their address
        liquidity += collectFee(msg.sender);
        amountLP = liquidity * balanceLP / _totalSupply; 
        if(amountLP == 0) revert INSUFFICIENT_LIQUIDITY();
        
        _burn(msg.sender, liquidity);
        reserveLP = balanceLP - amountLP;
    }

    /**
      * @dev Collects fee and mints it to {referrer}.
      * @param referrer - Address to collect fees for.
      *
      * @return fee - Fee collected.
     */
    function collectFee(address referrer) public returns (uint256 fee){
        if(referrer == address(0)){
            return 0;
        }
        
        address recipient = referrer;
        if(accessManager.hasRole(FEE_COLLECTOR_ROLE, referrer)){
            referrer = address(0);
        }

        _collectFee(referrer);
        fee = referrerInfo[referrer].feeCollected / 1 ether;
        if(fee > 0){
            _mint(recipient, fee);
            fantomTotalSupply -= referrerInfo[referrer].feeCollected;
            referrerInfo[referrer].feeCollected = 0;

            emit CollectFee(recipient, fee);
        }
    }

    function _getReferrerFee(address referrer) private view returns (uint256) {
        uint256 deposits = referrerInfo[referrer].deposits;
        uint256 lastFeeCollection = referrerInfo[referrer].lastFeeCollection;
        if(deposits != 0 && lastFeeCollection != 0 && block.timestamp != lastFeeCollection){
            // 60*60*24*365 = 31536000; 2% / 31536000 = 0.0000000634195839 % per second = 634195839 wei per second.
            // Divide by 2 to mint equal amounts to feeCollector and to referrer.
            return ((block.timestamp - lastFeeCollection) * 317097919 * deposits);
        }
        return 0;
    }

    function _collectFee(address referrer) private {
        // Some autostrats were initialized before referral upgrade, so we initialize all liquidity as having address(0) as it's referrer here.
        if(!isInitialized){
            referrerInfo[address(0)].deposits = totalSupply();
            isInitialized = true;
        }

        uint256 fee = _getReferrerFee(referrer);
        if(fee > 0){
            //referrer == address(0) is a special case for uno's fee collector.
            if(referrer == address(0)){
                fee *= 2;
                referrerInfo[address(0)].feeCollected += fee;
                fantomTotalSupply += fee;
            } else {
                referrerInfo[referrer].feeCollected += fee;
                referrerInfo[address(0)].feeCollected += fee;
                fantomTotalSupply += fee * 2;
            }
        }
        
        referrerInfo[referrer].lastFeeCollection = block.timestamp;
    }

    function _transferSwapTokens(address assetRouter, bytes[2] calldata swapData) internal {
        (,IAggregationRouterV5.SwapDescription memory desc0,) = abi.decode(swapData[0][4:], (address, IAggregationRouterV5.SwapDescription, bytes));
        (,IAggregationRouterV5.SwapDescription memory desc1,) = abi.decode(swapData[1][4:], (address, IAggregationRouterV5.SwapDescription, bytes));

        if(desc0.srcToken == desc1.srcToken){
            if(!_isETH(desc0.srcToken)){
                uint256 amount = desc0.amount + desc1.amount;
                desc0.srcToken.safeTransferFrom(msg.sender, address(this), amount);
                desc0.srcToken.approve(assetRouter, amount);
            }
        }else{
            if(!_isETH(desc0.srcToken)){
                desc0.srcToken.safeTransferFrom(msg.sender, address(this), desc0.amount);
                desc0.srcToken.approve(assetRouter, desc0.amount);
            }
            if(!_isETH(desc1.srcToken)){
                desc1.srcToken.safeTransferFrom(msg.sender, address(this), desc1.amount);
                desc1.srcToken.approve(assetRouter, desc1.amount);
            }
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

        if(from != address(0)){
            //Decrease referralDeposits from {from}'s referrer
            address referrer = referrers[from];
            _collectFee(referrer);
            referrerInfo[referrer].deposits -= amount;
        }
        if(to != address(0)){
            //Add referralDeposits to {to}'s referrer
            address referrer = referrers[to];
            _collectFee(referrer);
            referrerInfo[referrer].deposits += amount;
        }
    }

    function totalSupply() public view override returns (uint256) {
        return super.totalSupply() + (fantomTotalSupply / 1 ether);
    }
}