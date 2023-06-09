// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';

interface IUnoFarmQuickswap is IUnoFarm{
    function rewardToken() external view returns (address);
    function distribute(
        SwapInfo[2] calldata swapInfos,
        SwapInfo calldata feeSwapInfo,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
}
