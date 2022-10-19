// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

interface IMasterChefJoeV3 {
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
		returns (IMasterChefJoeV3.PoolInfo memory);

	function poolLength() external view returns (uint256);
}
