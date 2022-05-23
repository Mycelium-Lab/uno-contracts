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

    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address recipient) external returns(uint256 sentA, uint256 sentB, uint256 liquidity);
    function withdraw(address origin, uint256 amount, bool withdrawLP, address recipient) external returns(uint256 amountA, uint256 amountB);

    function distribute(
        address[] calldata rewarderTokenToTokenARoute,
        address[] calldata rewarderTokenToTokenBRoute,
        address[] calldata rewardTokenToTokenARoute,
        address[] calldata rewardTokenToTokenBRoute
    ) external returns(uint256 reward);
    
    function setExpectedReward(uint256 _amount, uint256 _block) external;

    function userBalance(address _address) external view returns (uint256);
    function totalDeposits() external view returns (uint256);
}
