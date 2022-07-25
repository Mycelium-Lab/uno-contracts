// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IStakingRewardsFactory {
    function update(address stakingToken, uint rewardAmount, uint256 rewardsDuration) external;  
    function notifyRewardAmount(address stakingToken) external;
}