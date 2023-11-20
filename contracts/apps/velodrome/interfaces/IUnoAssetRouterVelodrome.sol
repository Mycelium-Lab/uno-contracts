// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IUnoFarmVelodrome as Farm} from './IUnoFarmVelodrome.sol'; 
import '../../../interfaces/IUnoAssetRouter.sol';

interface IUnoAssetRouterVelodrome is IUnoAssetRouter {
	function distribute(
		address lpPair,
		Farm.SwapInfo[2] calldata swapInfos,
		address feeTo
	) external returns(uint256 reward);
}