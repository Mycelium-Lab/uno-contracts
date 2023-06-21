// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmTraderjoe as Farm} from './IUnoFarmTraderjoe.sol'; 
import '../../../interfaces/IUnoAssetRouter.sol';

interface IUnoAssetRouterTraderjoe is IUnoAssetRouter {
	function distribute(
		address lpPair,
		Farm.SwapInfo[4] calldata swapInfos,
		address feeTo
	) external returns(uint256 reward);
}