// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmApeswap as Farm} from './IUnoFarmApeswap.sol'; 
import '../../../interfaces/IUnoAssetRouter.sol';
import "../../../interfaces/IUniswapV2Router.sol";

interface IUnoAssetRouterApeswap is IUnoAssetRouter {
    function ApeswapRouter() external view returns(IUniswapV2Router01);
    
    function distribute(
        address lpPair,
        Farm.SwapInfo[4] calldata swapInfos,
        Farm.SwapInfo[2] calldata feeSwapInfos,
        address feeTo
    ) external;
}
