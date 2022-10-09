// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingDualRewards {
	// Views
	function dualRewardsDistribution() external view returns (address);

	function lastTimeRewardApplicable() external view returns (uint256);

	function stakingToken() external view returns (IERC20);

	function rewardsTokenA() external view returns (address);

	function rewardsTokenB() external view returns (address);

	function rewardPerTokenA() external view returns (uint256);

	function rewardPerTokenB() external view returns (uint256);

	function rewardRateA() external view returns (uint256);

	function rewardRateB() external view returns (uint256);

	function earnedA(address account) external view returns (uint256);

	function earnedB(address account) external view returns (uint256);

	function totalSupply() external view returns (uint256);

	function balanceOf(address account) external view returns (uint256);

	// Mutative

	function stake(uint256 amount) external;

	function withdraw(uint256 amount) external;

	function getReward() external;

	function exit() external;
}
