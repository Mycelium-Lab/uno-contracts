// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISimpleRewarder {
	function rewardToken() external view returns (IERC20);

	function lpToken() external view returns (IERC20);

	function MCV2() external view returns (address);

	/// @notice Info of each MCV2 user.
	/// `amount` LP token amount the user has provided.
	/// `rewardDebt` The amount of TRI entitled to the user.
	struct UserInfo {
		uint256 amount;
		uint256 rewardDebt;
	}

	/// @notice Info of each MCV2 poolInfo.
	/// `accTokenPerShare` Amount of rewardTokens each LP token is worth.
	/// `lastRewardBlock` The last block rewards were rewarded to the poolInfo.
	struct PoolInfo {
		uint256 accTokenPerShare;
		uint256 lastRewardBlock;
	}

	/// @notice Info of the poolInfo.
	function poolInfo(uint256 pid)
		external
		view
		returns (ISimpleRewarder.PoolInfo memory);

	/// @notice Info of each user that stakes LP tokens.
	function userInfo(uint256 arg1, address arg2)
		external
		view
		returns (ISimpleRewarder.UserInfo memory);

	event OnReward(address indexed user, uint256 amount);
	event RewardRateUpdated(uint256 oldRate, uint256 newRate);
	event AllocPointUpdated(uint256 oldAllocPoint, uint256 newAllocPoint);

	/// @notice Update reward variables of the given poolInfo.
	/// @return pool Returns the pool that was updated.
	function updatePool() external returns (PoolInfo memory pool);

	function onTriReward(
		uint256 pid,
		address user,
		address recipient,
		uint256 triAmount,
		uint256 newLpAmount
	) external;

	function pendingTokens(
		uint256 pid,
		address user,
		uint256 triAmount
	) external view returns (IERC20[] memory, uint256[] memory);
}
