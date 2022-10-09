// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IStakingRewardsFactory {
	function update(
		address stakingToken,
		uint256 rewardAmount,
		uint256 rewardsDuration
	) external;

	function notifyRewardAmount(address stakingToken) external;
}
