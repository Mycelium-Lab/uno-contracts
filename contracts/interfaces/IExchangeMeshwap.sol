// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./IUniswapV2Pair.sol";

interface IExchangeMeshwap is IUniswapV2Pair {
	function claimReward() external;

	function mesh() external view returns (address);
}
