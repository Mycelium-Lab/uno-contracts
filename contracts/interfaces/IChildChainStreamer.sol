// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IChildChainStreamer {
    function reward_count() external view returns(uint256);
    function reward_tokens(uint256) external view returns(address);
}