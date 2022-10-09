// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;
pragma experimental ABIEncoderV2;

interface IMiniChefV2 {
	struct UserInfo {
		uint256 amount;
		uint256 rewardDebt;
	}

	struct PoolInfo {
		uint128 accSushiPerShare;
		uint64 lastRewardTime;
		uint64 allocPoint;
	}

	function SUSHI() external view returns (address);

	function totalAllocPoint() external view returns (uint256);

	function sushiPerSecond() external view returns (uint256);

	function rewarder(uint256 pid) external view returns (address);

	function poolInfo(uint256 pid) external view returns (PoolInfo memory);

	function poolLength() external view returns (uint256);

	function updatePool(uint256 pid) external returns (PoolInfo memory);

	function userInfo(uint256 _pid, address _user)
		external
		view
		returns (uint256, uint256);

	function deposit(
		uint256 pid,
		uint256 amount,
		address to
	) external;

	function withdraw(
		uint256 pid,
		uint256 amount,
		address to
	) external;

	function harvest(uint256 pid, address to) external;

	function withdrawAndHarvest(
		uint256 pid,
		uint256 amount,
		address to
	) external;

	function emergencyWithdraw(uint256 pid, address to) external;

	function lpToken(uint256 _pid) external view returns (address);

	function pendingSushi(uint256 _pid, address _user)
		external
		view
		returns (uint256);

	function setSushiPerSecond(uint256) external view;
}
