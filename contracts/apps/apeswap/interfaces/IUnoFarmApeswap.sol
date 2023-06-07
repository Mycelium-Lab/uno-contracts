// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarm.sol';

interface IUnoFarmApeswap is IUnoFarm {
    function rewarderToken() external view returns (address);
    function pid() external view returns (uint256);
}
