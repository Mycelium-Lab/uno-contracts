// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';
import "../../../interfaces/IMasterChefJoe.sol";

interface IUnoFarmTraderjoe is IUnoFarm {
	error PID_NOT_EXISTS();
	function pid() external returns (uint256);
	function MasterChef() external returns (IMasterChefJoe);
	function distribute(
		SwapInfo[4] calldata swapInfos,
		SwapInfo[2] calldata feeSwapInfo,
		FeeInfo calldata feeInfo
	) external returns (uint256 reward);
}