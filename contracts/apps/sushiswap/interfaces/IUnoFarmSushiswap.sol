// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

interface IUnoFarmSushiswap {
    function rewardToken() external view returns (address);
    function rewarderToken() external view returns (address);
    function lpPair() external view returns (address);
    function tokenA() external view returns (address);
    function tokenB() external view returns (address);
    function pid() external view returns (uint256);
    function assetRouter() external view returns (address);

    function initialize( address _lpPair, address _assetRouter) external;

    function deposit(uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, uint256 amountLP, address origin, address recipient) external returns(uint256 sentA, uint256 sentB, uint256 liquidity);
    function withdraw(address origin, uint256 amount, uint256 amountAMin, uint256 amountBMin, bool withdrawLP, address recipient) external returns(uint256 amountA, uint256 amountB);

    function distribute(
        address[] calldata rewardTokenToTokenARoute,
        address[] calldata rewardTokenToTokenBRoute, 
        address[] calldata rewarderTokenToTokenARoute,
        address[] calldata rewarderTokenToTokenBRoute,
        uint256[4] memory amountsOutMin
    ) external returns(uint256 reward);

    function userBalance(address _address) external view returns (uint256);
    function getTotalDeposits() external view returns (uint256);
}
