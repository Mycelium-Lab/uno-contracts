// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "../interfaces/IOdosRouter.sol";
import "../interfaces/IUnoAssetRouter.sol";
import "../apps/balancer/interfaces/IUnoAssetRouterBalancer.sol";
import "../interfaces/IUnoAutoStrategyFactory.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

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
        address pool;
        address assetRouter;
    }

    struct PoolInfo {
        address pool;
        IUnoAssetRouter assetRouter;
        POOL_TYPE poolType;
    }

    /**
     * @dev MoveLiquidityInfo:
     * {leftoverA} - TokenA leftovers after MoveLiquidity() call.
     * {leftoverB} - TokenB leftovers after MoveLiquidity() call.
     * {totalSupply} - totalSupply after MoveLiquidity() call.
     * {block} - MoveLiquidity() call block.
     */
    struct MoveLiquidityInfo {
        uint256[] leftovers;
        uint256 totalSupply;
        uint256 block;
    }

    enum POOL_TYPE {
        UNISWAP,
        BALANCER
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
    mapping(address => mapping(uint256 => bool)) private leftoversCollected;

    IUnoAccessManager public accessManager;
    IUnoAutoStrategyFactory public factory;

    uint256 private constant MINIMUM_LIQUIDITY = 10**3;
    bytes32 private constant LIQUIDITY_MANAGER_ROLE = keccak256("LIQUIDITY_MANAGER_ROLE");

    event Deposit(uint256 indexed poolID, address indexed from, address indexed recipient, uint256[] amounts);
    event Withdraw(uint256 indexed poolID, address indexed from, address indexed recipient, uint256[] amounts);
    event MoveLiquidity(uint256 indexed previousPoolID, uint256 indexed nextPoolID);

    modifier whenNotPaused() {
        require(factory.paused() == false, "PAUSABLE: PAUSED");
        _;
    }

    // ============ Methods ============

    function initialize(
        _PoolInfo[] calldata poolInfos,
        uint256[] calldata poolTypes,
        IUnoAccessManager _accessManager
    ) external initializer {
        require((poolInfos.length >= 2) && (poolInfos.length <= 50), "BAD_POOL_COUNT");

        __ERC20_init("UNO-AutoStrategy", "UNO-LP");
        __ReentrancyGuard_init();

        for (uint256 i = 0; i < poolInfos.length; i++) {
            POOL_TYPE _poolType = POOL_TYPE(poolTypes[i]);

            IERC20Upgradeable[] memory _tokens = IUnoAssetRouter(poolInfos[i].assetRouter).getTokens(poolInfos[i].pool);

            PoolInfo memory pool = PoolInfo({pool: poolInfos[i].pool, assetRouter: IUnoAssetRouter(poolInfos[i].assetRouter), poolType: _poolType});
            pools.push(pool);

            for (uint256 j = 0; j < _tokens.length; j++) {
                if (_tokens[j].allowance(address(this), address(pool.assetRouter)) == 0) {
                    _tokens[j].approve(address(OdosRouter), type(uint256).max);
                    _tokens[j].approve(address(pool.assetRouter), type(uint256).max);
                }
            }
        }

        accessManager = _accessManager;
        lastMoveInfo.block = block.number;
        factory = IUnoAutoStrategyFactory(msg.sender);
    }

    /**
     * @dev Deposits tokens in the pools[poolID] pool. Mints tokens representing user share. Emits {Deposit} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit (needed for balancer).
     * @param minAmountLP - Minimum amounts of LP Token acquired.
     * @param amountsMin - Minimum amounts to deposit.
     * @param recipient - Address which will recieve the deposit.
     
     * @return sent - Deposited token amounts.
     * @return liquidity - Total liquidity minted for the {recipient}.
     */
    function deposit(
        uint256 pid,
        uint256[] calldata amounts,
        address[] calldata tokens,
        uint256 minAmountLP,
        uint256[] calldata amountsMin,
        address recipient
    ) external whenNotPaused nonReentrant returns (uint256[] memory sent, uint256 liquidity) {
        require(pid == poolID, "BAD_POOL_ID");
        PoolInfo memory pool = pools[poolID];

        require(amounts.length == tokens.length, "BAD_AMOUNTS_LENGTH");
        require(amounts.length == amountsMin.length, "BAD_AMOUNTS_LENGTH");

        IERC20Upgradeable[] memory poolTokens = pool.assetRouter.getTokens(pool.pool); // should tokens and poolTokens be the same ()

        sent = new uint256[](poolTokens.length);

        require(amounts.length == poolTokens.length, "BAD_TOKENS_LENGTH"); // probably there needs to be a more specific error

        for (uint256 i = 0; i < poolTokens.length; i++) {
            poolTokens[i].safeTransferFrom(msg.sender, address(this), amounts[i]);
        }

        if (pool.poolType == POOL_TYPE.UNISWAP) {
            (sent[0], sent[1], ) = pool.assetRouter.deposit(pool.pool, amounts[0], amounts[1], amountsMin[0], amountsMin[1], 0, address(this));

            poolTokens[0].safeTransfer(msg.sender, amounts[0] - sent[0]);
            poolTokens[1].safeTransfer(msg.sender, amounts[1] - sent[1]);
        } else if (pool.poolType == POOL_TYPE.BALANCER) {
            pool.assetRouter.deposit(pool.pool, amounts, tokens, minAmountLP, 0, address(this));
        }

        liquidity = mint(recipient);
        emit Deposit(poolID, msg.sender, recipient, sent);
    }

    /**
     * @dev Withdraws tokens from the {pools[poolID]} pool and sends them to the recipient. Burns tokens representing user share. Emits {Withdraw} event.
     * @param pid - Current poolID. Throws revert if moveLiquidity() has been called before the transaction has been mined.
     * @param liquidity - Liquidity to burn from this user.
     * @param amountsMin - The minimum amounts of tokens that must be received from the pool for the transaction not to revert.
     * @param recipient - Address which will recieve withdrawn tokens.
     
     * @return amounts - Token amounts sent to the {recipient}.
     */
    function withdraw(
        uint256 pid,
        uint256 liquidity,
        uint256[] calldata amountsMin,
        address recipient
    ) external whenNotPaused nonReentrant returns (uint256[] memory amounts) {
        require(pid == poolID, "BAD_POOL_ID");
        PoolInfo memory pool = pools[poolID];

        IERC20Upgradeable[] memory poolTokens = pool.assetRouter.getTokens(pool.pool);

        uint256[] memory balancesBefore = new uint256[](poolTokens.length);

        for (uint256 i = 0; i < poolTokens.length; i++) {
            balancesBefore[i] = poolTokens[i].balanceOf(address(this));
        }

        collectLeftovers(recipient);
        uint256 amountLP = burn(liquidity);

        amounts = new uint256[](poolTokens.length);

        if (pool.poolType == POOL_TYPE.UNISWAP) {
            pool.assetRouter.withdraw(pool.pool, amountLP, amountsMin[0], amountsMin[1], false, recipient);
        } else if (pool.poolType == POOL_TYPE.BALANCER) {
            pool.assetRouter.withdraw(pool.pool, amountLP, amountsMin, false, recipient);
        }

        for (uint256 i = 0; i < poolTokens.length; i++) {
            uint256 balanceAfter = poolTokens[i].balanceOf(address(this));
            amounts[i] = balancesBefore[i] - balanceAfter;
        }

        emit Withdraw(poolID, msg.sender, recipient, amounts);
    }

    /**
     * @dev Collects leftover tokens left from moveLiquidity() function.
     * @param recipient - Address which will recieve leftover tokens.
     
     * @return leftovers - Token amounts sent to the {recipient}.
     */
    function collectLeftovers(address recipient) internal returns (uint256[] memory leftovers) {
        // (??)
        if (!leftoversCollected[msg.sender][lastMoveInfo.block]) {
            if (lastMoveInfo.totalSupply != 0) {
                PoolInfo memory pool = pools[poolID];

                IERC20Upgradeable[] memory poolTokens = pool.assetRouter.getTokens(pool.pool);

                leftovers = new uint256[](poolTokens.length);

                for (uint256 i = 0; i < poolTokens.length; i++) {
                    leftovers[i] = ((balanceOf(msg.sender) - blockedLiquidty[msg.sender][lastMoveInfo.block]) * lastMoveInfo.leftovers[i]) / lastMoveInfo.totalSupply;
                    if (leftovers[i] > 0) {
                        poolTokens[i].safeTransfer(recipient, leftovers[i]);
                    }
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
     * @param amountsMin - The minimum amounts of tokens that must be deposited in {pools[_poolID]} for the transaction not to revert.
     *
     * Note: This function can only be called by LiquidityManager.
     */
    function moveLiquidity(
        uint256 _poolID,
        bytes calldata swapAData,
        bytes calldata swapBData,
        uint256[] calldata amountsMin
    ) external whenNotPaused nonReentrant {
        require(accessManager.hasRole(LIQUIDITY_MANAGER_ROLE, msg.sender), "CALLER_NOT_LIQUIDITY_MANAGER");
        require(totalSupply() != 0, "NO_LIQUIDITY");
        require(lastMoveInfo.block != block.number, "CANT_CALL_ON_THE_SAME_BLOCK");
        require((_poolID < pools.length) && (_poolID != poolID), "BAD_POOL_ID");

        PoolInfo memory currentPool = pools[poolID];
        PoolInfo memory newPool = pools[_poolID];

        IERC20Upgradeable[] memory currentPoolTokens = currentPool.assetRouter.getTokens(currentPool.pool);
        IERC20Upgradeable[] memory newPoolTokens = newPool.assetRouter.getTokens(newPool.pool);

        uint256 _totalDeposits;
        if (currentPool.poolType == POOL_TYPE.UNISWAP) {
            (_totalDeposits, , ) = currentPool.assetRouter.userStake(address(this), currentPool.pool);
            currentPool.assetRouter.withdraw(currentPool.pool, _totalDeposits, 0, 0, false, address(this));
        } else if (currentPool.poolType == POOL_TYPE.BALANCER) {
            _totalDeposits = IUnoAssetRouterBalancer(address(currentPool.assetRouter)).userStake(address(this), currentPool.pool);
            uint256[] memory minAmounts = new uint256[](currentPoolTokens.length); // array of zeros
            currentPool.assetRouter.withdraw(currentPool.pool, _totalDeposits, minAmounts, false, address(this));
        }

        (IOdosRouter.inputToken[] memory inputs, IOdosRouter.outputToken[] memory outputs, , uint256 valueOutMin, address executor, bytes memory pathDefinition) = abi.decode(swapAData[4:], (IOdosRouter.inputToken[], IOdosRouter.outputToken[], uint256, uint256, address, bytes));

        require((inputs.length == currentPoolTokens.length) && (outputs.length == newPoolTokens.length), "BAD_SWAP_TOKENS_LENGTH");

        for (uint256 i = 0; i < currentPoolTokens.length; i++) {
            require(inputs[i].tokenAddress == address(currentPoolTokens[i]), "BAD_INPUT_TOKENS");
        }

        for (uint256 i = 0; i < newPoolTokens.length; i++) {
            require(outputs[i].tokenAddress == address(newPoolTokens[i]), "BAD_OUTPUT_TOKENS");
        }

        for (uint256 i = 0; i < currentPoolTokens.length; i++) {
            inputs[i].amountIn = currentPoolTokens[i].balanceOf(address(this));
        }
        OdosRouter.swap(inputs, outputs, type(uint256).max, valueOutMin, executor, pathDefinition);

        uint256[] memory balancesAfter = new uint256[](newPoolTokens.length);

        for (uint256 i = 0; i < newPoolTokens.length; i++) {
            balancesAfter[i] = newPoolTokens[i].balanceOf(address(this));
        }

        uint256[] memory leftovers = new uint256[](newPoolTokens.length); // array of zeros

        if (currentPool.poolType == POOL_TYPE.UNISWAP) {
            newPool.assetRouter.deposit(newPool.pool, balancesAfter[0], balancesAfter[1], amountsMin[0], amountsMin[1], 0, address(this));

            leftovers[0] = newPoolTokens[0].balanceOf(address(this));
            leftovers[1] = newPoolTokens[1].balanceOf(address(this));
        } else if (currentPool.poolType == POOL_TYPE.BALANCER) {
            address[] memory tokens = new address[](newPoolTokens.length);
            for (uint256 i = 0; i < newPoolTokens.length; i++) {
                tokens[i] = address(newPoolTokens[i]);
            }

            newPool.assetRouter.deposit(newPool.pool, balancesAfter, tokens, 0, 0, address(this)); // minAmountLP zero?
        }

        lastMoveInfo = MoveLiquidityInfo({leftovers: leftovers, totalSupply: totalSupply(), block: block.number});

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
    function userStake(address _address)
        external
        view
        returns (
            uint256 stakeA,
            uint256 stakeB,
            uint256 leftoverA,
            uint256 leftoverB
        )
    {
        // PoolInfo memory pool = pools[poolID];
        // (, uint256 balanceA, uint256 balanceB) = pool.assetRouter.userStake(address(this), pool.pool);
        // uint256 _balance = balanceOf(_address);
        // if (_balance != 0) {
        //     uint256 _totalSupply = totalSupply();
        //     stakeA = (_balance * balanceA) / _totalSupply;
        //     stakeB = (_balance * balanceB) / _totalSupply;
        //     if ((!leftoversCollected[msg.sender][lastMoveInfo.block]) && (lastMoveInfo.totalSupply != 0)) {
        //         leftoverA = ((_balance - blockedLiquidty[_address][lastMoveInfo.block]) * lastMoveInfo.leftoverA) / lastMoveInfo.totalSupply;
        //         leftoverB = ((_balance - blockedLiquidty[_address][lastMoveInfo.block]) * lastMoveInfo.leftoverB) / lastMoveInfo.totalSupply;
        //     }
        // }
    }

    /**
     * @dev Returns total amount locked in the pool.
     * @return totalDepositsA - Token A deposits.
     * @return totalDepositsB - Token B deposits.
     */
    function totalDeposits() external view returns (uint256 totalDepositsA, uint256 totalDepositsB) {
        // PoolInfo memory pool = pools[poolID];
        // (, totalDepositsA, totalDepositsB) = pool.assetRouter.userStake(address(this), pool.pool);
        // // Add leftover tokens.
        // totalDepositsA += pool.tokenA.balanceOf(address(this));
        // totalDepositsB += pool.tokenB.balanceOf(address(this));
    }

    /**
     * @dev Returns the number of pools in the strategy.
     */
    function poolsLength() external view returns (uint256) {
        return pools.length;
    }

    /**
     * @dev Returns tokens that currently in use.
     */
    function getTokens() external view returns (IERC20Upgradeable[] memory poolTokens) {
        PoolInfo memory pool = pools[poolID];

        poolTokens = pool.assetRouter.getTokens(pool.pool);
    }

    function mint(address to) internal returns (uint256 liquidity) {
        PoolInfo memory pool = pools[poolID];

        uint256 balanceLP;

        if (pool.poolType == POOL_TYPE.UNISWAP) {
            (balanceLP, , ) = pool.assetRouter.userStake(address(this), pool.pool);
        } else if (pool.poolType == POOL_TYPE.BALANCER) {
            balanceLP = IUnoAssetRouterBalancer(address(pool.assetRouter)).userStake(address(this), pool.pool);
        }

        uint256 amountLP = balanceLP - reserveLP;
        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = amountLP - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY);
        } else {
            liquidity = (amountLP * _totalSupply) / reserveLP;
        }
        require(liquidity > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);
        reserveLP = balanceLP;
    }

    function burn(uint256 liquidity) internal returns (uint256 amountLP) {
        PoolInfo memory pool = pools[poolID];

        uint256 balanceLP;

        if (pool.poolType == POOL_TYPE.UNISWAP) {
            (balanceLP, , ) = pool.assetRouter.userStake(address(this), pool.pool);
        } else if (pool.poolType == POOL_TYPE.BALANCER) {
            balanceLP = IUnoAssetRouterBalancer(address(pool.assetRouter)).userStake(address(this), pool.pool);
        }
        amountLP = (liquidity * balanceLP) / totalSupply();
        require(amountLP > 0, "INSUFFICIENT_LIQUIDITY_BURNED");
        _burn(msg.sender, liquidity);
        reserveLP = balanceLP - amountLP;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._beforeTokenTransfer(from, to, amount);
        // Decrease blockedLiquidty from {from} address, but no less then 0.
        if (amount > blockedLiquidty[from][lastMoveInfo.block]) {
            blockedLiquidty[from][lastMoveInfo.block] = 0;
        } else {
            blockedLiquidty[from][lastMoveInfo.block] -= amount;
        }
        // Block {to} address from withdrawing their share of leftover tokens immediately.
        blockedLiquidty[to][lastMoveInfo.block] += amount;
    }
}
