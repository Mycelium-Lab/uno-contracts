// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmQuickswapDual as Farm} from './IUnoFarmQuickswapDual.sol'; 
import '../../../interfaces/IUnoAssetRouter.sol';

interface IUnoAssetRouterQuickswapDual is IUnoAssetRouter {
    function distribute(
        address lpStakingPool,
        Farm.SwapInfo[4] calldata swapInfos,
        Farm.SwapInfo[2] calldata feeSwapInfos,
        address feeTo
    ) external returns(uint256 reward);
}
