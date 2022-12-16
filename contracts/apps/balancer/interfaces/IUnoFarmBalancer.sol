// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import "../../../interfaces/IVault.sol";

interface IUnoFarmBalancer { 
    struct FeeInfo {
        address feeCollector;
        uint256 fee;
    }
    struct SwapInfo{
        IVault.BatchSwapStep[] swaps;
        IERC20[] assets;
        int256[] limits;
    }

    function lpPool() external view returns (address);
    function poolId() external view returns (bytes32);
    function assetRouter() external view returns (address);

    function initialize( address _lpPool, address _assetRouter) external;

    function deposit(uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external returns(uint256 liquidity);
    function withdraw(bytes calldata userData, uint256[] calldata minAmountsOut, bool withdrawLP, address origin, address recipient) external returns(uint256[] memory amounts, uint256 liquidity);

    function distribute(
        SwapInfo[] calldata swapInfos,
        SwapInfo[] calldata feeSwapInfos,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);

    function userBalance(address _address) external view returns (uint256);
    function getTotalDeposits() external view returns (uint256);
}

