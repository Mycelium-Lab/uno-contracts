// SPDX-License-Identifier: MIT
pragma solidity 0.8.19; 

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
interface IRewarder {
    function pendingTokens(uint256 pid, address user, uint256 sushiAmount) external view returns (IERC20[] memory, uint256[] memory);
    function setRewardPerSecond(uint256) external view; 
}