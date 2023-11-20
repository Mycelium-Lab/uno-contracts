// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import '../../../interfaces/IUnoFarm.sol';

interface IUnoFarmMeshswap is IUnoFarm {
    /**
     * @dev SwapInfo:
     * {route} - Array of token addresses describing swap routes.
     * {amountOutMin} - The minimum amount of output token that must be received for the transaction not to revert.
     */
    struct SwapInfo{
        address[] route;
        uint256 amountOutMin;
    }

    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function rewardToken() external view returns (address);
    function distribute(
        SwapInfo[2] calldata swapInfos,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
}
