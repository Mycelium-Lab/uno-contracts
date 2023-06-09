// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';

interface IUnoFarmSushiswap is IUnoFarm{
    error PID_NOT_EXISTS();

    function rewardToken() external view returns (address);
    function rewarderToken() external view returns (address);
    function pid() external view returns (uint256);

    function distribute(
        SwapInfo[4] calldata swapInfos,
        SwapInfo[2] calldata feeSwapInfos,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
}
