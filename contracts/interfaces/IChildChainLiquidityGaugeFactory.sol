// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IChildChainLiquidityGaugeFactory {
    function getPoolGauge(address) external view returns (address);
    function getPoolStreamer(address) external view returns (address);
    function create(address pool) external returns (address);
}