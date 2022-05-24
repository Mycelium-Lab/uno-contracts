// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../../../interfaces/IVault.sol";

interface IUnoFarmBalancer {
    function lpPair() external view returns (address);
    function poolId() external view returns (bytes32);
    function assetRouter() external view returns (address);

    function initialize( address _lpPair, address _assetRouter) external;

    function deposit(uint256[] memory amounts, address[] memory tokens, uint256 amountLP, address recipient) external returns(uint256 liquidity);
    function withdraw(address origin, uint256 amount, bool withdrawLP, address recipient) external;

    function distribute(
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        int256[][] memory limits
    ) external returns(uint256 reward);
    
    function setExpectedReward(uint256 _amount, uint256 _block) external;

    function userBalance(address _address) external view returns (uint256);
    function totalDeposits() external view returns (uint256);
}

