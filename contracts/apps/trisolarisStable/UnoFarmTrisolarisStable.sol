// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../../interfaces/IUniswapV2Pair.sol";
import "../../interfaces/IUniswapV2Router02.sol";
import "../../interfaces/IUniversalMasterChef.sol";
import "../../interfaces/IComplexRewarder.sol";
import "../../interfaces/ISwap.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract UnoFarmTrisolarisStable is Initializable, ReentrancyGuardUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;
    /**
     * @dev DistributionInfo:
     * {block} - Distribution block number.
     * {rewardPerDepositAge} - Distribution reward divided by {totalDepositAge}.
     * {cumulativeRewardAgePerDepositAge} - Sum of {rewardPerDepositAge}s multiplied by distribution interval.
     */
    struct DistributionInfo {
        uint256 block;
        uint256 rewardPerDepositAge;
        uint256 cumulativeRewardAgePerDepositAge;
    }
    /**
     * @dev UserInfo:
     * {stake} - Amount of LP tokens deposited by the user.
     * {depositAge} - User deposits multiplied by blocks the deposit has been in.
     * {reward} - Amount of LP tokens entitled to the user.
     * {lastDistribution} - Distribution ID before the last user deposit.
     * {lastUpdate} - Deposit update block.
     */
    struct UserInfo {
        uint256 stake;
        uint256 depositAge;
        uint256 reward;
        uint32 lastDistribution;
        uint256 lastUpdate;
    }

    /**
     * @dev Tokens Used:
     * {rewardToken} - Token generated by staking (SUSHI).
     * {rewarderToken} - Token generated by ComplexRewarderTime contract.
     * {lpPair} - Token that the strategy maximizes. The same token that users deposit in the {MiniChef}.
     * {tokens} - Tokens that the strategy maximizes.
     */
    address public rewardToken;
    address public rewarderToken;
    address public lpPair;
    address[] public tokens;

    /**
     * @dev Third Party Contracts:
     * {sushiswapRouter} - The contract that executes swaps.
     * {MasterChef} -The contract that distibutes {rewardToken}.
     */
    ISwap private swap;
    IUniswapV2Router02 private constant trisolarisRouter = IUniswapV2Router02(0x2CB45Edb4517d5947aFdE3BEAbF95A582506858B);
    IUniversalMasterChef private constant MasterChef = IUniversalMasterChef(0x3838956710bcc9D122Dd23863a0549ca8D5675D6);

    /**
     * @dev Contract Variables:
     * {pid} - Pool ID.
     * {tokensLength} - Length of {tokens}

     * {totalDeposits} - Total deposits made by users.
     * {totalDepositAge} - Deposits multiplied by blocks the deposit has been in. Flushed every reward distribution.
     * {totalDepositLastUpdate} - Last {totalDepositAge} update block.

     * {distributionID} - Current distribution ID.
     * {userInfo} - Info on each user.
     * {distributionInfo} - Info on each distribution.

     * {fractionMultiplier} - Used to store decimal values.
     */
    uint256 public pid;
    uint256 public tokensLength;

    uint256 private totalDeposits;
    uint256 private totalDepositAge;
    uint256 private totalDepositLastUpdate;

    uint32 private distributionID;
    mapping(address => UserInfo) private userInfo;
    mapping(uint32 => DistributionInfo) private distributionInfo;

    uint256 private constant fractionMultiplier = uint256(1 ether);

    /**
     * @dev Contract Variables:
     * {assetRouter} - The contract from which calls to this farm are made.
     */
    address public assetRouter;
    modifier onlyAssetRouter() {
        require(msg.sender == assetRouter, "CALLER_NOT_ASSET_ROUTER");
        _;
    }

    // ============ Methods ============

    function initialize(address _swap, address _assetRouter) external initializer {
        __ReentrancyGuard_init();
        assetRouter = _assetRouter;

        getTokens(_swap);

        swap = ISwap(_swap);
        (,,,,,,lpPair) = swap.swapStorage();
        pid = getPoolId(lpPair);

        rewardToken = MasterChef.TRI();

        address ComplexRewarder = MasterChef.rewarder(pid);
        if (ComplexRewarder != address(0)) {
            (IERC20[] memory rewarderTokenArray, ) = IComplexRewarder(ComplexRewarder).pendingTokens(pid, address(0), 0);
            rewarderToken = address(rewarderTokenArray[0]);
            IERC20(rewarderToken).approve(address(trisolarisRouter), type(uint256).max);
        }

        distributionInfo[0] = DistributionInfo({
            block: block.number,
            rewardPerDepositAge: 0,
            cumulativeRewardAgePerDepositAge: 0
        });
        distributionID = 1;
        totalDepositLastUpdate = block.number;

        IERC20(lpPair).approve(address(MasterChef), type(uint256).max);
        IERC20(lpPair).approve(_swap, type(uint256).max);
        IERC20(rewardToken).approve(address(trisolarisRouter), type(uint256).max);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).approve(_swap, type(uint256).max);
        }
    }

    /**
     * @dev Function that makes the deposits.
     * Deposits provided tokens in the Liquidity Pool, then stakes generated LP tokens in the {MiniChef}.
     */
    function deposit(
        uint256[] memory amounts,
        uint256 minAmountLP,
        uint256 amountLP,
        address recipient
    ) external nonReentrant onlyAssetRouter returns (uint256 liquidity) {
        require(amounts.length == tokens.length, "BAD_AMOUNTS_LENGTH");
        
        bool joinPool = false;
        for (uint256 i = 0; i < tokens.length; i++) {
            if ((amounts[i] != 0) && !joinPool) {
                joinPool = true;
            }
        }

        uint256 addedLiquidity;
        if (joinPool) {
            addedLiquidity = swap.addLiquidity(amounts, minAmountLP, block.timestamp);
        }

        liquidity = addedLiquidity + amountLP;
        require(liquidity > 0, "NO_LIQUIDITY_PROVIDED");

        _updateDeposit(recipient);
        userInfo[recipient].stake += liquidity;
        totalDeposits += liquidity;
        
        MasterChef.deposit(pid, liquidity, address(this));
    }

    /**
     * @dev Withdraws funds from {origin} and sends them to the {recipient}.
     */
    function withdraw(
        uint256 amount,
        uint256[] memory minAmounts,
        bool withdrawLP,
        address origin,
        address recipient
    ) external nonReentrant onlyAssetRouter returns (uint256[] memory amounts) {
        require(amount > 0, "INSUFFICIENT_AMOUNT");
        require(minAmounts.length == tokens.length, "BAD_MIN_AMOUNTS_LENGTH");

        _updateDeposit(origin);
        UserInfo storage user = userInfo[origin];
        // Subtract amount from user.reward first, then subtract remainder from user.stake.
        if (amount > user.reward) {
            uint256 balance = user.stake + user.reward;
            require(amount <= balance, 'INSUFFICIENT_BALANCE');
            user.stake = balance - amount;
            totalDeposits = totalDeposits + user.reward - amount;
            user.reward = 0;
        } else {
            user.reward -= amount;
        }

        MasterChef.withdraw(pid, amount, address(this));
        if (withdrawLP) {
            IERC20Upgradeable(lpPair).safeTransfer(recipient, amount);
            return new uint256[](tokens.length);
        }

        amounts = swap.removeLiquidity(amount, minAmounts, block.timestamp);
        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20Upgradeable(tokens[i]).transfer(recipient, amounts[i]);
        }
    }

    /**
     * @dev Core function of the strat, in charge of updating, collecting and re-investing rewards.
     * 1. It claims rewards from the {MiniChef}.
     * 2. It swaps {rewardToken} token for {tokenA} & {tokenB}.
     * 3. It deposits new LP tokens back to the {MiniChef}.
     */
    function distribute(
        address[][] calldata rewardTokenRoutes,
        address[][] calldata rewarderTokenRoutes,
        uint256[] calldata rewardAmountsOutMin,
        uint256[] calldata rewarderAmountsOutMin
    ) external onlyAssetRouter nonReentrant returns (uint256 reward) {
        require(totalDeposits > 0, "NO_LIQUIDITY");
        require(distributionInfo[distributionID - 1].block != block.number, "CANT_CALL_ON_THE_SAME_BLOCK");
        require(rewardTokenRoutes.length == tokens.length, "BAD_REWARD_ROUTES_LENGTH");
        require(rewarderTokenRoutes.length == tokens.length, "BAD_REWARDER_ROUTES_LENGTH");
        
        for (uint256 i = 0; i < tokens.length; i++) {
            require(rewardTokenRoutes[i][0] == rewardToken && rewardTokenRoutes[i][rewardTokenRoutes[i].length - 1] == tokens[i], "BAD_REWARD_TOKEN_ROUTES");
            require(rewarderTokenRoutes[i][0] == rewarderToken && rewarderTokenRoutes[i][rewarderTokenRoutes[i].length - 1] == tokens[i], "BAD_REWARDER_TOKEN_ROUTES");
        }

        MasterChef.harvest(pid, address(this));
        { // scope to avoid stack too deep errors
        uint256 rewardTokenFraction = IERC20(rewardToken).balanceOf(address(this)) / tokens.length;
        if (rewardTokenFraction > 0) {
            for (uint256 i = 0; i < tokens.length; i++) {
                if (tokens[i] != rewardToken) {
                    trisolarisRouter.swapExactTokensForTokens(rewardTokenFraction, rewardAmountsOutMin[i], rewardTokenRoutes[i], address(this), block.timestamp);
                }
            }
        }
        }

        if (rewarderToken != address(0)) {
            uint256 rewarderTokenFraction = IERC20(rewarderToken).balanceOf(address(this)) / tokens.length;
            if (rewarderTokenFraction > 0) {
                for (uint256 i = 0; i < tokens.length; i++) {
                    if (tokens[i] != rewarderToken) {
                        trisolarisRouter.swapExactTokensForTokens(rewarderTokenFraction, rewarderAmountsOutMin[i], rewarderTokenRoutes[i], address(this), block.timestamp);
                    }
                }
            }
        }

        uint256[] memory amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amounts[i] = IERC20(tokens[i]).balanceOf(address(this));
        }

        reward = swap.addLiquidity(amounts, 1, block.timestamp);
        uint256 rewardPerDepositAge = reward * fractionMultiplier / (totalDepositAge + totalDeposits * (block.number - totalDepositLastUpdate));
        uint256 cumulativeRewardAgePerDepositAge = distributionInfo[distributionID - 1].cumulativeRewardAgePerDepositAge + rewardPerDepositAge * (block.number - distributionInfo[distributionID - 1].block);
        distributionInfo[distributionID] = DistributionInfo({
            block: block.number,
            rewardPerDepositAge: rewardPerDepositAge,
            cumulativeRewardAgePerDepositAge: cumulativeRewardAgePerDepositAge
        });

        distributionID += 1;
        totalDepositLastUpdate = block.number;
        totalDepositAge = 0;

        MasterChef.deposit(pid, reward, address(this));
    }

    /**
     * @dev Returns total funds staked by the {_address}.
     */
    function userBalance(address _address) external view returns (uint256) {
        return userInfo[_address].stake + userReward(_address);
    }

    /**
     * @dev Returns total funds locked in the farm.
     */
    function getTotalDeposits() external view returns (uint256 _totalDeposits) {
        if (totalDeposits > 0) {
            _totalDeposits = MasterChef.userInfo(pid, address(this)).amount;
        }
    }

    function _updateDeposit(address _address) internal {
        UserInfo storage user = userInfo[_address];
        // Accumulate deposit age within the current distribution period.
        if (user.lastDistribution == distributionID) {
            // Add deposit age from previous deposit age update to now.
            user.depositAge += user.stake * (block.number - user.lastUpdate);
        } else {
            // A reward has been distributed, update user.reward.
            user.reward = userReward(_address);
            // Count fresh deposit age from previous reward distribution to now.
            user.depositAge = user.stake * (block.number - distributionInfo[distributionID - 1].block);
        }

        user.lastDistribution = distributionID;
        user.lastUpdate = block.number;

        // Same with total deposit age.
        totalDepositAge += (block.number - totalDepositLastUpdate) * totalDeposits;
        totalDepositLastUpdate = block.number;
    }

    function userReward(address _address) internal view returns (uint256) {
        UserInfo memory user = userInfo[_address];
        if (user.lastDistribution == distributionID) {
            // Return user.reward if the distribution after the last user deposit did not happen yet.
            return user.reward;
        }
        DistributionInfo memory lastUserDistributionInfo = distributionInfo[user.lastDistribution];
        uint256 userDepositAge = user.depositAge + user.stake * (lastUserDistributionInfo.block - user.lastUpdate);
        // Calculate reward between the last user deposit and the distribution after that.
        uint256 rewardBeforeDistibution = userDepositAge * lastUserDistributionInfo.rewardPerDepositAge / fractionMultiplier;
        // Calculate reward from the distributions that have happened after the last user deposit.
        uint256 rewardAfterDistribution = user.stake * (distributionInfo[distributionID - 1].cumulativeRewardAgePerDepositAge - lastUserDistributionInfo.cumulativeRewardAgePerDepositAge) / fractionMultiplier;
        return user.reward + rewardBeforeDistibution + rewardAfterDistribution;
    }

    /**
     * @dev Utility function used to fill {tokens} array.
     */
    function getTokens(address _swap) internal {
        for (uint8 i = 0; i < type(uint8).max; i++) {
            (bool success, bytes memory data) = _swap.call(abi.encodeWithSignature("getToken(uint8)", i));
            if (success) {
                tokens.push(abi.decode(data, (address)));
                continue;
            }
            break;
        }
        tokensLength = tokens.length;
    }

    /**
     * @dev Get pid and MasterChef version by iterating over all pools and MasterChefs and comparing pids.
     */
    function getPoolId(address _lpPair) internal view returns (uint256 _pid) {
        bool poolExists = false;
        for (uint256 i = 0; i < MasterChef.poolLength(); i++) {
            if (MasterChef.lpToken(i) == _lpPair) {
                _pid = i;
                poolExists = true;
                break;
            }
        }
        require(poolExists, "The pool with the given pair token doesn't exist");
        return _pid;
    }
}
