// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmBalancer as Farm} from './IUnoFarmBalancer.sol'; 
import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 
import '../../../interfaces/IVault.sol';

//Balancer has a completely different structure, so I can't inherit IUnoAssetRouter.sol
interface IUnoAssetRouterBalancer {
    event Deposit(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed sender, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);
    
    event FeeChanged(uint256 previousFee, uint256 newFee);

    error CALLER_NOT_AUTHORIZED();
    error INVALID_ACCESS_MANAGER();
    error INVALID_FARM_FACTORY();
    error INVALID_MSG_VALUE();
    error INVALID_SWAP_DESCRIPTION();
    error INPUT_PARAMS_LENGTHS_NOT_MATCH();
    error INVALID_TOKENS_LENGTH(uint256 correctTokensLength);
    error TOKENS_NOT_MATCH_POOL_TOKENS(uint256 index);
    error ETH_DEPOSIT_REJECTED();
    error NO_TOKENS_SENT();
    error NOT_ETH_FARM();
    error FARM_NOT_EXISTS();
    error SWAP_NOT_SUCCESSFUL();
    error TRANSFER_NOT_SUCCESSFUL();
    error NO_LIQUIDITY_PROVIDED();
    error MAX_FEE_EXCEEDED(uint256 maxFee);
    error INSUFFICIENT_AMOUNT();

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);
    function fee() external view returns(uint256);
       
    function WMATIC() external view returns(address);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, address recipient) external returns(uint256 liquidity);
    function depositETH(address lpPool, uint256[] memory amounts, address[] calldata tokens, uint256 minAmountLP, address recipient) external payable returns(uint256 liquidity);
    function depositWithSwap(address lpPool, bytes[] calldata swapData, uint256 minAmountLP, address recipient) external payable returns(uint256[] memory sent, uint256 liquidity);
    function depositLP(address lpPool, uint256 amount, address recipient) external;

    function withdraw(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts, uint256 liquidity);
    function withdrawETH(address lpPool, bytes calldata userData, uint256[] calldata minAmountsOut, address recipient) external returns(uint256[] memory amounts, uint256 liquidity);
    function withdrawWithSwap(address lpPool, bytes calldata userData, bytes[] calldata swapData, address recipient) external returns(uint256[] memory amounts, uint256[] memory dust, uint256 liquidity);
    function withdrawLP(address lpPool, uint256 amount, address recipient) external;

    function distribute(
      address lpPool,
      Farm.SwapInfo[] calldata swapInfos,
      Farm.SwapInfo[] calldata feeSwapInfos,
      address feeTo
    ) external returns(uint256 reward);

    function userStake(address _address, address lpPool) external view returns(uint256);
    function totalDeposits(address lpPool) external view returns (uint256);
    function getTokens(address lpPool) external view returns(IERC20[] memory tokens);

    function setFee(uint256 _fee) external;

    function pause() external;
    function unpause() external;
}
