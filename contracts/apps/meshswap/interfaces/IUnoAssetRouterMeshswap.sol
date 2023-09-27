// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IUnoFarmMeshswap as Farm} from './IUnoFarmMeshswap.sol'; 
import '../../../interfaces/IUnoAssetRouter.sol';

interface IUnoAssetRouterMeshswap is IUnoAssetRouter {
    function distribute(
        address lpPair,
        Farm.SwapInfo[2] calldata swapInfos,
        address feeTo
    ) external returns(uint256 reward);
}
