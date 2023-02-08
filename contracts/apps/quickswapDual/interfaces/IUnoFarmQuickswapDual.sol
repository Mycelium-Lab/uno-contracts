// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IUnoFarmQuickswapDual {
    struct SwapInfo{
        address[] route;
        uint256 amountOutMin;
    }
    struct FeeInfo {
        address feeTo;
        uint256 fee;
    }

    function rewardTokenA() external view returns (address);
    function rewardTokenB() external view returns (address);
    function lpPair() external view returns (address);
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function assetRouter() external view returns (address);

    function initialize( address _lpStakingPool, address _assetRouter) external;
    
    function deposit(uint256 amount, address recipient) external;
    function withdraw(uint256 amount, address origin, address recipient) external;

    function distribute(
        SwapInfo[4] calldata swapInfos,
        SwapInfo[2] calldata feeSwapInfos,
        FeeInfo calldata feeInfo
    ) external returns(uint256 reward);
    
    function userBalance(address _address) external view returns (uint256);
    function getTotalDeposits() external view returns (uint256);
}
