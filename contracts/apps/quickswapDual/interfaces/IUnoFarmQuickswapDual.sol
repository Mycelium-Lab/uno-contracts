// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IUnoFarmQuickswapDual {
    function rewardTokenA() external view returns (address);
    function rewardTokenB() external view returns (address);
    function lpPair() external view returns (address);
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function assetRouter() external view returns (address);

    function initialize( address _lpStakingPool, address _assetRouter) external;

    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address recipient) external returns(uint256 sentA, uint256 sentB, uint256 liquidity);
    function withdraw(address origin, uint256 amount, bool withdrawLP, address recipient) external returns(uint256 amountA, uint256 amountB);

    function distribute(
        address[] calldata rewardTokenAToTokenARoute,
        address[] calldata rewardTokenAToTokenBRoute,
        address[] calldata rewardTokenBToTokenARoute,
        address[] calldata rewardTokenBToTokenBRoute,
        uint256[4] memory amountsOutMin
    ) external returns(uint256 reward);
    
    function userBalance(address _address) external view returns (uint256);
    function getTotalDeposits() external view returns (uint256);
}
