// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../../../interfaces/IVault.sol";

interface IUnoFarmBalancer {
    function lpPool() external view returns (address);
    function poolId() external view returns (bytes32);
    function assetRouter() external view returns (address);

    function initialize( address _lpPool, address _assetRouter) external;

    function deposit(uint256[] memory amounts, address[] memory tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external returns(uint256 liquidity);
    function withdraw(uint256 amount, uint256[] calldata minAmountsOut, bool withdrawLP, address origin, address recipient) external;

    function distribute(
        IVault.BatchSwapStep[][] calldata swaps,
        IAsset[][] calldata assets,
        int256[][] calldata limits
    ) external returns(uint256 reward);

    function userBalance(address _address) external view returns (uint256);
    function getTotalDeposits() external view returns (uint256);
    function getTokenStakes(uint256 amountLP) external view returns (uint256[] memory stakes);
}

