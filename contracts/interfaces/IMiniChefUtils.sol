// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
interface IMiniChefUtils {
    function getPid(address lpPair) external view returns (uint256 pid);
}