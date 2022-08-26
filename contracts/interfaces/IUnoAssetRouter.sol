// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import './IUnoFarmFactory.sol';
import './IUnoAccessManager.sol'; 
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";


interface IUnoAssetRouter {
    event Deposit(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount); 
    event Withdraw(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount); 
    event Distribute(address indexed lpPool, uint256 reward); 

    function farmFactory() external view returns(IUnoFarmFactory); // UNISWAP
    function accessManager() external view returns(IUnoAccessManager); // UNISWAP

    function initialize(address _accessManager, address _farmFactory) external; 

    function deposit(address lpPool, uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, uint256 amountLP, address recipient) external returns(uint256 sentA, uint256 sentB, uint256 liquidity); // UNISWAP
    function withdraw(address lpPool, uint256 amount, uint256 amountAMin, uint256 amountBMin, bool withdrawLP, address recipient) external returns(uint256 amountA, uint256 amountB); // UNISWAP

    function deposit(address lpPool, uint256[] memory amounts, address[] memory tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external returns(uint256 liquidity); // BALANCER
    function withdraw(address lpPool, uint256 amount, uint256[] calldata minAmountsOut, bool withdrawLP, address recipient) external; // BALANCER

    function getTokens(address lpPool) external view returns(IERC20Upgradeable[] memory tokens); 

    function userStake(address _address, address lpPool) external view returns (uint256 stakeLP, uint256 stakeA, uint256 stakeB); // UNISWAP
    function totalDeposits(address lpPool) external view returns (uint256 totalDepositsLP, uint256 totalDepositsA, uint256 totalDepositsB);

    function paused() external view returns(bool); 
    function pause() external; 
    function unpause() external; 

    function upgradeTo(address newImplementation) external; 
}
