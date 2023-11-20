// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IStakingDualRewardsFactory {
    function update(address stakingToken, uint rewardAmountA, uint rewardAmountB, uint256 rewardsDuration) external;
    function notifyRewardAmount(address stakingToken) external;
}