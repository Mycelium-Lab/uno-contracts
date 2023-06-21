// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';

interface IUnoFarmQuickswapDual is IUnoFarm {

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
    function rewardTokenA() external view returns(address);
    function rewardTokenB() external view returns(address);

    function distribute(
        SwapInfo[4] calldata swapInfos,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
}
