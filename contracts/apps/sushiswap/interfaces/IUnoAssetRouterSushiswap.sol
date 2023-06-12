// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmSushiswap as Farm} from './IUnoFarmSushiswap.sol'; 
import '../../../interfaces/IUnoAssetRouter.sol';

interface IUnoAssetRouterSushiswap is IUnoAssetRouter {
    function distribute(
        address lpPair,
        Farm.SwapInfo[4] calldata swapInfos,
        Farm.SwapInfo[2] calldata feeSwapInfos,
        address feeTo
    ) external returns(uint256 reward);
}
