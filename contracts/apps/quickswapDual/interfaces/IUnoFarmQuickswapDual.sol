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
        address[] calldata rewardTokenBToTokenBRoute
    ) external returns(uint256 reward);
    
    function setExpectedReward(uint256 _amount, uint256 _block) external;

    function userBalance(address _address) external view returns (uint256);
    function totalDeposits() external view returns (uint256);
}
