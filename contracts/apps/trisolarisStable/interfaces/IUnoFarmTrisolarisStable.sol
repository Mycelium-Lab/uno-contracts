// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IUnoFarmTrisolarisStable {
    struct SwapInfo{
        address[] route;
        uint256 amountOutMin;
    }
    struct FeeInfo {
        address feeTo;
        uint256 fee;
    }
    function rewardToken() external view returns (address);
    function rewarderToken() external view returns (address);
    function lpPair() external view returns (address);
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function pid() external view returns (uint256);
    function assetRouter() external view returns (address);
    function tokens(uint256) external view returns (address);
    function tokensLength() external view returns(uint256);

    function initialize(address _swap, address _assetRouter) external;

    function deposit(
        uint256[] memory amounts,
        uint256 minAmountLP,
        uint256 amountLP,
        address recipient
    ) external returns (uint256 liquidity);

    function withdraw(
        uint256 amount,
        uint256[] memory minAmounts,
        bool withdrawLP,
        address origin,
        address recipient
    ) external returns (uint256[] memory amounts);

    function distribute(
        SwapInfo[] calldata rewardSwapInfos,
        SwapInfo[] calldata rewarderSwapInfos,
        SwapInfo[2] calldata feeSwapInfos,
        FeeInfo calldata feeInfo
    ) external returns (uint256 reward);

    function userBalance(address _address) external view returns (uint256);
    function getTotalDeposits() external view returns (uint256);
}
