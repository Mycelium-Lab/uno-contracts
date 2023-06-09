// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';

interface IUnoFarmQuickswapDual is IUnoFarm {
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function rewardTokenA() external view returns(address);
    function rewardTokenB() external view returns(address);

    function distribute(
        SwapInfo[4] calldata swapInfos,
        SwapInfo[2] calldata feeSwapInfos,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
}
