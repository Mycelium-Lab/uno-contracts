
// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import './IUnoFarmFactory.sol';
import './IUnoAccessManager.sol'; 
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IUnoAssetRouter {
    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    event FeeChanged(uint256 previousFee, uint256 newFee);

    error ETH_DEPOSIT_REJECTED();
    error CALLER_NOT_AUTHORIZED();
    error FARM_NOT_EXISTS();
    error NOT_ETH_FARM();
    error INVALID_MSG_VALUE();
    error INVALID_SWAP_DESCRIPTION();
    error INVALID_ACCESS_MANAGER();
    error INVALID_FARM_FACTORY();
    error SWAP_NOT_SUCCESSFUL();
    error TRANSFER_NOT_SUCCESSFUL();
    error INSUFFICIENT_AMOUNT();
    error NO_TOKENS_SENT();
    error MAX_FEE_EXCEEDED(uint256 maxFee);

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);
    function fee() external view returns(uint256);
    function WETH() external view returns(address);

    function deposit(address lpPair, uint256 amountA, uint256 amountB, uint256 amountAMin, uint256 amountBMin, address recipient) external returns(uint256 sentA, uint256 sentB, uint256 liquidity);
    function depositETH(address lpPair, uint256 amountToken, uint256 amountTokenMin, uint256 amountETHMin, address recipient) external payable returns(uint256 sentToken, uint256 sentETH, uint256 liquidity);
    function depositWithSwap(address lpPair, bytes[2] calldata swapData, address recipient) external payable returns(uint256 sent0, uint256 sent1, uint256 dustA, uint256 dustB, uint256 liquidity);
    function depositLP(address lpPair, uint256 amount, address recipient) external;

    function withdraw(address lpPair, uint256 amount, uint256 amountAMin, uint256 amountBMin, address recipient) external returns(uint256 amountA, uint256 amountB);
    function withdrawETH(address lpPair, uint256 amount, uint256 amountTokenMin, uint256 amountETHMin, address recipient) external returns(uint256 amountToken, uint256 amountETH);
    function withdrawWithSwap(address lpPair, uint256 amount, bytes[2] calldata swapData, address recipient) external returns(uint256 amount0, uint256 amount1, uint256 amountA, uint256 amountB);
    function withdrawLP(address lpPair, uint256 amount, address recipient) external;

    function initialize(address _accessManager, address _farmFactory) external;

    function userStake(address _address, address lpPair) external view returns (uint256 stakeLP, uint256 stakeA, uint256 stakeB);
    function totalDeposits(address lpPair) external view returns (uint256 totalDepositsLP, uint256 totalDepositsA, uint256 totalDepositsB);
    function getTokens(address lpPair) external view returns(IERC20[] memory tokens);

    function setFee(uint256 _fee) external;

    function pause() external;
    function unpause() external;
}
