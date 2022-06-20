// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IUnoFarmTrisolarisStable {
    struct DistributionInfo {
        uint256 _block;
        uint256 rewardPerDepositAge;
        uint256 cumulativeRewardAgePerDepositAge;
    }

    struct UserInfo {
        uint256 stake;
        uint256 depositAge;
        uint256 reward;
        uint32 lastDistribution;
        uint256 lastUpdate;
    }

    function rewardToken() external view returns (address);

    function rewarderToken() external view returns (address);

    function lpPair() external view returns (address);

    function tokenA() external view returns (address);

    function tokenB() external view returns (address);

    function pid() external view returns (uint256);

    function assetRouter() external view returns (address);

    function initialize(address _swap, address _assetRouter) external;

    function deposit(
        uint256[] memory amounts,
        uint256 minAamountToMint,
        uint256 amountLP,
        address recipient
    ) external returns (uint256 liquidity);

    function withdraw(
        uint256 amount,
        uint256[] memory minAmounts,
        bool withdrawLP,
        address origin,
        address recipient
    ) external returns (uint256[] memory amountsWitdrawn);

    function distribute(
        address[][] calldata _rewarderTokenRoutes,
        address[][] calldata _rewardTokenRoutes,
        uint256[] calldata rewarderAmountsOutMin,
        uint256[] calldata rewardAmountsOutMin
    ) external returns (uint256 reward);

    function userBalance(address _address) external view returns (uint256);

    function getTotalDeposits() external view returns (uint256);
}
