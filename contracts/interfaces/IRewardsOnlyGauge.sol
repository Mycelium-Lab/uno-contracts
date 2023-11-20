// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IRewardsOnlyGauge {
    function deposit(uint256 _value) external;
    function withdraw(uint256 _value) external;
    function claim_rewards() external;
    function balanceOf(address) external view returns(uint256);
}