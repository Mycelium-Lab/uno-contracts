// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 

interface IUnoAssetRouterSushiswap {
    event Deposit(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(uint256 amountA, uint256 amountB, uint256 amountLP, address lpPair, address recipient) external returns(uint256 sentA, uint256 sentB, uint256 liquidity);
    function withdraw(address lpPair, uint256 amount, bool withdrawLP, address recipient) external returns(uint256 amountA, uint256 amountB);

    function distribute(
        address lpPair,
        address[] calldata rewardTokenToTokenARoute,
        address[] calldata rewardTokenToTokenBRoute, 
        address[] calldata rewarderTokenToTokenARoute,
        address[] calldata rewarderTokenToTokenBRoute,
        uint256[4] memory amountsOutMin
    ) external;

   
    function userStake(address _address, address lpPair) external view returns (uint256 stakeLP, uint256 stakeA, uint256 stakeB);
    function totalDeposits(address lpPair) external view returns (uint256 totalDepositsLP, uint256 totalDepositsA, uint256 totalDepositsB);

    function paused() external view returns(bool);
    function pause() external;
    function unpause() external;

    function upgradeTo(address newImplementation) external;
}
