// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import './interfaces/IUnoFarmMeshswap.sol';
import "../../interfaces/IUniswapV2Router.sol";
import "../../interfaces/IExchangeMeshwap.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract UnoFarmMeshswap is Initializable, ReentrancyGuardUpgradeable, IUnoFarmMeshswap  {
    using SafeERC20 for IERC20;
	/**
	 * @dev Tokens Used:
	 * {rewardToken} - Token generated by staking (MESH).
	 * {rewarderToken} - Token generated by ComplexRewarderTime contract.
	 * {lpPair} - Token that the strategy maximizes.
	 * {tokenA, tokenB} - Tokens that the strategy maximizes.
	 */
	address public rewardToken;
	address public lpPair;
	address public tokenA;
	address public tokenB;

	/**
	 * @dev Third Party Contracts:
	 * {MeshswapRouter} - The contract that executes swaps.
	 */
	IUniswapV2Router01 private constant MeshswapRouter = IUniswapV2Router01(0x10f4A785F458Bc144e3706575924889954946639);

	/**
     * @dev Contract Variables:

     * {totalDeposits} - Total deposits made by users.
     * {totalDepositAge} - Deposits multiplied by blocks the deposit has been in. Flushed every reward distribution.
     * {totalDepositLastUpdate} - Last {totalDepositAge} update block.

     * {distributionID} - Current distribution ID.
     * {userInfo} - Info on each user.
     * {distributionInfo} - Info on each distribution.

     * {fractionMultiplier} - Used to store decimal values.
     */
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
		if(msg.sender != assetRouter) revert CALLER_NOT_ASSET_ROUTER();
		_;
	}

	// ============ Methods ============

	function initialize(address _lpPair, address _assetRouter) external initializer {
        if(_lpPair == address(0)) revert INVALID_LP_POOL();
        if(_assetRouter == address(0)) revert INVALID_ASSET_ROUTER();

		__ReentrancyGuard_init();
		assetRouter = _assetRouter;

		lpPair = _lpPair;

		rewardToken = IExchangeMeshwap(_lpPair).mesh();
		tokenA = IExchangeMeshwap(lpPair).token0();
		tokenB = IExchangeMeshwap(lpPair).token1();

		distributionInfo[0] = DistributionInfo({
			block: block.number,
			rewardPerDepositAge: 0,
			cumulativeRewardAgePerDepositAge: 0
		});
		distributionID = 1;
		totalDepositLastUpdate = block.number;

		IERC20(lpPair).approve(address(MeshswapRouter), type(uint256).max);
		IERC20(rewardToken).approve(address(MeshswapRouter), type(uint256).max);
		IERC20(tokenA).approve(address(MeshswapRouter), type(uint256).max);
		IERC20(tokenB).approve(address(MeshswapRouter), type(uint256).max);
	}

	/**
	 * @dev Function that makes the deposits.
	 * Stakes {amount} of LP tokens from this contract's balance .
	 */
	function deposit(uint256 amount, address recipient) external nonReentrant onlyAssetRouter{
        if(amount == 0) revert NO_LIQUIDITY_PROVIDED();

        _updateDeposit(recipient);
        userInfo[recipient].stake += amount;
        totalDeposits += amount;
	}

	/**
     * @dev Withdraws funds from {origin} and sends them to the {recipient}.
     */
    function withdraw(uint256 amount, address origin, address recipient) external nonReentrant onlyAssetRouter{
        if(amount == 0) revert INSUFFICIENT_AMOUNT();

        _updateDeposit(origin);
        UserInfo storage user = userInfo[origin];
        // Subtract amount from user.reward first, then subtract remainder from user.stake.
        if(amount > user.reward){
            uint256 balance = user.stake + user.reward;
            if(amount > balance) revert INSUFFICIENT_BALANCE();
			
            user.stake = balance - amount;
            totalDeposits = totalDeposits + user.reward - amount;
            user.reward = 0;
        } else {
            user.reward -= amount;
        }

		IERC20(lpPair).safeTransfer(recipient, amount);
    }

	/**
	 * @dev Core function of the strat, in charge of updating, collecting and re-investing rewards.
	 * 1. It claims rewards from the {IExchangeMeshwap}.
	 * 2. It swaps {rewardToken} token for {tokenA} & {tokenB}.
	 * 3. It deposits new LP tokens back to the {IExchangeMeshwap}.
	 */
	function distribute(
		SwapInfo[2] calldata swapInfos,
		SwapInfo calldata feeSwapInfo,
		FeeInfo calldata feeInfo
	) external onlyAssetRouter nonReentrant returns (uint256 reward) {
        if(totalDeposits == 0) revert NO_LIQUIDITY();
		if(distributionInfo[distributionID - 1].block == block.number) revert CALL_ON_THE_SAME_BLOCK();

		IExchangeMeshwap(lpPair).claimReward();

		_collectFees(feeSwapInfo, feeInfo);
		uint256 rewardTokenHalf = IERC20(rewardToken).balanceOf(address(this)) / 2;
		if (tokenA != rewardToken) {
			address[] calldata route = swapInfos[0].route;
			if(route[0] != rewardToken || route[route.length - 1] != tokenA) revert INVALID_ROUTE(rewardToken, tokenA);
			MeshswapRouter.swapExactTokensForTokens(rewardTokenHalf, swapInfos[0].amountOutMin, route, address(this), block.timestamp);
		}

		if (tokenB != rewardToken) {
			address[] calldata route = swapInfos[1].route;
 			if(route[0] != rewardToken || route[route.length - 1] != tokenB) revert INVALID_ROUTE(rewardToken, tokenB);
			MeshswapRouter.swapExactTokensForTokens(rewardTokenHalf, swapInfos[1].amountOutMin, route, address(this), block.timestamp);
		}

		(,,reward) = MeshswapRouter.addLiquidity(tokenA, tokenB, IERC20(tokenA).balanceOf(address(this)), IERC20(tokenB).balanceOf(address(this)), swapInfos[0].amountOutMin, swapInfos[1].amountOutMin, address(this), block.timestamp);

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
	}

	/**
	 * @dev Swaps and sends fees to feeTo.
	 */
	function _collectFees(SwapInfo calldata feeSwapInfo, FeeInfo calldata feeInfo) internal {
		if (feeInfo.feeTo != address(0)) {
			uint256 feeAmount = IERC20(rewardToken).balanceOf(address(this)) * feeInfo.fee / fractionMultiplier;
			if (feeAmount > 0) {
				address[] calldata route = feeSwapInfo.route;
				if (route.length > 0 && route[0] != route[route.length - 1]) {
					if(route[0] != rewardToken) revert INVALID_FEE_ROUTE(rewardToken);
					MeshswapRouter.swapExactTokensForTokens(feeAmount, feeSwapInfo.amountOutMin, route, feeInfo.feeTo, block.timestamp);
					return;
				}
				IERC20(rewardToken).safeTransfer(feeInfo.feeTo, feeAmount);
			}
		}
	}

	/**
	 * @dev Returns total funds staked by the {_address}.
	 */
	function userBalance(address _address) external view returns (uint256) {
		return userInfo[_address].stake + _userReward(_address);
	}

	/**
	 * @dev Returns total funds locked in the farm.
	 */
	function getTotalDeposits() external view returns (uint256 _totalDeposits) {
		if (totalDeposits > 0) {
			_totalDeposits = IExchangeMeshwap(lpPair).balanceOf(address(this));
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
			user.reward = _userReward(_address);
			// Count fresh deposit age from previous reward distribution to now.
			user.depositAge = user.stake * (block.number - distributionInfo[distributionID - 1].block);
		}

		user.lastDistribution = distributionID;
		user.lastUpdate = block.number;

		// Same with total deposit age.
		totalDepositAge += (block.number - totalDepositLastUpdate) * totalDeposits;
		totalDepositLastUpdate = block.number;
	}

    function _userReward(address _address) internal view returns (uint256) {
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
}
