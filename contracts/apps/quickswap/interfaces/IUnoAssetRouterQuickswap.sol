// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmQuickswap as Farm} from './IUnoFarmQuickswap.sol'; 
import '../../../interfaces/IUnoAssetRouter.sol';

interface IUnoAssetRouterQuickswap is IUnoAssetRouter {
    function distribute(
        address lpStakingPool,
        Farm.SwapInfo[2] calldata swapInfos,
        address feeTo
    ) external returns(uint256 reward);
}
