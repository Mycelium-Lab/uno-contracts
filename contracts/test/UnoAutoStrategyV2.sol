// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "../interfaces/IOdosRouter.sol";   
import "../interfaces/IUnoAssetRouter.sol";   
import "../interfaces/IUnoAutoStrategyFactory.sol";  
import '@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';

contract UnoAutoStrategyV2 is Initializable, ERC20Upgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
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

    IOdosRouter private constant OdosRouter = IOdosRouter(0xa32EE1C40594249eb3183c10792BcF573D4Da47C);

    uint256 public poolID;
    PoolInfo[] public pools;

    uint256 private reserveLP;
    MoveLiquidityInfo private lastMoveInfo;
    mapping(address => mapping(uint256 => uint256)) private blockedLiquidty;
    //mapping(address => mapping(uint256 => bool)) private leftoversCollected;

    IUnoAccessManager public accessManager;
    IUnoAutoStrategyFactory public factory;

    uint256 private constant MINIMUM_LIQUIDITY = 10**3;
    bytes32 private constant LIQUIDITY_MANAGER_ROLE = keccak256('LIQUIDITY_MANAGER_ROLE');

    //uint256 public constant version = 2;

    event Deposit(uint256 indexed poolID, address indexed from, address indexed recipient, uint256 amountA, uint256 amountB);
    event Withdraw(uint256 indexed poolID, address indexed from, address indexed recipient, uint256 amountA, uint256 amountB);
    event MoveLiquidity(uint256 indexed previousPoolID, uint256 indexed nextPoolID);

    modifier whenNotPaused(){
        require(factory.paused() == false, 'PAUSABLE: PAUSED');
        _;
    }

    // ============ Methods ============

    function initialize(_PoolInfo[] calldata poolInfos, IUnoAccessManager _accessManager) external initializer {
        require ((poolInfos.length >= 2) && (poolInfos.length <= 50), 'BAD_POOL_COUNT');

        __ERC20_init("UNO-AutoStrategy", "UNO-LP");
        __ReentrancyGuard_init();
        
        for (uint256 i = 0; i < poolInfos.length; i++) {
            IERC20[] memory _tokens = IUnoAssetRouter(poolInfos[i].assetRouter).getTokens(poolInfos[i].pool);
            IERC20 _tokenA = _tokens[0];
            IERC20 _tokenB = _tokens[1];
            PoolInfo memory pool = PoolInfo({
                pool: poolInfos[i].pool,
                assetRouter: poolInfos[i].assetRouter,
                tokenA: IERC20Upgradeable(address(_tokenA)),
                tokenB: IERC20Upgradeable(address(_tokenB))
            });
            pools.push(pool);

            if (pool.tokenA.allowance(address(this), address(pool.assetRouter)) == 0) {
                pool.tokenA.approve(address(OdosRouter), type(uint256).max);
                pool.tokenA.approve(address(pool.assetRouter), type(uint256).max);
            }
            if (pool.tokenB.allowance(address(this), address(pool.assetRouter)) == 0) {
                pool.tokenB.approve(address(OdosRouter), type(uint256).max);
                pool.tokenB.approve(address(pool.assetRouter), type(uint256).max);
            }
        }

        accessManager = _accessManager;
        lastMoveInfo.block = block.number;
        factory = IUnoAutoStrategyFactory(msg.sender);
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