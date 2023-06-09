// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmMeshswap as Farm} from './IUnoFarmMeshswap.sol'; 
import '../../../interfaces/IUnoAssetRouter.sol';

interface IUnoAssetRouterMeshswap is IUnoAssetRouter {
    function distribute(
        address lpPair,
        Farm.SwapInfo[2] calldata swapInfos,
        Farm.SwapInfo calldata feeSwapInfo,
        address feeTo
    ) external returns(uint256 reward);
}
