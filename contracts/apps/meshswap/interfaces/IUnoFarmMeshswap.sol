// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';

interface IUnoFarmMeshswap is IUnoFarm {
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function rewardToken() external view returns (address);
    function distribute(
        SwapInfo[2] calldata swapInfos,
        SwapInfo calldata feeSwapInfo,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
}
