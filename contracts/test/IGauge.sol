// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

interface IGauge {
    function claimable_reward_write(address _addr, address _token) external returns(uint256);
}