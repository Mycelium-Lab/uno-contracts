// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IExchangeMeshwap {
	function claimReward() external;

	function mesh() external view returns (address);
}
