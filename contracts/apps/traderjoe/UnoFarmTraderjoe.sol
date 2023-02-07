// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../../interfaces/IUniswapV2Pair.sol";
import "../../interfaces/IUniswapV2Router.sol";
import "../../interfaces/IMasterChefJoe.sol";
import "../../interfaces/IMasterChefJoeBoost.sol";
import "../../interfaces/IMasterChefJoeV3.sol";
import "../../interfaces/ISimpleRewarder.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract UnoFarmTraderjoe is Initializable, ReentrancyGuardUpgradeable {
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
	 * @dev SwapInfo:
	 * {route} - Array of token addresses describing swap routes.
	 * {amountOutMin} - The minimum amount of output token that must be received for the transaction not to revert.
	 */
	struct SwapInfo {
		address[] route;
		uint256 amountOutMin;
	}
	/**
	 * @dev FeeInfo:
	 * {feeCollector} - Contract to transfer fees to.
	 * {fee} - Fee percentage to collect (10^18 == 100%).
	 */
	struct FeeInfo {
		address feeTo;
		uint256 fee;
	}

	/**
	 * @dev Tokens Used:
	 * {rewardToken} - Token generated by staking (JOE).
	 * {rewarderToken} - Token generated by simpleRewarderTime contract.
	 * {lpPair} - Token that the strategy maximizes. The same token that users deposit in the {MasterChef}.
	 * {tokenA, tokenB} - Tokens that the strategy maximizes.
	 */
	address public rewardToken;
	address public rewarderToken;
	address public lpPair;
	address public tokenA;
	address public tokenB;

	/**
	 * @dev Third Party Contracts:
	 * {traderjoeRouter} - The contract that executes swaps.
	 * {MasterChefBoost} -The contract that distibutes {rewardToken}.
	 * {MasterChefV3} -The contract that distibutes {rewardToken}.
	 */
	IUniswapV2Router01 private constant traderjoeRouter = IUniswapV2Router01(0x60aE616a2155Ee3d9A68541Ba4544862310933d4);
	IMasterChefJoeBoost private constant MasterChefBoost = IMasterChefJoeBoost(0x4483f0b6e2F5486D06958C20f8C39A7aBe87bf8F);
	IMasterChefJoeV3 private constant MasterChefV3 = IMasterChefJoeV3(0x188bED1968b795d5c9022F6a0bb5931Ac4c18F00);

	/**
     * @dev Contract Variables:
     * {pid} - Pool ID.
     * {MasterChef} - MasterChef in use.

     * {totalDeposits} - Total deposits made by users.
     * {totalDepositAge} - Deposits multiplied by blocks the deposit has been in. Flushed every reward distribution.
     * {totalDepositLastUpdate} - Last {totalDepositAge} update block.

     * {distributionID} - Current distribution ID.
     * {userInfo} - Info on each user.
     * {distributionInfo} - Info on each distribution.

     * {fractionMultiplier} - Used to store decimal values.
     */
	uint256 public pid;
	IMasterChefJoe public MasterChef;

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

	function initialize(address _lpPair, address _assetRouter) external initializer {
		require(_lpPair != address(0), "BAD_LP_POOL");
		require(_assetRouter != address(0), "BAD_ASSET_ROUTER");

		__ReentrancyGuard_init();
		assetRouter = _assetRouter;

		(pid, MasterChef) = getPoolInfo(_lpPair);
		lpPair = _lpPair;

		rewardToken = MasterChef.JOE();
		if (address(MasterChef) == address(MasterChefBoost)) {
			address simpleRewarder = MasterChefBoost.poolInfo(pid).rewarder;
			if (simpleRewarder != address(0)) {
				rewarderToken = address(ISimpleRewarder(simpleRewarder).rewardToken());
				IERC20(rewarderToken).approve(address(traderjoeRouter), type(uint256).max);
			}
		} else {
			address simpleRewarder = MasterChefV3.poolInfo(pid).rewarder;
			if (simpleRewarder != address(0)) {
				rewarderToken = address(ISimpleRewarder(simpleRewarder).rewardToken());
				IERC20(rewarderToken).approve(address(traderjoeRouter), type(uint256).max);
			}
		}

		tokenA = IUniswapV2Pair(lpPair).token0();
		tokenB = IUniswapV2Pair(lpPair).token1();

		distributionInfo[0] = DistributionInfo({ block: block.number, rewardPerDepositAge: 0, cumulativeRewardAgePerDepositAge: 0 });
		distributionID = 1;
		totalDepositLastUpdate = block.number;

		IERC20Upgradeable(lpPair).approve(address(MasterChef), type(uint256).max);
		IERC20Upgradeable(lpPair).approve(address(traderjoeRouter), type(uint256).max);
		IERC20Upgradeable(rewardToken).approve(address(traderjoeRouter), type(uint256).max);
		IERC20Upgradeable(tokenA).approve(address(traderjoeRouter), type(uint256).max);
		IERC20Upgradeable(tokenB).approve(address(traderjoeRouter), type(uint256).max);
	}

	/**
	 * @dev Function that makes the deposits.
	 * Stakes {amount} of LP tokens from this contract's balance in the {MasterChef}.
	 */
	function deposit(uint256 amount, address recipient) external nonReentrant onlyAssetRouter{
		require(amount > 0, "NO_LIQUIDITY_PROVIDED");

		_updateDeposit(recipient);
		userInfo[recipient].stake += amount;
		totalDeposits += amount;

		MasterChef.deposit(pid, amount);
	}

	/**
	 * @dev Withdraws funds from {origin} and sends them to the {recipient}.
	 */
	function withdraw(
		uint256 amount,
		address origin,
		address recipient
	) external nonReentrant onlyAssetRouter {
		require(amount > 0, "INSUFFICIENT_AMOUNT");

		_updateDeposit(origin);
		UserInfo storage user = userInfo[origin];
		// Subtract amount from user.reward first, then subtract remainder from user.stake.
		if (amount > user.reward) {
			uint256 balance = user.stake + user.reward;
			require(amount <= balance, "INSUFFICIENT_BALANCE");
			user.stake = balance - amount;
			totalDeposits = totalDeposits + user.reward - amount;
			user.reward = 0;
		} else {
			user.reward -= amount;
		}

		MasterChef.withdraw(pid, amount);
		IERC20Upgradeable(lpPair).safeTransfer(recipient, amount);
	}

	/**
	 * @dev Core function of the strat, in charge of updating, collecting and re-investing rewards.
	 * 1. It claims rewards from the {MasterChef}.
	 * 2. It swaps {rewardToken} token for {tokenA} & {tokenB}.
	 * 3. It deposits new LP tokens back to the {MasterChef}.
	 */
	function distribute(
		SwapInfo[4] calldata swapInfos,
		SwapInfo[2] calldata feeSwapInfo,
		FeeInfo calldata feeInfo
	) external onlyAssetRouter nonReentrant returns (uint256 reward) {
		require(totalDeposits > 0, "NO_LIQUIDITY");
		require(distributionInfo[distributionID - 1].block != block.number, "CANT_CALL_ON_THE_SAME_BLOCK");

		MasterChef.withdraw(pid, 0);

		collectFees(feeSwapInfo[0], feeInfo, IERC20Upgradeable(rewardToken));
		collectFees(feeSwapInfo[1], feeInfo, IERC20Upgradeable(rewarderToken));
		{// scope to avoid stack too deep errors
		uint256 rewardTokenHalf = IERC20(rewardToken).balanceOf(address(this)) / 2;
		uint256 rewarderTokenHalf;
		if (rewarderToken != address(0)) {
			rewarderTokenHalf = IERC20(rewarderToken).balanceOf(address(this)) / 2;
		}
		if (rewardTokenHalf > 0) {
			if (tokenA != rewardToken) {
				address[] calldata route = swapInfos[0].route;
				require(route[0] == rewardToken && route[route.length - 1] == tokenA, "BAD_REWARD_TOKEN_A_ROUTE");
				traderjoeRouter.swapExactTokensForTokens(rewardTokenHalf, swapInfos[0].amountOutMin, route, address(this), block.timestamp);
			}

			if (tokenB != rewardToken) {
				address[] calldata route = swapInfos[1].route;
				require(route[0] == rewardToken && route[route.length - 1] == tokenB, "BAD_REWARD_TOKEN_B_ROUTE");
				traderjoeRouter.swapExactTokensForTokens(rewardTokenHalf, swapInfos[1].amountOutMin, route, address(this), block.timestamp);
			}
		}

		if (rewarderTokenHalf > 0) {
			if (tokenA != rewarderToken) {
				address[] calldata route = swapInfos[2].route;
				require(route[0] == rewarderToken && route[route.length - 1] == tokenA, "BAD_REWARDER_TOKEN_A_ROUTE");
				traderjoeRouter.swapExactTokensForTokens(rewarderTokenHalf, swapInfos[2].amountOutMin, route, address(this), block.timestamp);
			}

			if (tokenB != rewarderToken) {
				address[] calldata route = swapInfos[3].route;
				require(route[0] == rewarderToken && route[route.length - 1] == tokenB, "BAD_REWARDER_TOKEN_B_ROUTE");
				traderjoeRouter.swapExactTokensForTokens(rewarderTokenHalf, swapInfos[3].amountOutMin, route, address(this), block.timestamp);
			}
		}
		}

		(, , reward) = traderjoeRouter.addLiquidity(tokenA, tokenB, IERC20Upgradeable(tokenA).balanceOf(address(this)), IERC20Upgradeable(tokenB).balanceOf(address(this)), swapInfos[0].amountOutMin, swapInfos[1].amountOutMin, address(this), block.timestamp);

		uint256 rewardPerDepositAge = (reward * fractionMultiplier) / (totalDepositAge + totalDeposits * (block.number - totalDepositLastUpdate));
		uint256 cumulativeRewardAgePerDepositAge = distributionInfo[distributionID - 1].cumulativeRewardAgePerDepositAge + rewardPerDepositAge * (block.number - distributionInfo[distributionID - 1].block);

		distributionInfo[distributionID] = DistributionInfo({ block: block.number, rewardPerDepositAge: rewardPerDepositAge, cumulativeRewardAgePerDepositAge: cumulativeRewardAgePerDepositAge });

		distributionID += 1;
		totalDepositLastUpdate = block.number;
		totalDepositAge = 0;

		MasterChef.deposit(pid, reward);
	}

	/**
	 * @dev Swaps and sends fees to feeTo.
	 */
	function collectFees(
		SwapInfo calldata feeSwapInfo,
		FeeInfo calldata feeInfo,
		IERC20Upgradeable token
	) internal {
		if (address(token) != address(0) && feeInfo.feeTo != address(0)) {
			uint256 feeAmount = (token.balanceOf(address(this)) * feeInfo.fee) / fractionMultiplier;
			if (feeAmount > 0) {
				address[] calldata route = feeSwapInfo.route;
				if (route.length > 0 && route[0] != route[route.length - 1]) {
					require(route[0] == address(token), "BAD_FEE_TOKEN_ROUTE");
					traderjoeRouter.swapExactTokensForTokens(feeAmount, feeSwapInfo.amountOutMin, route, feeInfo.feeTo, block.timestamp);
					return;
				}
				token.safeTransfer(feeInfo.feeTo, feeAmount);
			}
		}
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
		uint256 rewardBeforeDistibution = (userDepositAge * lastUserDistributionInfo.rewardPerDepositAge) / fractionMultiplier;
		// Calculate reward from the distributions that have happened after the last user deposit.
		uint256 rewardAfterDistribution = (user.stake * (distributionInfo[distributionID - 1].cumulativeRewardAgePerDepositAge - lastUserDistributionInfo.cumulativeRewardAgePerDepositAge)) / fractionMultiplier;
		return user.reward + rewardBeforeDistibution + rewardAfterDistribution;
	}

	/**
	 * @dev Get pid and MasterChef version by iterating over all pools and MasterChefs and comparing pids.
	 */
	function getPoolInfo(address _lpPair) internal view returns (uint256 _pid, IMasterChefJoe _masterChefAddress) {
		bool poolExists = false;

		// there are more pools assigned to V2, so it makes sense to start with it
		for (uint256 i = 0; i < MasterChefBoost.poolLength(); i++) {
			if (MasterChefBoost.poolInfo(i).lpToken == _lpPair) {
				_pid = i;
				poolExists = true;
				_masterChefAddress = IMasterChefJoe(address(MasterChefBoost));
				break;
			}
		}
		if (!poolExists) {
			for (uint256 i = 0; i < MasterChefV3.poolLength(); i++) {
				if (MasterChefV3.poolInfo(i).lpToken == _lpPair) {
					_pid = i;
					poolExists = true;
					_masterChefAddress = IMasterChefJoe(address(MasterChefV3));
					break;
				}
			}
		}
		require(poolExists, "PID_NOT_EXISTS");
		return (_pid, _masterChefAddress);
	}
}
