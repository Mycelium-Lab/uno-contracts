// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmTrisolarisStandard as Farm} from './IUnoFarmTrisolarisStandard.sol'; 
import '../../../interfaces/IUnoAssetRouter.sol';

interface IUnoAssetRouterTrisolarisStandard is IUnoAssetRouter {
    function distribute(
        address lpPair,
        Farm.SwapInfo[4] calldata swapInfos,
        address feeTo
    ) external returns(uint256 reward);
}
