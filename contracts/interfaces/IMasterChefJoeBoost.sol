// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

interface IMasterChefJoeBoost {
	struct PoolInfo {
		// Address are stored in 160 bits, so we store allocPoint in 96 bits to
		// optimize storage (160 + 96 = 256)
		address lpToken;
		uint96 allocPoint;
		uint256 accJoePerShare;
		uint256 accJoePerFactorPerShare;
		// Address are stored in 160 bits, so we store lastRewardTimestamp in 64 bits and
		// veJoeShareBp in 32 bits to optimize storage (160 + 64 + 32 = 256)
		uint64 lastRewardTimestamp;
		address rewarder;
		// Share of the reward to distribute to veJoe holders
		uint32 veJoeShareBp;
		// The sum of all veJoe held by users participating in this farm
		// This value is updated when
		// - A user enter/leaves a farm
		// - A user claims veJOE
		// - A user unstakes JOE
		uint256 totalFactor;
		// The total LP supply of the farm
		// This is the sum of all users boosted amounts in the farm. Updated when
		// someone deposits or withdraws.
		// This is used instead of the usual `lpToken.balanceOf(address(this))` for security reasons
		uint256 totalLpSupply;
	}

	function poolInfo(uint256 pid)
		external
		view
		returns (IMasterChefJoeBoost.PoolInfo memory);

	function poolLength() external view returns (uint256);
}
