// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';

interface IUnoFarmApeswap is IUnoFarm {
    error PID_NOT_EXISTS();

    function rewarderToken() external view returns (address);
    function pid() external view returns (uint256);
}
