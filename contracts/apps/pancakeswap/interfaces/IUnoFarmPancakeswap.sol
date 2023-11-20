// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import '../../../interfaces/IUnoFarm.sol';

interface IUnoFarmPancakeswap is IUnoFarm {
    error PID_NOT_EXISTS();

    function pid() external view returns (uint256);
    
    function distribute(
        SwapInfo[2] calldata swapInfos,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
}
