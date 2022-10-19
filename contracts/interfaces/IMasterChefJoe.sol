// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

interface IMasterChefJoe {
	struct UserInfo {
		uint256 amount; // How many LP tokens the user has provided.
		uint256 rewardDebt; // Reward debt. See explanation below.
	}
	struct PoolInfo {
		address lpToken;
		uint256 accJoePerShare;
		uint256 lastRewardTimestamp;
		uint256 allocPoint;
		address rewarder;
	}

	function poolInfo(uint256 pid)
		external
		view
		returns (IMasterChefJoe.PoolInfo memory);

	function userInfo(uint256 _pid, address _user)
		external
		view
		returns (IMasterChefJoe.UserInfo memory);

	function JOE() external view returns (address);

	function joePerSec() external view returns (uint256);

	function deposit(uint256 _pid, uint256 _amount) external;

	function withdraw(uint256 _pid, uint256 _amount) external;

	function poolLength() external view returns (uint256);
}
