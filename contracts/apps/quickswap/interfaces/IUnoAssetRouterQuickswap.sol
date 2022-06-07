// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 

interface IUnoAssetRouterQuickswap {
    event Deposit(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address lpStakingPool, uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, uint256 amountLP, address recipient) external returns(uint256 sentA, uint256 sentB, uint256 liquidity);
    function withdraw(address lpStakingPool, uint256 amount, uint256 amountAMin, uint256 amountBMin, bool withdrawLP, address recipient) external returns(uint256 amountA, uint256 amountB);

    function distribute(
        address lpStakingPool,
        address[] calldata rewardTokenToTokenARoute, 
        address[] calldata rewardTokenToTokenBRoute, 
        uint256[2] memory amountsOutMin
    ) external;

   
    function userStake(address _address, address lpStakingPool) external view returns (uint256 stakeLP, uint256 stakeA, uint256 stakeB);
    function totalDeposits(address lpStakingPool) external view returns (uint256 totalDepositsLP, uint256 totalDepositsA, uint256 totalDepositsB);
    function getTokens(address lpStakingPool) external view returns(address tokenA, address tokenB);

    function paused() external view returns(bool);
    function pause() external;
    function unpause() external;

    function upgradeTo(address newImplementation) external;
}
