// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

interface IUnoAssetRouter {
    function initialize(address _accessManager, address _farmFactory) external;
}
